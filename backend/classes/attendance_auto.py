"""Attendance sessions materialise themselves on lesson days.

A teacher should never have to create the day's register. The class already knows when it
meets — ``lesson_days`` (ODD = Mon/Wed/Fri, EVEN = Tue/Thu/Sat) plus ``lesson_time`` — so the
session for a lesson day appears on its own once that lesson has started.

**Why "has started" and not "is today".** A register for a lesson that has not begun invites
a teacher to mark a room that is still empty, and every mark would be a guess. The session
appears at the lesson's start time, which is the first moment there is anything to record.

**Why a window and not the whole history.** Backfilling a class that began in February would
mint eighty empty drafts nobody is going to mark, and drown the day's actual register in
them. ``BACKFILL_DAYS`` covers the realistic gap — a holiday, a week nobody opened the
page — and nothing older. Scoring is unaffected either way: ``attendance.py`` counts only
FINALIZED sessions that carry records, and an unmarked draft is neither.

Materialisation runs on read (the sessions list) *and* from a management command, so it is
correct whether or not the school has a cron. Both paths go through ``ensure_sessions``,
which is idempotent — ``uniq_attendance_session_per_day`` is the backstop, and get_or_create
the ordinary path.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from .lesson_schedule import lesson_days_in_range, lesson_weekdays, parse_lesson_time
from .models import Classroom
from .models_attendance import AttendanceSession

#: How far back a materialisation run will reach.
#:
#: **Was 14, and had to come down.** The fortnight existed to cover a holiday or a week
#: nobody opened the page, on the assumption that a teacher could still fill those registers
#: in when they got to them. ``attendance_window`` ended that assumption: a register closes
#: two hours after its lesson ends, so anything older than today is minted permanently
#: unfillable — a list of dead drafts above the one register that can actually be marked.
#:
#: One day rather than zero because a lesson's grace period can outlive the lesson's own
#: date in principle (a late class plus two hours), and because a run just after midnight
#: should still be able to open yesterday's register while its window is closing. Nothing
#: older can be written by anyone but a global admin, so nothing older is worth creating.
BACKFILL_DAYS = 1


def due_lesson_dates(classroom: Classroom, *, now=None, backfill_days: int = BACKFILL_DAYS) -> list:
    """Lesson dates whose lesson has already begun, most recent window first.

    Returns ``[]`` for a classroom whose schedule cannot be read — see
    ``schedule_is_usable``. Today counts only once its lesson start time has passed; a class
    with an unreadable ``lesson_time`` but a readable ``lesson_days`` gets its past lesson
    days and today, on the grounds that the day is the part we are sure of.
    """
    now = now or timezone.now()
    today = timezone.localdate(now)
    first = today - timedelta(days=max(0, int(backfill_days)))

    # A class cannot have held a lesson before it existed. Without this floor, switching the
    # feature on hands every classroom a fortnight of registers for lessons that never
    # happened. ``start_date`` is the school's own answer and wins; ``created_at`` is the
    # fallback for the many rows that predate the field.
    began = classroom.start_date or timezone.localdate(classroom.created_at)
    first = max(first, began)

    dates = lesson_days_in_range(classroom, first, today)
    if not dates:
        return []

    lesson_time = parse_lesson_time(classroom.lesson_time)
    if lesson_time is None:
        return dates

    tz = timezone.get_current_timezone()
    return [
        day
        for day in dates
        if timezone.make_aware(datetime.combine(day, lesson_time), tz) <= now
    ]


def schedule_is_usable(classroom: Classroom) -> bool:
    """Whether lesson days can be worked out at all.

    ``lesson_time`` is deliberately not required: an unreadable time costs precision about
    *when* the register opens, an unreadable ``lesson_days`` means there is no lesson day to
    open one on. The UI keeps a manual escape hatch open exactly when this is False, so a
    class with a broken schedule is never locked out of taking attendance.
    """
    return bool(lesson_weekdays(classroom))


def ensure_sessions(classroom: Classroom, *, now=None, backfill_days: int = BACKFILL_DAYS) -> list:
    """Create any missing register for a lesson that has started. Idempotent.

    Returns the sessions this call created (empty when there was nothing to do), so a caller
    can log or report the work without re-querying.
    """
    dates = due_lesson_dates(classroom, now=now, backfill_days=backfill_days)
    if not dates:
        return []

    existing = set(
        AttendanceSession.objects.filter(classroom=classroom, date__in=dates).values_list(
            "date", flat=True
        )
    )
    created = []
    for day in dates:
        if day in existing:
            continue
        try:
            # Its own transaction: a race with a concurrent request raises IntegrityError on
            # the unique constraint, and swallowing that inside a shared atomic block would
            # leave the whole request in a broken-transaction state.
            with transaction.atomic():
                created.append(
                    AttendanceSession.objects.create(
                        classroom=classroom,
                        date=day,
                        # No created_by: nobody created it. The lesson did.
                        created_by=None,
                    )
                )
        except IntegrityError:
            # Someone else materialised the same day between the query and the insert. The
            # session exists, which is all this function promises.
            continue
    return created
