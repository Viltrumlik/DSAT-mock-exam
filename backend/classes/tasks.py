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
# Importing them here makes registration explicit and independent of view-loading order.
from . import mail_homework, mail_midterm  # noqa: F401  (imported for task registration)

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
