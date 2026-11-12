"""Which classes meet on a day, who teaches them, and what their registers say (plan PR4-lessons-today).

The ops Today board's "Lessons today", and its "N registers not marked". Every ACTIVE class whose
schedule holds a lesson on ``day`` is here, paired with lc-up or not. ``lcup.followups._meeting_classes``
answers a narrower question for the lc-up lesson-end beat (paired classes with a readable time only) and
keeps it; a test holds the paired classes both find in agreement.

Each rule is borrowed from where it already lives, so Today cannot disagree with the register:

- **Meets on ``day``**: its ``lesson_days`` covers the weekday (``lesson_schedule.LESSON_WEEKDAYS``), it has
  begun by ``day`` (``lesson_schedule.begun_by``), and it ``is_active``.
- **The lesson**: ``lesson_schedule.lesson_interval``. A class whose ``lesson_time`` cannot be read is still
  listed, with no times and phase ``unknown``, so a lesson never goes silently missing from Today.
- **The roster**: the register's own rule (``views_attendance._active_students``): active student seats
  taken on or before ``day``.
- **Taken**: the register holds any mark, or nobody on it can be marked (a student lc-up holds frozen
  cannot be), as ``lcup.followups.lesson_check`` decides it.
- **State and close**: ``attendance_window.marking_state`` / ``marking_window``.

Counts only, never names. The number of queries is fixed, however many classes meet.
"""

from __future__ import annotations

from datetime import date, datetime

from django.db.models import Count, Q
from django.utils import timezone

from users.people_detail import display_name

from .attendance_window import STATE_LOCKED, STATE_OPEN, STATE_PENDING, marking_state, marking_window
from .lesson_schedule import LESSON_WEEKDAYS, begun_by, lesson_interval
from .models import Classroom, ClassroomMembership
from .models_attendance import AttendanceRecord, AttendanceSession

PHASE_UPCOMING = "upcoming"
PHASE_NOW = "now"
PHASE_ENDED = "ended"
#: ``lesson_time`` cannot be read, so there is no start or end to compare the clock with.
PHASE_UNKNOWN = "unknown"

#: ``attendance_window``'s register states, in the API's words.
REGISTER_STATE = {STATE_PENDING: "not_yet", STATE_OPEN: "open", STATE_LOCKED: "closed"}

#: The register's marks, by the name the API reports each count under.
MARKS = {
    "present": AttendanceRecord.STATUS_PRESENT,
    "late": AttendanceRecord.STATUS_LATE,
    "absent": AttendanceRecord.STATUS_ABSENT,
    "excused": AttendanceRecord.STATUS_EXCUSED,
}


def meeting_classrooms(day: date) -> list[Classroom]:
    """Every active class that holds a lesson on ``day``, teacher and branch joined: one query (none on a
    Sunday, which belongs to no schedule)."""
    codes = [code for code, weekdays in LESSON_WEEKDAYS.items() if day.weekday() in weekdays]
    if not codes:
        return []
    return list(
        Classroom.objects.filter(is_active=True, lesson_days__in=codes)
        .filter(begun_by(day))
        .select_related("teacher", "branch")
        .order_by("pk")
    )


def _rosters(room_ids, day: date) -> tuple[dict[int, set[int]], dict[int, set[int]]]:
    """``(roster, seat_frozen)`` per class: who is on each register of ``day``, and which of them have a
    frozen seat. One query for every class."""
    roster: dict[int, set[int]] = {pk: set() for pk in room_ids}
    seat_frozen: dict[int, set[int]] = {pk: set() for pk in room_ids}
    seats = ClassroomMembership.objects.filter(
        classroom_id__in=room_ids,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).values_list("classroom_id", "user_id", "joined_at", "seat_status")
    for room_id, user_id, joined_at, seat_status in seats:
        # Compared as a local date, as the register compares it: a seat taken at 21:30 is on that day's register.
        if timezone.localdate(joined_at) > day:
            continue
        roster[room_id].add(user_id)
        if seat_status == ClassroomMembership.SEAT_FROZEN:
            seat_frozen[room_id].add(user_id)
    return roster, seat_frozen


def _marks(room_ids, day: date) -> dict[int, dict[str, int]]:
    """Each class's register of ``day``, counted by mark: one aggregated query for every class."""
    annotations = {name: Count("records", filter=Q(records__status=status)) for name, status in MARKS.items()}
    rows = (
        AttendanceSession.objects.filter(classroom_id__in=room_ids, date=day)
        .order_by()
        .values("classroom_id")
        .annotate(marked=Count("records"), **annotations)
    )
    return {row.pop("classroom_id"): row for row in rows}


