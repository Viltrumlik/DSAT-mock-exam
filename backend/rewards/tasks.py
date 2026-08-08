"""Scheduled reward maintenance.

``app.autodiscover_tasks()`` imports exactly one module per app — this one. A ``@shared_task``
defined anywhere else is registered only in whichever process happens to import its module,
and the worker imports nothing on its own (see the note at the top of ``classes/tasks.py``,
written after every homework email was published to a name nothing could execute).
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger("rewards.tasks")

#: How far back the deadline sweep looks. Wide enough that a worker outage of a couple of days
#: still settles the work it missed; narrow enough that the sweep does not re-walk the term.
SWEEP_LOOKBACK_DAYS = 7


@shared_task(name="rewards.tasks.settle_due_homework")
def settle_due_homework(lookback_days: int = SWEEP_LOOKBACK_DAYS) -> dict:
    """Settle homework awards for work whose deadline has passed.

    The item hooks only fire when a student *finishes* something, so a student who did two of
    four items and then stopped would never be scored at all. This closes that: once the due
    date is behind us, the bundle is settled at whatever it reached — 2 of 4 becomes 50%, and
    50% earns nothing, which is the correct answer rather than an absent one.

    Re-running is free. ``recompute_bundle`` upserts, so a bundle already settled at the same
    percentage writes nothing.
    """
    from classes.models import Assignment, ClassroomMembership

    from .homework import recompute_for_students

    now = timezone.now()
    since = now - timezone.timedelta(days=lookback_days)

    assignments = (
        Assignment.objects.filter(due_at__lte=now, due_at__gte=since)
        .exclude(status=Assignment.STATUS_DRAFT)
        .select_related("classroom")
    )

    stats = {"assignments": 0, "students": 0}
    for assignment in assignments:
        students = [
            m.user
            for m in ClassroomMembership.objects.filter(
                classroom_id=assignment.classroom_id,
                role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
            ).select_related("user")
        ]
        if not students:
            continue
        stats["assignments"] += 1
        stats["students"] += recompute_for_students(assignment, students)

    logger.info("settle_due_homework %s", stats)
    return stats
