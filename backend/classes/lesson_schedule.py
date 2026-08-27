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


#: How long a lesson runs when ``lesson_time`` names only a start.
#:
#: Production carries 27 classrooms with a bare start ("16:00", "14:00", "10:30") and two
#: with an explicit range, both of which are two hours ("16:00-18:00"). So a bare start is
#: read as the same length the school writes down when it bothers to write one down, rather
#: than inventing a second, shorter lesson for the same timetable.
DEFAULT_LESSON_MINUTES = 120


def parse_lesson_end_time(raw: str | None) -> time | None:
    """The END of ``lesson_time``, or ``None`` when the start itself cannot be read.

    An explicit range gives its own answer ("16:00-18:00" ends at 18:00). A bare start is
    extended by :data:`DEFAULT_LESSON_MINUTES`.

    Returns a plain ``time``, so a lesson whose end crosses midnight comes back *earlier*
    than its start — 23:00 + 2h is 01:00, not 25:00. Callers building a real interval must
    roll to the next day when ``end <= start``; :func:`lesson_interval` does that and is what
    everything in this codebase should use.
    """
    if not raw:
        return None
    start = parse_lesson_time(raw)
    if start is None:
        return None

    parts = _RANGE_SEPARATOR.split(str(raw).strip(), maxsplit=1)
    if len(parts) == 2 and parts[1].strip():
        # A range where the second half is garbage ("16:00 - soon") falls through to the
        # default length rather than losing the end entirely.
        explicit = parse_lesson_time(parts[1])
        if explicit is not None:
            return explicit

    end_minutes = (start.hour * 60 + start.minute + DEFAULT_LESSON_MINUTES) % (24 * 60)
    return time(end_minutes // 60, end_minutes % 60)


def lesson_interval(classroom: Classroom, day) -> tuple[datetime, datetime] | None:
    """``(starts_at, ends_at)`` for this classroom's lesson on ``day``, in school time.

    ``None`` when ``lesson_time`` is unreadable — one production classroom has it blank, and
    every caller has to keep working for that class rather than treating it as "no lesson".

    Does **not** check that ``day`` is a lesson day: callers ask about a date they already
    hold (a register's own date), and a session that exists for an off-schedule day still
    needs an interval.
    """
    start = parse_lesson_time(classroom.lesson_time)
    if start is None:
        return None
    end = parse_lesson_end_time(classroom.lesson_time) or start

    tz = timezone.get_current_timezone()
    starts_at = timezone.make_aware(datetime.combine(day, start), tz)
    ends_at = timezone.make_aware(datetime.combine(day, end), tz)
    if ends_at <= starts_at:
        # Either a lesson running past midnight, or a range typed backwards. Both mean the
        # end belongs to the following day; the alternative is a zero- or negative-length
        # lesson, which would make every window built on it instantly closed.
        ends_at += timedelta(days=1)
    return starts_at, ends_at


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


def lesson_days_in_range(classroom: Classroom, first, last) -> list:
    """Every date in ``[first, last]`` this classroom meets on, in order.

    Empty for an unknown ``lesson_days`` — the caller must treat that as "this class has no
    computable schedule", never as "this class never meets". Unlike ``lesson_starts`` this is
    bounded by real dates rather than a count, which is what a backfill wants: it asks "which
    lessons should already have happened", not "when are the next N".
    """
    weekdays = lesson_weekdays(classroom)
    if not weekdays or first > last:
        return []
    out = []
    day = first
    while day <= last:
        if day.weekday() in weekdays:
            out.append(day)
        day += timedelta(days=1)
    return out


def lesson_starts(classroom: Classroom, count: int, *, anchor=None) -> list[datetime | None]:
    """The first ``count`` lesson starts for ``classroom``, in order.

    Index i is the (i+1)-th time this class meets, counting from ``anchor`` — or from
    ``start_date``, or today when neither is set. Used to lay a Journal's session list
    onto real dates: session N happens at the N-th meeting.

    Pass ``anchor`` for anything that must stay put: with no anchor and no ``start_date``
    the count restarts from "today" on every call, sliding the whole plan forward daily.

    Returns a list of ``count`` ``None``s when the schedule is unusable, so callers can
    always zip it against sessions without length-checking. There is no holiday or
    cancellation model in this codebase, so this is a pure index → date mapping: inserting
    a session shifts every later one, which is the intended, predictable behaviour.
    """
    if count <= 0:
        return []
    weekdays = lesson_weekdays(classroom)
    lesson_time = parse_lesson_time(classroom.lesson_time)
    if not weekdays or lesson_time is None:
        return [None] * count

    tz = timezone.get_current_timezone()
    day = anchor or classroom.start_date or timezone.localtime().date()
    out: list[datetime | None] = []
    # Bounded: every valid group meets >= 3x/week, so `count` lessons always land inside
    # count*3 + 7 days. The cap stops a dirty lesson_days value from spinning forever.
    for _ in range(count * 3 + 7):
        if len(out) >= count:
            break
        if day.weekday() in weekdays:
            out.append(timezone.make_aware(datetime.combine(day, lesson_time), tz))
        day += timedelta(days=1)
    while len(out) < count:
        out.append(None)
    return out


def homework_due_at(classroom: Classroom, released_at=None) -> datetime | None:
    """Deadline for homework released at ``released_at``.

    Homework stays open from the lesson it was set until the moment the NEXT lesson
    begins. ``None`` means no computable deadline → the homework never closes.
    """
    return next_lesson_start_after(classroom, after=released_at or timezone.now())