def _lcup(room_ids) -> tuple[bool, set[int], set[int], dict[int, set[int]]]:
    """What lc-up decides about these registers, for every class at once: ``(enabled, managed, pushing,
    frozen)``.

    ``pushing`` is ``lcup.attendance_guard.pushes_to_lcup`` and ``frozen`` the lc-up half of
    ``frozen_in_lcup`` (its seat half comes from ``_rosters``), each asked once for all the classes rather
    than once per class. At most two queries, none while lc-up is off.
    """
    from lcup.conf import attendance_pull_enabled, attendance_push_enabled, lcup_enabled
    from lcup.guards import lcup_managed_ids

    managed = lcup_managed_ids(room_ids)
    pushing = set(managed) if attendance_push_enabled() and attendance_pull_enabled() else set()
    frozen: dict[int, set[int]] = {}
    if managed:
        from lcup.attendance_guard import FROZEN
        from lcup.models import GroupLinkStatus, LcupMembership

        rows = LcupMembership.objects.filter(
            group__classroom_id__in=managed,
            group__status=GroupLinkStatus.CONFIRMED,
            group__deleted_in_lcup_at__isnull=True,
            left_at__isnull=True,
            lcup_status=FROZEN,
            student__user__isnull=False,
        ).values_list("group__classroom_id", "student__user_id")
        for room_id, user_id in rows:
            frozen.setdefault(room_id, set()).add(user_id)
    return lcup_enabled(), managed, pushing, frozen


def _phase(interval, now: datetime) -> str:
    if interval is None:
        return PHASE_UNKNOWN
    starts_at, ends_at = interval
    if now < starts_at:
        return PHASE_UPCOMING
    if now < ends_at:
        return PHASE_NOW
    return PHASE_ENDED


def _iso(value: datetime | None) -> str | None:
    return timezone.localtime(value).isoformat() if value is not None else None


def lessons_today(day: date, *, now: datetime | None = None) -> dict:
    """The lessons of ``day`` as ``GET /api/classes/admin/lessons/today/`` reports them, judged at ``now``."""
    now = now or timezone.now()
    rooms = meeting_classrooms(day)
    room_ids = [room.pk for room in rooms]
    roster, seat_frozen = _rosters(room_ids, day) if room_ids else ({}, {})
    marks = _marks(room_ids, day) if room_ids else {}
    lcup_on, managed, pushing, lcup_frozen = _lcup(room_ids)

    timed, untimed = [], []
    for room in rooms:
        interval = lesson_interval(room, day)
        phase = _phase(interval, now)
        pushes = room.pk in pushing
        on_register = roster.get(room.pk, set())
        # lesson_check's "markable": frozen_in_lcup is empty for a class lc-up does not run while lc-up is
        # on (a seat status copied earlier says nothing), the seat's own word otherwise, plus lc-up's list.
        if lcup_on and room.pk not in managed:
            frozen = set()
        else:
            frozen = seat_frozen.get(room.pk, set()) | lcup_frozen.get(room.pk, set())
        counts = marks.get(room.pk) or {"marked": 0, **{name: 0 for name in MARKS}}
        row = {
            "classroom": {
                "id": room.pk,
                "name": room.name,
                "room": room.room_number or "",
                "branch": room.branch.name if room.branch_id else "",
            },
            # The class's teacher, as the /ops classroom list names them.
            "teacher": {"id": room.teacher_id, "name": display_name(room.teacher)} if room.teacher_id else None,
            "starts_at": _iso(interval[0]) if interval else None,
            "ends_at": _iso(interval[1]) if interval else None,
            "phase": phase,
            "register": {
                "roster": len(on_register),
                "marked": counts["marked"],
                **{name: counts[name] for name in MARKS},
                "taken": counts["marked"] > 0 or not (on_register - frozen),
                "state": REGISTER_STATE[marking_state(room, day, now=now, pushes_lcup=pushes)],
                "closes_at": _iso(marking_window(room, day, pushes_lcup=pushes)[1]),
            },
        }
        if interval:
            timed.append((interval[0], room.name, room.pk, row))
        else:
            untimed.append((room.name, room.pk, row))

    # By start, then name; a lesson with no readable time goes last, so the timed ones read as a timetable.
    lessons = [item[-1] for item in sorted(timed, key=lambda t: t[:3])]
    lessons += [item[-1] for item in sorted(untimed, key=lambda t: t[:2])]
    return {
        "date": day.isoformat(),
        "lessons": lessons,
        "counts": {
            "lessons": len(lessons),
            "now": sum(1 for row in lessons if row["phase"] == PHASE_NOW),
            # The ones someone can still fix: the lesson is over, nothing is marked, the register is open.
            "not_marked": sum(
                1 for row in lessons
                if row["phase"] == PHASE_ENDED and not row["register"]["taken"] and row["register"]["state"] == "open"
            ),
            "no_teacher": sum(1 for row in lessons if row["teacher"] is None),
        },
    }
