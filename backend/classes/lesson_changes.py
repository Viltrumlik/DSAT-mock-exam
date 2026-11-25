"""A lesson day called off, moved to another day, or a centre holiday (owner, 2026-11-25).

* **Cancel** (a reason is required): that day is not charged. A lesson already charged is voided with the reason.
* **Move** (a new day and a reason): the old day is not charged; the lesson is charged once, on the new day.
* **Centre holiday** (a day and a reason): a cancel with no class, for every group with a lesson that day.
* **Undo**: the day is as the timetable says again. Nothing is deleted; who, when and why stay on the row.

A change and its money are one transaction (``billing.lesson_money``): the change is written, then its money. A
refusal is raised as ``ChangeRefused`` in words for the admin, before anything is written.

Days are the class's own weekdays (``seat_actions.weekdays_of``: ISO, Monday = 1), never
``lesson_schedule.LESSON_WEEKDAYS`` (Python's, Monday = 0).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import NamedTuple

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from .models_lesson_changes import LessonChange
from .seat_actions import weekdays_of

#: The days an admin may change: from a month back to two months ahead (Ruling 4 of 2026-11-25).
DAYS_BACK = 31
DAYS_AHEAD = 60
REASON_MAX = 300
#: The 409 a class delete answers when its lesson changes stop it (``LessonChange.classroom`` is PROTECT), beside
#: ``students_in_class``: they are its money's history, so it is archived instead.
DELETE_REFUSED = {
    "detail": "This class has cancelled or moved lessons on record; archive it instead.",
    "code": "lesson_changes",
}

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


class ChangeRefused(Exception):
    """Why this lesson day cannot be changed, in words for the admin."""


class DayChanges(NamedTuple):
    #: The days with no lesson by the timetable's rule: called off, moved away, or a centre holiday.
    off: frozenset[date]
    #: Each live move's original day → its new day.
    moved: dict[date, date]


def short(day: date) -> str:
    """How the console says a day: "8 Dec"."""
    return f"{day.day} {_MONTHS[day.month - 1]}"


def _live():
    return LessonChange.objects.filter(undone_at__isnull=True)


def _touching(classroom_id: int | None):
    """The live changes that touch a class: its own and every centre holiday; only the holidays without a class."""
    holidays = Q(classroom__isnull=True)
    return _live().filter(holidays if classroom_id is None else holidays | Q(classroom_id=classroom_id))


def day_changes(classroom_id: int | None, start: date, end: date) -> DayChanges:
    """DayChanges(off: frozenset[date], moved: dict[date, date]) for that class in [start, end]: ``off`` = its
    cancelled days + every centre holiday + its moved-away days; ``moved`` = original day → new day for its live
    moves.

    A move belongs here when either of its days is inside, so a caller checks the new day against its own range.
    Without a class (a seat lc-up never paired) only the holidays count."""
    rows = list(
        _touching(classroom_id)
        .filter(Q(day__range=(start, end)) | Q(new_day__range=(start, end)))
        .values_list("day", "kind", "new_day")
    )
    off = frozenset(day for day, _, _ in rows if start <= day <= end)
    moved = {day: new_day for day, kind, new_day in rows if kind == LessonChange.Kind.MOVE}
    return DayChanges(off, moved)


def is_lesson_day(room, day: date) -> bool:
    """Whether ``room`` holds a lesson on ``day``: its weekdays, minus its days off, plus the lessons moved in."""
    changes = day_changes(room.pk, day, day)
    if day in changes.off:
        return False
    return day.isoweekday() in weekdays_of(room) or day in changes.moved.values()


# ── The rules ────────────────────────────────────────────────────────────────────────────────────────────────


def _reason(reason) -> str:
    text = str(reason or "").strip()
    if not text:
        raise ChangeRefused("A lesson change needs a reason.")
    if len(text) > REASON_MAX:
        raise ChangeRefused(f"The reason is at most {REASON_MAX} characters.")
    return text


def _check_window(day: date, today: date) -> None:
    first, last = today - timedelta(days=DAYS_BACK), today + timedelta(days=DAYS_AHEAD)
    if not first <= day <= last:
        raise ChangeRefused(f"Only a day from {short(first)} to {short(last)} can be changed.")


def _holiday_on(day: date) -> bool:
    return _live().filter(classroom__isnull=True, day=day).exists()


def _check_class_day(room, day: date) -> None:
    """``day`` is one of the class's weekday lesson days, and nothing has changed it yet."""
    if day.isoweekday() not in weekdays_of(room):
        raise ChangeRefused(f"{room.name} has no lesson on {short(day)}.")
    if _live().filter(classroom=room, day=day).exists():
        raise ChangeRefused(f"{room.name}'s lesson on {short(day)} was already changed. Undo that first.")


