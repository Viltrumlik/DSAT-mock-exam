"""
Celery tasks for classroom / homework maintenance.
"""

from __future__ import annotations

import logging

from celery import shared_task

# Registering the mail tasks with the WORKER, not just the web process.
#
# ``app.autodiscover_tasks()`` imports exactly one module per app — this one. A
# ``@shared_task`` living anywhere else is registered only in a process that happens to
# import its module, and the worker imports neither of these on its own.
#
# `mail_midterm` got away with it by accident: three view modules import it at top level, so
# loading the URLconf registers it. `mail_homework` is imported *inside* the two view
# functions that use it, so only the web process ever saw it — the worker had no
# `classes.mail_homework.send_homework_assigned_emails` to run, every homework email was
# published to a name nothing could execute, and because the send is claimed via
# `Assignment.notified_at` BEFORE dispatch, none of them ever retried. 20 classes' homework
# was announced to nobody, silently, before this was noticed.
#
# `mail_support` then repeated the bug this comment was written about. Its task is reached
# only from `support._announce_invitation`, which imports it inside the function — so, exactly
# like `mail_homework` before it, the web process registered it and the worker did not.
# Production confirmed it: `classes.mail_support.send_support_invitation_email` was absent
# from the worker's task list entirely, so every "X added you to a support session" email was
# published to a name nothing could execute. The bell notification landed, which is why this
# looked like it worked. **Anything in this app with a @shared_task belongs on this line.**
#
# Importing them here makes registration explicit and independent of view-loading order.
from . import mail_homework, mail_midterm, mail_support  # noqa: F401  (task registration)

logger = logging.getLogger("classes.tasks")


@shared_task(name="classes.tasks.cleanup_stale_homework_storage")
def cleanup_stale_homework_storage() -> dict:
    from .stale_storage_cleanup import run_stale_storage_cleanup

    stats = run_stale_storage_cleanup()
    logger.info("cleanup_stale_homework_storage %s", stats)
    return stats


@shared_task(name="classes.tasks.prune_homework_staged_uploads")
def prune_homework_staged_uploads() -> dict:
    """Periodic deletion of old ``HomeworkStagedUpload`` attached rows (see retention setting)."""
    from .stale_storage_cleanup import prune_homework_staged_upload_records

    stats = prune_homework_staged_upload_records()
    logger.info("prune_homework_staged_uploads %s", stats)
    return stats


@shared_task(name="classes.tasks.recompute_classroom_rankings")
def recompute_classroom_rankings(classroom_id: int | None = None) -> dict:
    """Rebuild the leaderboards. One classroom when given an id, otherwise every active one.

    This task is why the leaderboard exists at all. Ranking snapshots are only ever written
    by ``service.recompute_classroom``, whose sole caller was a POST endpoint that nothing in
    the UI invoked — so in production the board had never been computed once, and every
    classroom showed "No rankings yet" while telling the teacher to press a button that was
    not on the screen.

    Per-classroom failures are swallowed: one classroom with bad data must not stop the
    sweep from ranking the other forty.
    """
    from .models import Classroom
    from .ranking import service

    qs = Classroom.objects.all()
    if classroom_id is not None:
        qs = qs.filter(pk=classroom_id)
    else:
        qs = qs.filter(is_active=True)

    ranked = failed = 0
    for classroom in qs.iterator():
        try:
            service.recompute_classroom(classroom)
            ranked += 1
        except Exception:
            failed += 1
            logger.exception("ranking recompute failed classroom=%s", classroom.pk)

    stats = {"classrooms": ranked, "failed": failed}
    logger.info("recompute_classroom_rankings %s", stats)
    return stats


# ── Class Telegram groups ────────────────────────────────────────────────────


@shared_task(name="classes.tasks.enforce_telegram_group_for_user")
def enforce_telegram_group_for_user(user_id: int, reason: str) -> dict:
    """Take one account out of every class Telegram group it is in. Raised by a freeze."""
    from django.contrib.auth import get_user_model

    from . import telegram_group as tg

    user = get_user_model().objects.filter(pk=user_id).first()
    if user is None:
        return {"status": "noop", "reason": "missing_user", "user_id": user_id}
    if not tg.api.is_configured():
        return {"status": "noop", "reason": "no_token", "user_id": user_id}
    result = tg.enforce_for_user(user, reason=reason)
    logger.info("telegram_group enforce user=%s reason=%s -> %s", user_id, reason, result)
    return {"status": "ok", "user_id": user_id, **result}


@shared_task(name="classes.tasks.enforce_telegram_group_membership")
def enforce_telegram_group_membership(classroom_id: int, user_id: int, reason: str) -> dict:
    """Take one account out of ONE class group. Raised by a removal from the class."""
    from . import telegram_group as tg
    from .models_telegram import ClassroomTelegramMember

    if not tg.api.is_configured():
        return {"status": "noop", "reason": "no_token"}
    row = (
        ClassroomTelegramMember.objects.select_related("classroom", "user")
        .filter(classroom_id=classroom_id, user_id=user_id)
        .exclude(status=ClassroomTelegramMember.STATUS_REMOVED)
        .first()
    )
    if row is None:
        return {"status": "noop", "reason": "not_in_group"}
    removed = tg.remove_member(row, reason=reason)
    return {"status": "ok", "removed": bool(removed), "classroom_id": classroom_id}


@shared_task(name="classes.tasks.audit_classroom_telegram_groups")
def audit_classroom_telegram_groups() -> dict:
    """The half-hourly sweep: reconcile every class group with what the site believes.

    The webhook is the fast path and covers the ordinary join and leave. This exists for
    everything the webhook cannot tell us — an update dropped during a deploy, a student
    frozen while the worker was down, a roster edited straight in the Django admin.
    """
    from django.conf import settings as dj_settings

    from . import telegram_group as tg

    if not tg.api.is_configured():
        return {"status": "noop", "reason": "no_token"}
    batch = int(getattr(dj_settings, "CLASSROOM_TELEGRAM_AUDIT_BATCH", 60) or 60)
    result = tg.audit_all(max_classrooms=batch)
    if result.get("problems"):
        logger.warning("telegram_group audit problems: %s", result["problems"])
    logger.info("telegram_group audit -> %s", result)
    return {"status": "ok", **result}
