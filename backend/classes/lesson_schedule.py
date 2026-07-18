"""Classroom lesson schedule: weekday mapping, ``lesson_time`` parsing, next-lesson lookup.

Single source of truth for turning a Classroom's ODD/EVEN ``lesson_days`` plus its
free-text ``lesson_time`` into concrete lesson datetimes.

Homework has no manual deadline: it is due at the **start of the classroom's next
lesson**. When that cannot be computed (unknown ``lesson_days``, blank/garbage
``lesson_time``) the homework simply has **no deadline** — callers must treat ``None``
as "open", never as "overdue".
"""

from __future__ import annotations

import re
from datetime import datetime, time, timedelta

from django.utils import timezone

from .models import Classroom

# ODD = Mon/Wed/Fri, EVEN = Tue/Thu/Sat (Python weekday: Mon=0 … Sun=6).
# Sunday belongs to NEITHER group — there is no 7-day classroom.
# Mirrors frontend src/lib/classroomSchedule.ts; ClassroomViewSet.my_schedule imports
# this rather than re-declaring the sets, so the calendar and deadlines can't drift.
LESSON_WEEKDAYS: dict[str, frozenset[int]] = {
    Classroom.DAYS_ODD: frozenset({0, 2, 4}),
    Classroom.DAYS_EVEN: frozenset({1, 3, 5}),
}

# lesson_time is free text. Production values include "18:00", "08:00-10:00" (a range —
# the start is the lesson start), "4:00 PM", "9am", blank, and garbage.
_RANGE_SEPARATOR = re.compile(r"\s*(?:-|–|—|/|to)\s*", re.IGNORECASE)
_HH_MM = re.compile(r"^(\d{1,2}):(\d{2})\s*([ap]m)?$", re.IGNORECASE)
_H_ONLY = re.compile(r"^(\d{1,2})\s*([ap]m)$", re.IGNORECASE)


def parse_lesson_time(raw: str | None) -> time | None:
    """Parse ``Classroom.lesson_time`` into a ``time``, or ``None`` if unusable.

    Ported from the frontend ``useStudentSchedule.parseHM`` so client and server agree
    on what "18:00" / "6pm" / "08:00-10:00" mean.
    """
    if not raw:
        return None
    start = _RANGE_SEPARATOR.split(str(raw).strip(), maxsplit=1)[0].strip()
    if not start:
        return None

    m = _HH_MM.match(start)
    if m:
        hour, minute, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
    else:
        m = _H_ONLY.match(start)
        if not m:
            return None
        hour, minute, ampm = int(m.group(1)), 0, m.group(2).lower()

    if ampm == "pm" and hour < 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def lesson_weekdays(classroom: Classroom) -> frozenset[int]:
    """Weekdays this classroom meets on; empty for an unknown ``lesson_days``."""
    return LESSON_WEEKDAYS.get(classroom.lesson_days, frozenset())


def next_lesson_start_after(classroom: Classroom, after=None) -> datetime | None:
    """Aware datetime of the classroom's next lesson start strictly after ``after``.

    Returns ``None`` when it cannot be computed (unknown ``lesson_days``, unparseable or
    blank ``lesson_time``) — the caller treats that as "no deadline". Never raises on
    dirty rows.
    """
    weekdays = lesson_weekdays(classroom)
    if not weekdays:
        return None
    lesson_time = parse_lesson_time(classroom.lesson_time)
    if lesson_time is None:
        return None

    after = after or timezone.now()
    tz = timezone.get_current_timezone()

    # Scan from the later of "now" and the classroom's start_date, so a class that
    # hasn't begun yet resolves to its FIRST lesson rather than falling outside the
    # window. start_date is nullable — a null floor just means "already running".
    scan_from = timezone.localtime(after).date()
    if classroom.start_date and classroom.start_date > scan_from:
        scan_from = classroom.start_date

    # Every valid group meets >= 3x/week, so a lesson day always falls within 7 days of
    # the scan start. The loop is bounded so a dirty lesson_days value can't spin forever.
    for offset in range(0, 8):
        day = scan_from + timedelta(days=offset)
        if day.weekday() not in weekdays:
            continue
        start = timezone.make_aware(datetime.combine(day, lesson_time), tz)
        if start > after:
            return start
    return None


def homework_due_at(classroom: Classroom, released_at=None) -> datetime | None:
    """Deadline for homework released at ``released_at``.

    Homework stays open from the lesson it was set until the moment the NEXT lesson
    begins. ``None`` means no computable deadline → the homework never closes.
    """
    return next_lesson_start_after(classroom, after=released_at or timezone.now())