def _create(**fields) -> LessonChange:
    try:
        with transaction.atomic():
            return LessonChange.objects.create(**fields)
    except IntegrityError:  # another admin changed the same day a moment ago
        raise ChangeRefused("This day was changed a moment ago. Reload the page.") from None


def _with_money(change: LessonChange, *, today: date, by) -> LessonChange:
    # Here, not at the top: billing imports this module too (``ledger._bill_lessons``), so neither loads the other
    # while it is itself being loaded.
    from billing import lesson_money

    change.money = lesson_money.apply(change, today=today, by=by)
    return change


@transaction.atomic
def cancel(room, day: date, reason, *, by, today: date) -> LessonChange:
    """Call off ``room``'s lesson on ``day``; ``room=None`` is a centre holiday, every group with a lesson that day.
    The change comes back with ``money``, what it gave back (``billing.lesson_money.apply``)."""
    reason = _reason(reason)
    _check_window(day, today)
    if room is None:
        if _holiday_on(day):
            raise ChangeRefused(f"{short(day)} is already a centre holiday.")
        moved_in = _live().filter(kind=LessonChange.Kind.MOVE, new_day=day).select_related("classroom").first()
        if moved_in is not None:
            # A lesson moved to a holiday would still be charged: the new day of a move is never a holiday.
            raise ChangeRefused(
                f"A lesson of {moved_in.classroom.name} was moved to {short(day)}. Undo that move first."
            )
    else:
        _check_class_day(room, day)
        if _holiday_on(day):
            raise ChangeRefused(f"{short(day)} is a centre holiday already.")
    change = _create(classroom=room, day=day, kind=LessonChange.Kind.CANCEL, reason=reason, created_by=by)
    return _with_money(change, today=today, by=by)


@transaction.atomic
def move(room, day: date, new_day: date, reason, *, by, today: date) -> LessonChange:
    """Move ``room``'s lesson of ``day`` to ``new_day``: charged once, on the new day."""
    reason = _reason(reason)
    _check_window(day, today)
    _check_window(new_day, today)
    _check_class_day(room, day)
    if new_day == day:
        raise ChangeRefused("Choose another day to move the lesson to.")
    if _holiday_on(new_day):
        raise ChangeRefused(f"{short(new_day)} is a centre holiday.")
    # A class has one register a day (``uniq_attendance_session_per_day``): a second lesson on a day it already
    # meets would be charged with nowhere to be marked.
    if new_day.isoweekday() in weekdays_of(room):
        raise ChangeRefused(f"{room.name} already has a lesson on {short(new_day)}. Choose a day it does not meet.")
    if _live().filter(classroom=room, kind=LessonChange.Kind.MOVE, new_day=new_day).exists():
        raise ChangeRefused(f"Another lesson of {room.name} was moved to {short(new_day)} already. Choose another day.")
    change = _create(
        classroom=room, day=day, kind=LessonChange.Kind.MOVE, new_day=new_day, reason=reason, created_by=by
    )
    return _with_money(change, today=today, by=by)


@transaction.atomic
def undo(change: LessonChange, *, by, today: date) -> LessonChange:
    """The day is as the timetable says again; its lesson is charged by the next tick (``revert`` does it now)."""
    from billing import lesson_money

    change = LessonChange.objects.select_for_update().get(pk=change.pk)
    if change.undone_at is not None:
        raise ChangeRefused("This change was undone already.")
    _check_window(change.day, today)
    change.undone_at, change.undone_by = timezone.now(), by
    change.save(update_fields=["undone_at", "undone_by"])
    change.money = lesson_money.revert(change, today=today, by=by)
    return change
