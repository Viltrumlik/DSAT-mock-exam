"""Celery tasks: push fan-out, the homework deadline sweep, and pruning dead endpoints.

The fan-out lives here rather than in the request because N sequential HTTPS calls inside a
handler is the sync-worker starvation problem this codebase already knows about (see the 25s
SSE cap in `realtime/views.py`).

``app.autodiscover_tasks()`` imports exactly one module per app — this one. A ``@shared_task``
defined anywhere else is registered only in whichever process happens to import its module, and
the worker imports nothing on its own, so everything schedulable belongs in this file.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

#: How far ahead the deadline sweep looks. A day is the horizon a student can still act on: it
#: covers an evening's work and the next morning, and it is short enough that "due soon" is not
#: a thing they are told while it is still someone else's problem.
DUE_SOON_WINDOW_HOURS = 24


@shared_task(
    name="notifications.send_push_for_notification",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
)
def send_push_for_notification(notification_id: int) -> dict:
    """Push one notification to every live browser its recipient has registered."""
    from . import push
    from .models import Notification, PushSubscription

    if not push.is_configured():
        return {"sent": 0, "skipped": "not configured"}

    notification = Notification.objects.filter(pk=notification_id).select_related(
        "recipient"
    ).first()
    if notification is None:
        return {"sent": 0, "skipped": "gone"}

    payload = push.payload_for(notification)
    subscriptions = PushSubscription.objects.filter(
        user=notification.recipient, failed_at__isnull=True
    )
    sent = sum(1 for sub in subscriptions if push.send_to_subscription(sub, payload))
    return {"sent": sent}


@shared_task(
    name="notifications.send_push_for_notifications",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
)
def send_push_for_notifications(notification_ids: list[int]) -> dict:
    """Push a whole fan-out. One task for the group, not one task per student.

    The per-notification task above is still the right shape for a hook that knows one
    recipient. It is the wrong shape for an announcement: a 200-student broadcast published 200
    Celery messages, each of which woke a worker to run one ``SELECT`` on notifications, one on
    subscriptions, and one HTTPS call. Here the two queries are done once for the entire batch
    and the worker spends its time on the only part that genuinely has to be per-device.

    Retries re-send the whole batch, which is acceptable rather than perfect: a push is not a
    database write, so a resend cannot corrupt anything, and ``sw.js`` tags every notification
    with its category so a repeat replaces the previous banner instead of stacking a second
    one. The cost of a retry is therefore a duplicate delivery attempt, not a duplicate row and
    not a second thing on the student's lock screen.
    """
    from . import push
    from .models import Notification, PushSubscription

    ids = [int(pk) for pk in (notification_ids or ()) if pk]
    if not ids:
        return {"sent": 0, "skipped": "empty"}
    if not push.is_configured():
        return {"sent": 0, "skipped": "not configured"}

    notifications = list(Notification.objects.filter(pk__in=ids))
    if not notifications:
        return {"sent": 0, "skipped": "gone"}

    # One query for every recipient's devices, grouped in memory. Asking per notification
    # would put the N+1 straight back into the worker.
    by_user: dict[int, list] = {}
    for sub in PushSubscription.objects.filter(
        user_id__in={n.recipient_id for n in notifications}, failed_at__isnull=True
    ):
        by_user.setdefault(sub.user_id, []).append(sub)

    sent = 0
    for notification in notifications:
        subs = by_user.get(notification.recipient_id)
        if not subs:
            continue
        payload = push.payload_for(notification)
        sent += sum(1 for sub in subs if push.send_to_subscription(sub, payload))
    return {"sent": sent, "notifications": len(notifications)}


@shared_task(name="notifications.prune_push_subscriptions")
def prune_push_subscriptions(older_than_days: int = 30) -> dict:
    from .services import prune_failed_subscriptions

    return {"deleted": prune_failed_subscriptions(older_than_days)}


def _due_key(assignment_id: int):
    """The per-student dedupe key for one assignment's deadline reminder.

    A named factory rather than an inline lambda because it is closed over inside a loop, and a
    lambda capturing the loop variable is the classic way to send every class the last
    assignment's key.
    """
    return lambda user: f"due:{assignment_id}:{user.pk}"


def _due_phrase(due_at, now) -> str:
    """"in 6 hours" / "in about an hour" — a relative phrase, never a wall-clock time.

    Deliberately not formatted as a date. The platform serves students in one timezone but
    renders on their own devices, and a notification body is a stored string that cannot be
    re-localised later, so an absolute "due 14:00" would be wrong for anybody travelling and
    stale for everybody once the deadline moves.
    """
    hours = int((due_at - now).total_seconds() // 3600)
    if hours <= 1:
        return "in about an hour"
    return f"in {hours} hours"


@shared_task(name="notifications.notify_homework_due_soon")
def notify_homework_due_soon(window_hours: int = DUE_SOON_WINDOW_HOURS) -> dict:
    """Tell students about homework whose deadline is close and who have not handed it in.

    ``HOMEWORK_DUE_SOON`` was declared from day one and had no producer at all — the constant,
    the category and the push entry all existed for an event nothing ever raised. A deadline
    reminder has no natural hook to hang off, because the thing that makes it newsworthy is the
    passage of time rather than an action anybody took, so it can only ever be a sweep.

    **Told once per assignment, not once per sweep.** ``notify``'s ``dedupe_key`` window is
    sixty minutes, which is the right guard for a burst of hooks firing on the same fact but the
    wrong one here: on the half-hourly beat entry, against a 24-hour horizon, every student
    would collect a fresh reminder each time that window expired and re-armed — two dozen of
    them for one piece of homework. So this task carries its own,
    stronger guard — it reads back every ``due:{assignment}:*`` key already written for the
    assignment and drops those students before notifying. That makes a re-run genuinely free,
    which in turn is what lets the schedule be frequent enough that a homework published six
    hours before its deadline still gets a reminder.

    **Submitters are excluded, and the exclusion is the point.** Reminding somebody about work
    they have already handed in is the fastest way to teach them the bell is noise.
    """
    from classes.models import Assignment, ClassroomMembership, Submission

    from . import constants
    from .models import Notification
    from .services import notify_many

    now = timezone.now()
    horizon = now + timedelta(hours=max(1, int(window_hours)))

    assignments = (
        Assignment.objects.filter(
            due_at__gt=now,
            due_at__lte=horizon,
            # PUBLISHED only. A DRAFT is invisible to students, and an ARCHIVED assignment is
            # explicitly out of the completion denominator — reminding anyone about either
            # would be telling them to do work the platform will not show them.
            status=Assignment.STATUS_PUBLISHED,
        )
        .select_related("classroom")
        .order_by("due_at")
    )

    stats = {"assignments": 0, "notified": 0}
    for assignment in assignments:
        students = [
            m.user
            for m in ClassroomMembership.objects.filter(
                classroom_id=assignment.classroom_id,
                role=ClassroomMembership.ROLE_STUDENT,
                # NON_REMOVED_STATUSES (ACTIVE + INVITED), matching every other homework
                # sweep in this codebase. An INVITED student sees the assignment, so they are
                # owed the reminder.
                status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            ).select_related("user")
        ]
        if not students:
            continue

        handed_in = set(
            Submission.objects.filter(
                assignment=assignment,
                status__in=(Submission.STATUS_SUBMITTED, Submission.STATUS_REVIEWED),
            ).values_list("student_id", flat=True)
        )
        # RETURNED and DRAFT are deliberately absent from that tuple: a returned submission is
        # work the student still has to redo, and a draft is work they have started and not
        # finished. Both are exactly who this reminder is for.

        already_told = set(
            Notification.objects.filter(
                event=constants.EVENT_HOMEWORK_DUE_SOON,
                # The trailing colon keeps assignment 1 from matching assignment 11.
                dedupe_key__startswith=f"due:{assignment.pk}:",
            ).values_list("recipient_id", flat=True)
        )

        targets = [
            s for s in students if s.pk not in handed_in and s.pk not in already_told
        ]
        if not targets:
            continue

        stats["assignments"] += 1
        classroom_name = getattr(assignment.classroom, "name", "") or ""
        when = _due_phrase(assignment.due_at, now)
        stats["notified"] += notify_many(
            targets,
            event=constants.EVENT_HOMEWORK_DUE_SOON,
            # Growth-oriented, per the house rule for student-facing copy: this is a nudge
            # with time left on it, not a warning about being late. "Overdue", "missing" and
            # "you failed to" are what this school's UI never says.
            title=f"{(assignment.title or 'Homework').strip()[:120]} is due soon",
            body=(
                (f"{classroom_name} · " if classroom_name else "")
                + f"due {when}. There's still time to finish it."
            )[:400],
            # The student's console. A teacher reading their own bell would get a link to a
            # page they are not the audience for, but a due-soon reminder only ever goes to
            # STUDENT memberships, so the one relative path is correct for every recipient.
            link_url=f"/classes/{assignment.classroom_id}",
            dedupe_key=_due_key(assignment.pk),
        )

    logger.info("notify_homework_due_soon %s", stats)
    return stats
