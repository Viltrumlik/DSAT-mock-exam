"""When a register may be written, and when it is shut.

The school's rule, in its own words: a teacher marks attendance *during* the lesson and for
at most two hours after it finishes. A lesson from 14:00 to 16:00 is markable until 18:00,
and after that the register is closed. Marking an older day is not possible at all.

**Why this exists.** Until now a register could be written at any time, for any date the
class had ever met. On 2026-08-26 a teacher opened two classes and swept ``Mark all present``
across their whole backlog: sixteen registers, for lessons going back weeks, marked in two
minutes for a student who had joined that same morning — and, because attendance pays the
moment a mark is saved (``rewards.hooks.sync_attendance_record``), each of those marks paid
5 points and 5 XP instantly. The student went to the top of the school leaderboard on lessons
he had not been enrolled for. Nothing in the platform said no, because nothing was asking.

So this module is the thing that asks. It is deliberately the *only* place the question is
answered: the mark endpoints, the mark-all-present endpoint and manual session creation all
route through :func:`marking_state`, so they cannot drift into three different rules.

**Three states, and the difference matters to the teacher reading them.**

``PENDING``  the lesson has not started. There is nothing to record yet; a register filled in
             before the room fills up is a guess.
``OPEN``     now.
``LOCKED``   the grace period has passed. What is written is what happened.

**The degraded case is not "locked".** One production classroom has a blank ``lesson_time``,
and free-text is free text — the next one will too. A class whose lesson times cannot be read
falls back to *its own calendar day*: markable from midnight to midnight, local time. That
still forbids backdating, which is the half of the rule that was being abused, and it never
locks a class out of taking a register at all — which would be a worse bug than the one being
fixed. ``schedule_is_usable`` makes the same judgement about ``lesson_days``.

**The override.** ``is_global_admin`` — super_admin, admin, Django superuser — writes through
a locked register. Not the classroom owner, and not the teacher: they are exactly who the
lock is for. Without *some* door a genuine mistake spotted at 20:30 could never be corrected,
and a register nobody can fix is its own integrity problem; with this one, correcting it is a
deliberate act by the school rather than a teacher quietly rewriting last month.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.utils import timezone

from .lesson_schedule import lesson_interval

#: How long after a lesson ENDS a teacher may still write its register. The school's number.
MARKING_GRACE_MINUTES = 120

STATE_PENDING = "PENDING"
STATE_OPEN = "OPEN"
STATE_LOCKED = "LOCKED"

#: What the teacher is told, per state. Kept here rather than in the views so the mark
#: endpoint, the mark-all endpoint and the create endpoint all refuse in the same words.
_REASON = {
    STATE_PENDING: "This lesson has not started yet. The register opens when the lesson begins.",
    STATE_LOCKED: (
        "This register is closed. Attendance can be taken during the lesson and for up to "
        f"{MARKING_GRACE_MINUTES // 60} hours afterwards."
    ),
}


def marking_window(classroom, day) -> tuple[datetime, datetime]:
    """``(opens_at, closes_at)`` for ``classroom``'s register on ``day``. Never ``None``.

    Opens when the lesson starts and closes :data:`MARKING_GRACE_MINUTES` after it ends. A
    classroom whose ``lesson_time`` cannot be read gets the whole of ``day`` instead — see
    the module docstring on why that is the right degradation.
    """
    interval = lesson_interval(classroom, day)
    if interval is None:
        tz = timezone.get_current_timezone()
        opens_at = timezone.make_aware(datetime.combine(day, time.min), tz)
        return opens_at, opens_at + timedelta(days=1)

    starts_at, ends_at = interval
    return starts_at, ends_at + timedelta(minutes=MARKING_GRACE_MINUTES)


def marking_state(classroom, day, *, now=None) -> str:
    """``PENDING`` / ``OPEN`` / ``LOCKED`` for one register."""
    now = now or timezone.now()
    opens_at, closes_at = marking_window(classroom, day)
    if now < opens_at:
        return STATE_PENDING
    if now > closes_at:
        return STATE_LOCKED
    return STATE_OPEN


def can_mark(classroom, day, *, now=None, user=None) -> bool:
    """Whether ``user`` may write this register right now.

    ``user`` is optional so callers that have already resolved the override (or are asking
    about the register rather than about a person) can leave it out.
    """
    if user is not None and _may_override(user):
        return True
    return marking_state(classroom, day, now=now) == STATE_OPEN


def refusal(classroom, day, *, now=None) -> str | None:
    """The sentence to hand a teacher who cannot write this register, or ``None``."""
    return _REASON.get(marking_state(classroom, day, now=now))


def _may_override(user) -> bool:
    from .capabilities import is_global_admin

    return is_global_admin(user)


def window_payload(classroom, day, *, now=None, user=None) -> dict:
    """The marking window as the API reports it, so the UI can disable rather than guess.

    ``can_mark`` already accounts for the override, and ``state`` deliberately does not: an
    admin editing a closed register should see that it *is* closed while being allowed to
    write to it. A UI that showed "open" would hide the fact that they are correcting
    history.
    """
    now = now or timezone.now()
    opens_at, closes_at = marking_window(classroom, day)
    state = marking_state(classroom, day, now=now)
    override = user is not None and _may_override(user)
    return {
        "state": state,
        "opens_at": opens_at.isoformat(),
        "closes_at": closes_at.isoformat(),
        "can_mark": state == STATE_OPEN or override,
        "is_override": override and state != STATE_OPEN,
        "reason": _REASON.get(state),
    }
