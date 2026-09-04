"""Site events that must reach the class Telegram groups.

Two of them, and both are the *removal* half of the feature — joining is always something a
student does deliberately from the classroom page, never something that happens to them.

* **An account is frozen.** The student comes out of every class group they are in, and any
  invite link still outstanding is revoked. They stay in the class here: their homework,
  points and results are untouched, and when the freeze is lifted they come back to the page
  and press the button again. Nothing lets them back in automatically, which is the school's
  decision and not an omission.
* **A student is removed from a class.** They come out of that class's group.

Signals rather than calls edited into each view, for the reason ``membership_hooks`` gives
next door: the write paths are plural. ``is_frozen`` is set by the ops row buttons, the edit
modal, the bulk action and the Django admin — four call sites today and no guarantee about
next year. Every one of them goes through ``save()``, so hanging off the model catches all
four and whatever is added later.

Nothing here talks to Telegram inside the request. A freeze is a click in the ops console,
and a click must not wait on however many Bot API round trips the student's classes add up
to — nor should a Telegram outage be able to fail the freeze itself.
"""

from __future__ import annotations

import logging
import threading

from django.conf import settings
from django.db import connection, transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

logger = logging.getLogger("classes.telegram_group")

#: Where ``pre_save`` parks the previous value for ``post_save``. Distinct from the audit
#: hooks' own snapshot attribute on purpose: that one is *popped* by its receiver, and a
#: reader that depends on running first is a reader that breaks the day registration order
#: changes.
_FROZEN_SNAPSHOT = "_telegram_group_was_frozen"
_STATUS_SNAPSHOT = "_telegram_group_prev_status"

#: "We did not look" — distinct from "it was False". Without this a save that cannot have
#: touched the field would read as a change *from* not-frozen.
_UNKNOWN = object()


def _dispatch(task, *args) -> None:
    """Run a task on the worker, or off-thread when there is no broker (dev, tests).

    Mirrors ``question_reports.tasks.enqueue_question_report_notification``: the same
    problem, the same two answers.
    """
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))

    def _run_now() -> None:
        try:
            task(*args)
        except Exception:
            logger.exception("telegram_group inline task failed: %s", task.name)

    def _go() -> None:
        # Eager first, and called directly rather than through `.delay()`: eager mode means
        # "run it here" either way, and going through the broker API in that mode makes the
        # behaviour depend on whether the Celery app happened to read the setting before a
        # test overrode it.
        if eager:
            _run_now()
            return
        if broker:
            try:
                task.delay(*args)
            except Exception:
                logger.exception("telegram_group task dispatch failed: %s", task.name)
            return

        def _inline() -> None:
            try:
                _run_now()
            finally:
                connection.close()

        threading.Thread(target=_inline, name="tg-group-enforce", daemon=True).start()

    # on_commit, so a freeze that is rolled back never reaches Telegram — and so the worker
    # cannot read the row before the transaction that changed it has landed.
    transaction.on_commit(_go)


# ── Freezing an account ──────────────────────────────────────────────────────


@receiver(pre_save, sender=settings.AUTH_USER_MODEL, dispatch_uid="telegram_group_user_pre")
def _stash_frozen(sender, instance, update_fields=None, **kwargs):
    try:
        if instance.pk is None:
            instance.__dict__[_FROZEN_SNAPSHOT] = _UNKNOWN
            return
        # A save that names its fields and does not name this one cannot have changed it.
        # Worth the check: `last_login` is written on every single sign-in, and this receiver
        # would otherwise add a query to each.
        if update_fields is not None and "is_frozen" not in update_fields:
            instance.__dict__[_FROZEN_SNAPSHOT] = _UNKNOWN
            return
        previous = sender.objects.filter(pk=instance.pk).values_list("is_frozen", flat=True).first()
        instance.__dict__[_FROZEN_SNAPSHOT] = previous
    except Exception:
        logger.exception("telegram_group freeze snapshot failed pk=%s", getattr(instance, "pk", None))
        instance.__dict__[_FROZEN_SNAPSHOT] = _UNKNOWN


@receiver(post_save, sender=settings.AUTH_USER_MODEL, dispatch_uid="telegram_group_user_post")
def _on_freeze_change(sender, instance, created, **kwargs):
    try:
        previous = instance.__dict__.pop(_FROZEN_SNAPSHOT, _UNKNOWN)
        if created or previous is _UNKNOWN or previous is None:
            return
        if bool(previous) or not bool(instance.is_frozen):
            return  # not a False → True transition

        from .models_telegram import ClassroomTelegramMember
        from .tasks import enforce_telegram_group_for_user

        _dispatch(
            enforce_telegram_group_for_user,
            instance.pk,
            ClassroomTelegramMember.REASON_FROZEN,
        )
    except Exception:
        logger.exception("telegram_group freeze hook failed pk=%s", getattr(instance, "pk", None))


# ── Leaving a class ──────────────────────────────────────────────────────────


@receiver(pre_save, sender="classes.ClassroomMembership", dispatch_uid="telegram_group_member_pre")
def _stash_status(sender, instance, **kwargs):
    try:
        if instance.pk is None:
            instance.__dict__[_STATUS_SNAPSHOT] = _UNKNOWN
            return
        instance.__dict__[_STATUS_SNAPSHOT] = (
            sender.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
        )
    except Exception:
        logger.exception("telegram_group status snapshot failed pk=%s", getattr(instance, "pk", None))
        instance.__dict__[_STATUS_SNAPSHOT] = _UNKNOWN


@receiver(post_save, sender="classes.ClassroomMembership", dispatch_uid="telegram_group_member_post")
def _on_membership_change(sender, instance, created, **kwargs):
    try:
        previous = instance.__dict__.pop(_STATUS_SNAPSHOT, _UNKNOWN)
        if created or previous is _UNKNOWN or previous is None:
            return
        if instance.status != sender.STATUS_REMOVED or previous == sender.STATUS_REMOVED:
            return

        from .models_telegram import ClassroomTelegramMember
        from .tasks import enforce_telegram_group_membership

        _dispatch(
            enforce_telegram_group_membership,
            instance.classroom_id,
            instance.user_id,
            ClassroomTelegramMember.REASON_NOT_IN_CLASS,
        )
    except Exception:
        logger.exception("telegram_group membership hook failed pk=%s", getattr(instance, "pk", None))
