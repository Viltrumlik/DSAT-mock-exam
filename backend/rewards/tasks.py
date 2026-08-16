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

#: How far back the deadline sweep looks.
#:
#: This is now **load-bearing, not a tuning knob.** Under the deadline-frozen model an unfinished
#: bundle writes nothing at all before its due date, so this sweep is the *only* thing that ever
#: pays it. A bundle whose deadline falls outside this window is not merely settled late — it is
#: never settled, permanently, because nothing else in the system will look at it again. Seven
#: days absorbs a worker outage of a couple of days without re-walking the term; anything longer
#: after a real outage is what the ``settle_due_homework`` management command's
#: ``--lookback-days`` exists for.
SWEEP_LOOKBACK_DAYS = 7


@shared_task(name="rewards.tasks.settle_due_homework")
def settle_due_homework(lookback_days: int = SWEEP_LOOKBACK_DAYS) -> dict:
    """Settle homework awards for work whose deadline has passed.

    **The only path that pays a partially-done bundle.** The item hooks settle a bundle the
    moment it reaches 100% before the deadline and otherwise write nothing, deliberately: XP is
    a high-water mark, so an interim award at a transient percentage would bank that XP forever
    even after the points fell back to the deadline figure. Everything short of 100% therefore
    waits here, and a student who did two of four items and stopped is scored at 50% once the
    due date is behind them rather than never scored at all.

    Re-running is free. ``recompute_bundle`` upserts, so a bundle already settled at the same
    percentage writes nothing — which is what lets the cadence be ten minutes instead of hourly.
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
                # NON_REMOVED_STATUSES (ACTIVE + INVITED), matching
                # ``hooks._student_classroom_ids``. The two must agree: with STATUS_ACTIVE only,
                # an INVITED student the hooks happily paid for finishing early was invisible
                # here, so the same student was settled by one path and not the other depending
                # solely on whether they hit 100% before the deadline.
                status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            ).select_related("user")
        ]
        if not students:
            continue
        stats["assignments"] += 1
        stats["students"] += recompute_for_students(assignment, students)

    logger.info("settle_due_homework %s", stats)
    return stats
