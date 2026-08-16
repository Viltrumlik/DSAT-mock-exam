"""Support-booking rules.

The one rule the school stated: **a student may only book a support teacher assigned to a
classroom that student is in.** Everything here exists to make that true and to keep it true
when someone leaves a class.

Eligibility is computed from live membership on every call rather than snapshotted onto the
booking. A student removed from a class stops being able to book its support teachers
immediately, which is the point — a snapshot would keep the door open until someone noticed.
"""

from __future__ import annotations

from datetime import datetime, time as dt_time, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from access import constants as acc_const
from access.services import normalized_role
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone

from .models import Classroom, ClassroomMembership
from .models_support import SupportAvailability, SupportBooking

#: The support desk keeps school hours: bookable on the hour from 08:00, last session
#: starting at 17:00 and ending as the desk closes at 18:00, four days out including today.
#:
#: Every hour in that window is open **by default**. Before this, a support teacher had to
#: publish each slot by hand, so a student whose teacher had published nothing saw an empty
#: page and concluded there was no help to be had — which was never true. A published row now
#: means one of two exceptions to the default: a larger group (``capacity``), or an hour the
#: teacher has withdrawn (``is_cancelled``). Absence of a row means simply "free".
CALENDAR_DAYS = 4
CALENDAR_OPEN_HOUR = 8
CALENDAR_CLOSE_HOUR = 18
SLOT_MINUTES = 60

#: How many hours one student may hold at once, and how many they may take in a week.
#:
#: Both exist because the desk is a shared, finite thing: every seat one student holds is an
#: hour another cannot book, and an unlimited calendar rewards whoever clicks first rather
#: than whoever needs it. The two limits answer different abuses — MAX_UPCOMING stops a
#: student sitting on the whole week, MAX_PER_WEEK stops them cycling through it a session at
#: a time as each one is settled.
#:
#: The numbers are the school's to set; they are named here so changing them is one edit and
#: the UI reads them off the API rather than hard-coding a second copy.
MAX_UPCOMING_BOOKINGS = 2
MAX_BOOKINGS_PER_WEEK = 3
#: The rolling window MAX_BOOKINGS_PER_WEEK is counted over, ending now.
BOOKING_WEEK_DAYS = 7


def _active_student_classroom_ids(student):
    return ClassroomMembership.objects.filter(
        user=student,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).values_list("classroom_id", flat=True)


#: A classroom TA membership alone does not make a support desk — the account has to be a
#: support teacher too. There are two doors onto ROLE_TA and only one of them checks:
#: ``SupportTeacherAssignView`` requires ``role == ROLE_SUPPORT_TEACHER``, while the roster's
#: "Make TA" button (``views_roster.MemberManageView``) lets an owner promote any member.
#:
#: That was harmless while slots had to be published: a plain student or teacher holding a TA
#: membership could never publish one, so they never appeared. Opt-out hours changed that —
#: they would be advertised as bookable 08:00–18:00 without lifting a finger, and every
#: endpoint that would let them see or withdraw those hours 403s on the same account role.
#: Students would book a desk nobody is going to attend.
SUPPORT_ACCOUNT_ROLE = acc_const.ROLE_SUPPORT_TEACHER


def _support_classroom_ids(support_teacher):
    if normalized_role(support_teacher) != SUPPORT_ACCOUNT_ROLE:
        return ClassroomMembership.objects.none().values_list("classroom_id", flat=True)
    return ClassroomMembership.objects.filter(
        user=support_teacher,
        role=ClassroomMembership.ROLE_TA,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).values_list("classroom_id", flat=True)


def shared_classrooms(student, support_teacher):
    """Classrooms where this student is taught and this support teacher is assigned."""
    return Classroom.objects.filter(
        id__in=set(_active_student_classroom_ids(student))
        & set(_support_classroom_ids(support_teacher))
    )


def bookable_support_teacher_ids(student) -> set[int]:
    """Support teachers the student is entitled to book — i.e. assigned to one of their
    classrooms. An empty set is the correct answer for a student in no classes."""
    classroom_ids = list(_active_student_classroom_ids(student))
    if not classroom_ids:
        return set()
    return set(
        ClassroomMembership.objects.filter(
            classroom_id__in=classroom_ids,
            role=ClassroomMembership.ROLE_TA,
            status=ClassroomMembership.STATUS_ACTIVE,
            # See SUPPORT_ACCOUNT_ROLE: the membership and the account must agree.
            user__role=SUPPORT_ACCOUNT_ROLE,
        ).values_list("user_id", flat=True)
    )


def open_slots_for(student, *, now=None):
    """Future, uncancelled slots the student may actually book.

    Seats are deliberately NOT filtered here — a full slot still belongs on the student's
    screen, shown as full. Hiding it makes a slot the student can see on Monday vanish on
    Tuesday with no explanation.
    """
    now = now or timezone.now()
    teacher_ids = bookable_support_teacher_ids(student)
    if not teacher_ids:
        return SupportAvailability.objects.none()
    return (
        SupportAvailability.objects.filter(
            support_teacher_id__in=teacher_ids,
            is_cancelled=False,
            starts_at__gt=now,
        )
        .select_related("support_teacher")
        .order_by("starts_at", "id")
    )


def booking_allowance(student, *, now=None, exclude_booking_id=None) -> dict:
    """How much of their allowance this student has left, and why.

    Returned rather than raised so the calendar can say "1 of 2 left" before the student
    picks an hour, instead of letting them choose one and then refusing it.

    A CANCELLED booking counts towards neither limit. Giving a seat back is the behaviour the
    limits are trying to encourage, so charging for it would punish exactly the student who
    did the right thing. ``exclude_booking_id`` lets the booking path ignore the row it is
    about to reuse — re-booking a slot updates the existing row, and counting it would make
    the student's own cancelled seat block them.
    """
    now = now or timezone.now()
    mine = SupportBooking.objects.filter(student=student).exclude(
        status=SupportBooking.STATUS_CANCELLED
    )
    if exclude_booking_id is not None:
        mine = mine.exclude(pk=exclude_booking_id)

    upcoming = mine.filter(
        status=SupportBooking.STATUS_BOOKED, availability__starts_at__gt=now
    ).count()
    # Counted on when the seat was TAKEN, not when the hour falls. Counting by hour needs a
    # window with two edges and makes the answer depend on where "this week" is cut; counting
    # by ``booked_at`` is one rolling edge and says the plain thing — how many hours you have
    # claimed in the last seven days.
    this_week = mine.filter(booked_at__gt=now - timedelta(days=BOOKING_WEEK_DAYS)).count()

    return {
        "upcoming": upcoming,
        "max_upcoming": MAX_UPCOMING_BOOKINGS,
        "this_week": this_week,
        "max_per_week": MAX_BOOKINGS_PER_WEEK,
        "can_book": upcoming < MAX_UPCOMING_BOOKINGS and this_week < MAX_BOOKINGS_PER_WEEK,
    }


def _check_booking_allowance(student, *, now=None, exclude_booking_id=None) -> None:
    """Raise a student-readable ValidationError when they are at a limit."""
    allowance = booking_allowance(
        student, now=now, exclude_booking_id=exclude_booking_id
    )
    if allowance["upcoming"] >= MAX_UPCOMING_BOOKINGS:
        raise ValidationError(
            f"You already have {allowance['upcoming']} support "
            f"session{'' if allowance['upcoming'] == 1 else 's'} booked. Attend one, or "
            f"cancel it, and you can book again."
        )
    if allowance["this_week"] >= MAX_BOOKINGS_PER_WEEK:
        raise ValidationError(
            f"You can book {MAX_BOOKINGS_PER_WEEK} support sessions a week, and you have "
            f"used them all. Your next one opens up as this week's sessions pass."
        )


def calendar_dates(now=None, *, days: int = CALENDAR_DAYS) -> list:
    """The dates the calendar covers — today first, in the school's own timezone."""
    today = timezone.localdate(now or timezone.now())
    return [today + timedelta(days=i) for i in range(days)]


def _hour_start(day, hour: int):
    """An aware datetime for ``hour`` o'clock on ``day``, read in the school's timezone."""
    return timezone.make_aware(
        datetime.combine(day, dt_time(hour=hour)), timezone.get_current_timezone()
    )


def _row_covering(candidates, hour_start, hour_end):
    """The published row that governs one hour of the calendar, if any.

    **Overlap, not equality.** Keying on the exact hour instant was wrong: the teacher's form
    takes free-form start/end datetimes, so a 14:00–17:00 block only ever matched its first
    hour. Withdrawing that block left 15:00 and 16:00 reading "open" and bookable — a student
    could take a seat inside the block their teacher had just closed. Off-the-hour rows
    (09:30–10:30) matched nothing at all and were invisible.

    A withdrawal wins over a publication: if any part of the hour is blocked, the hour is not
    free.

    Among publications, **the most recently touched one governs**. Ordering by earliest start
    instead was a regression this same overlap change introduced: the write path keys on the
    exact ``starts_at``, so a teacher who published 14:00–17:00 and then narrowed 15:00–16:00
    got a second row that no hour ever consulted — the older, wider block kept winning and the
    edit read as a silent no-op.

    ``updated_at``, not ``created_at`` or ``id``: republishing an hour updates the row in
    place, so creation order stops tracking what the teacher last said. ``id`` breaks the tie
    for two rows saved in the same tick, which keeps the answer a total order.
    """
    hits = [r for r in candidates if r.starts_at < hour_end and r.ends_at > hour_start]
    if not hits:
        return None
    blocked = [r for r in hits if r.is_cancelled]
    return max(blocked or hits, key=lambda r: (r.updated_at, r.id))


def open_calendar_for(student, *, now=None, days: int = CALENDAR_DAYS) -> list[dict]:
    """The bookable week ahead, one entry per support teacher the student may book.

    Every hour of the window is reported, including the ones that cannot be booked — an hour
    that is full or withdrawn is a fact the student needs, and silently dropping it makes the
    calendar look sparse for no stated reason.
    """
    now = now or timezone.now()
    teacher_ids = bookable_support_teacher_ids(student)
    if not teacher_ids:
        return []

    dates = calendar_dates(now, days=days)
    window_start = _hour_start(dates[0], CALENDAR_OPEN_HOUR)
    window_end = _hour_start(dates[-1], CALENDAR_CLOSE_HOUR)

    # Rows that OVERLAP the window, not just ones that start inside it — a block running from
    # before the window into it still governs the hours it covers.
    rows = list(
        SupportAvailability.objects.filter(
            support_teacher_id__in=teacher_ids,
            starts_at__lt=window_end,
            ends_at__gt=window_start,
        )
    )
    by_teacher: dict[int, list] = {}
    for r in rows:
        by_teacher.setdefault(r.support_teacher_id, []).append(r)
    row_ids = [r.id for r in rows]
    taken = dict(
        SupportBooking.objects.filter(
            availability_id__in=row_ids, status__in=SupportBooking.OCCUPYING_STATUSES
        )
        .values("availability_id")
        .annotate(n=Count("id"))
        .values_list("availability_id", "n")
    )
    mine = dict(
        SupportBooking.objects.filter(
            availability_id__in=row_ids, student=student, status=SupportBooking.STATUS_BOOKED
        ).values_list("availability_id", "id")
    )

    teachers = get_user_model().objects.filter(id__in=teacher_ids).order_by("first_name", "id")
    out = []
    for teacher in teachers:
        candidates = by_teacher.get(teacher.id, [])
        days_out = []
        for day in dates:
            hours = []
            for hour in range(CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR):
                starts_at = _hour_start(day, hour)
                ends_at = starts_at + timedelta(minutes=SLOT_MINUTES)
                row = _row_covering(candidates, starts_at, ends_at)
                capacity = int(row.capacity) if row else 1
                seats_left = max(0, capacity - taken.get(row.id, 0)) if row else capacity
                booking_id = mine.get(row.id) if row else None

                if booking_id is not None:
                    state = "mine"
                elif starts_at <= now:
                    state = "past"
                elif row is not None and row.is_cancelled:
                    state = "closed"
                elif seats_left <= 0:
                    state = "full"
                else:
                    state = "open"

                hours.append({
                    "starts_at": starts_at,
                    "ends_at": ends_at,
                    "state": state,
                    "capacity": capacity,
                    "seats_left": seats_left,
                    "note": row.note if row else "",
                    "availability_id": row.id if row else None,
                    "booking_id": booking_id,
                })
            days_out.append({"date": day, "hours": hours})
        out.append({
            "teacher": teacher,
            "classrooms": list(shared_classrooms(student, teacher)),
            "days": days_out,
        })
    return out


def _desk_week(rows, bookings_by_row, dates, now) -> list[dict]:
    """The hour-by-hour state of one desk's week, from rows already in memory.

    Factored out of :func:`teacher_calendar_for` so the admin overview counts a teacher's
    free and withdrawn hours with the **same** code that renders their grid. Counting them
    a second way is how a headline number ends up disagreeing with the list underneath it —
    ``_row_covering``'s overlap-and-recency rules are subtle enough that a reimplementation
    would drift on the first off-the-hour row.
    """
    out = []
    for day in dates:
        hours = []
        for hour in range(CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR):
            starts_at = _hour_start(day, hour)
            ends_at = starts_at + timedelta(minutes=SLOT_MINUTES)
            row = _row_covering(rows, starts_at, ends_at)
            capacity = int(row.capacity) if row else 1
            booked = [
                b for b in bookings_by_row.get(row.id, [])
                if b.status == SupportBooking.STATUS_BOOKED
            ] if row else []
            settled = [
                b for b in bookings_by_row.get(row.id, [])
                if b.status != SupportBooking.STATUS_BOOKED
            ] if row else []

            if row is not None and row.is_cancelled:
                state = "closed"
            elif booked or settled:
                state = "booked"
            elif starts_at <= now:
                state = "past"
            else:
                state = "open"

            hours.append({
                "starts_at": starts_at,
                "ends_at": ends_at,
                "state": state,
                "capacity": capacity,
                "seats_left": max(0, capacity - len(booked)),
                "note": row.note if row else "",
                "availability_id": row.id if row else None,
                "bookings": booked + settled,
            })
        out.append({"date": day, "hours": hours})
    return out


def teacher_calendar_for(support_teacher, *, now=None, days: int = CALENDAR_DAYS) -> list[dict]:
    """The same week the students see, from behind the desk.

    The teacher's job on this calendar is not "publish hours" — every hour is open by
    default — it is to see who is coming and to withdraw the hours they cannot do. So each
    hour carries its bookings, not just a seat count, and ``state`` names what the teacher
    needs to act on: ``booked`` outranks ``open`` because a booked hour is an appointment,
    and ``closed`` outranks everything because a withdrawn hour is a decision they made.
    """
    now = now or timezone.now()
    dates = calendar_dates(now, days=days)
    window_start = _hour_start(dates[0], CALENDAR_OPEN_HOUR)
    window_end = _hour_start(dates[-1], CALENDAR_CLOSE_HOUR)

    rows = list(
        SupportAvailability.objects.filter(
            support_teacher=support_teacher,
            starts_at__lt=window_end,
            ends_at__gt=window_start,
        )
    )
    bookings_by_row: dict[int, list] = {}
    for b in (
        SupportBooking.objects.filter(availability_id__in=[r.id for r in rows])
        .exclude(status=SupportBooking.STATUS_CANCELLED)
        .select_related("student", "classroom")
        .order_by("id")
    ):
        bookings_by_row.setdefault(b.availability_id, []).append(b)

    return _desk_week(rows, bookings_by_row, dates, now)


def slot_for(support_teacher, starts_at, *, now=None, days: int = CALENDAR_DAYS):
    """Turn an open hour on the calendar into a real row, so a booking has something to hold.

    The window is re-checked here rather than trusted from the client: the calendar the
    student is looking at may have been rendered yesterday, and the hour they are clicking may
    since have fallen out of the window or into the past.
    """
    now = now or timezone.now()
    local = timezone.localtime(starts_at)
    if local.minute or local.second or local.microsecond:
        raise ValidationError("Support sessions start on the hour.")
    if not (CALENDAR_OPEN_HOUR <= local.hour < CALENDAR_CLOSE_HOUR):
        raise ValidationError(
            f"The support desk is open {CALENDAR_OPEN_HOUR:02d}:00–{CALENDAR_CLOSE_HOUR:02d}:00."
        )
    allowed = calendar_dates(now, days=days)
    if local.date() not in allowed:
        raise ValidationError(f"You can book up to {days} days ahead.")
    # The docstring above promised this and the code did not do it: a student who left the
    # page open across an hour boundary could click 09:00 at 09:05 and mint a row for an hour
    # already gone, which ``book`` would then refuse.
    if starts_at <= now:
        raise ValidationError("That hour has already started.")

    ends_at = starts_at + timedelta(minutes=SLOT_MINUTES)
    # An hour already governed by a published block belongs to that block — including a block
    # the teacher withdrew. Minting a fresh row here would hand the student a seat inside a
    # closed afternoon, because a new row is never cancelled.
    existing = _row_covering(
        SupportAvailability.objects.filter(
            support_teacher=support_teacher, starts_at__lt=ends_at, ends_at__gt=starts_at
        ),
        starts_at,
        ends_at,
    )
    if existing is not None:
        return existing

    slot, _ = SupportAvailability.objects.get_or_create(
        support_teacher=support_teacher,
        starts_at=starts_at,
        defaults={"ends_at": ends_at, "capacity": 1},
    )
    return slot


# ── Telling people ────────────────────────────────────────────────────────────
#
# Three notification events for the support desk have existed since the notifications app
# shipped — ``SUPPORT_BOOKED``, ``SUPPORT_CANCELLED``, ``REWARD_EARNED`` — and until now not
# one of them had a caller anywhere in the codebase. A support teacher learned they had an
# appointment only by opening their page; a student learned a session had paid only by
# opening a different one.
#
# ``notify`` never raises, and returns ``None`` when the recipient has muted the category or
# has already been told, so none of this can break a booking. It is called inside the
# caller's transaction on purpose: a notification about a booking that then rolls back is
# worse than no notification at all.


def _person(user) -> str:
    """A name for somebody in a sentence, never an empty string."""
    name = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
    return name or getattr(user, "username", None) or getattr(user, "email", None) or "Someone"


def _when(dt) -> str:
    """An hour written in the school's own timezone, not the server's."""
    return timezone.localtime(dt).strftime("%a %d %b, %H:%M")


def _notify_teacher_booked(booking) -> None:
    from notifications import constants as note_const
    from notifications.services import notify

    notify(
        booking.availability.support_teacher,
        event=note_const.EVENT_SUPPORT_BOOKED,
        title=f"{_person(booking.student)} booked a support session",
        body=" · ".join(
            p for p in (_when(booking.availability.starts_at), booking.topic) if p
        ),
        link_url="/teacher/support",
        # Keyed on the booking, so a student who cancels and retakes the same seat inside
        # the dedupe window does not ring the bell twice for one appointment.
        dedupe_key=f"support-booked:{booking.id}",
    )


def _notify_teacher_cancelled(booking) -> None:
    from notifications import constants as note_const
    from notifications.services import notify

    notify(
        booking.availability.support_teacher,
        event=note_const.EVENT_SUPPORT_CANCELLED,
        title=f"{_person(booking.student)} cancelled",
        # The reason travels with it. The teacher held that hour open and nobody else could
        # take it, which is the whole reason a student is made to give one.
        body=" · ".join(
            p for p in (_when(booking.availability.starts_at), booking.cancel_reason) if p
        ),
        link_url="/teacher/support",
        dedupe_key=f"support-cancelled:{booking.id}",
    )


def _notify_student_awarded(booking) -> None:
    """Name the earning at the moment it happens.

    Reads the figure back out of the ledger rather than quoting the rule: the rule can be
    retuned, an award can be priced at zero, and ``RewardRule.grants_xp`` can put an event
    outside XP entirely. Telling a student "+10 XP" from a constant while the ledger says
    something else is the one failure mode this is here to prevent.
    """
    from notifications import constants as note_const
    from notifications.services import notify

    award = award_for(booking)
    if award is None:
        # Recorded, but it paid nothing — priced at zero, or the write failed and was
        # already logged. Announcing an earning that is not in the ledger would be a lie
        # the student can check.
        return
    points, xp = award["points"], award["xp"]
    if points and xp:
        earned = f"+{points} points and +{xp} XP"
    elif xp:
        earned = f"+{xp} XP"
    else:
        earned = f"+{points} points"

    notify(
        booking.student,
        event=note_const.EVENT_REWARD_EARNED,
        title=f"You earned {earned}",
        body=(
            f"{_person(booking.availability.support_teacher)} confirmed your support "
            f"session on {_when(booking.availability.starts_at)}."
        ),
        # To the session, not the ledger: the teacher's note on what the hour covered is
        # worth more to the student than the row that paid for it.
        link_url="/support",
        dedupe_key=f"support-award:{booking.id}",
    )


@transaction.atomic
def book_at(student, support_teacher, starts_at, *, classroom=None, topic: str = "", now=None):
    """Book an hour off the calendar, materialising its row only if the booking sticks.

    One transaction on purpose. ``slot_for`` used to run outside it, so every refused
    booking — wrong class, slot full, already settled — left behind an availability row the
    teacher never published and cannot see.
    """
    slot = slot_for(support_teacher, starts_at, now=now)
    return book(student, slot, classroom=classroom, topic=topic, now=now)


@transaction.atomic
def book(student, availability, *, classroom=None, topic: str = "", now=None) -> SupportBooking:
    """Claim a seat. Raises ``ValidationError`` with a student-readable message."""
    now = now or timezone.now()

    # Re-read under a lock: two students clicking the last seat at once must not both win.
    availability = SupportAvailability.objects.select_for_update().get(pk=availability.pk)

    if availability.is_cancelled:
        raise ValidationError("That slot has been cancelled.")
    if availability.starts_at <= now:
        raise ValidationError("That slot has already started.")

    shared = shared_classrooms(student, availability.support_teacher)
    if not shared.exists():
        raise ValidationError(
            "You can only book a support teacher assigned to one of your classes."
        )
    if classroom is not None and classroom.id not in {c.id for c in shared}:
        raise ValidationError("That class is not one you share with this support teacher.")
    if classroom is None:
        # One shared class is the common case and needs no question; with several, the
        # booking is simply not attributed rather than guessing wrong.
        classroom = shared.first() if shared.count() == 1 else None

    existing = SupportBooking.objects.filter(
        availability=availability, student=student
    ).first()
    if existing is not None and existing.status == SupportBooking.STATUS_BOOKED:
        raise ValidationError("You have already booked that slot.")
    if existing is not None and existing.status in (
        SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW
    ):
        # A settled session is the teacher's record. Re-booking reuses the row, so allowing
        # it here would let a student erase a NO_SHOW — or overwrite a HELD and silently
        # revoke their own 10 points — by pressing Book again.
        raise ValidationError("That session has already been settled.")

    # After the entitlement checks and before the seat is taken. Checked here rather than in
    # the view so book() and book_at() cannot diverge, and so a management path gets the same
    # answer as a student clicking a chip.
    _check_booking_allowance(
        student, now=now, exclude_booking_id=existing.pk if existing else None
    )

    taken = SupportBooking.objects.filter(
        availability=availability, status__in=SupportBooking.OCCUPYING_STATUSES
    ).count()
    if taken >= int(availability.capacity):
        raise ValidationError("That slot is full.")

    if existing is not None:
        # Re-booking after a cancellation reuses the row, so the reward key stays stable.
        existing.status = SupportBooking.STATUS_BOOKED
        existing.classroom = classroom
        existing.topic = topic or existing.topic
        existing.settled_at = None
        existing.settled_by = None
        # The previous cancellation is history the moment the seat is retaken. Leaving it
        # behind would show the teacher a live booking labelled with why it was called off.
        existing.cancel_reason = ""
        existing.cancelled_at = None
        existing.cancelled_by = None
        existing.save(update_fields=[
            "status", "classroom", "topic", "settled_at", "settled_by",
            "cancel_reason", "cancelled_at", "cancelled_by", "updated_at",
        ])
        booking = existing
    else:
        booking = SupportBooking.objects.create(
            availability=availability, student=student, classroom=classroom,
            topic=topic, status=SupportBooking.STATUS_BOOKED,
        )

    _notify_teacher_booked(booking)
    return booking


@transaction.atomic
def cancel(booking, *, actor=None, reason: str = "", now=None) -> SupportBooking:
    """Give the seat back, on the record. Settled bookings are history and cannot be
    cancelled.

    ``reason`` is optional *here* on purpose: the view requires one from a student, but the
    slot-withdrawal path cancels other people's bookings on their behalf and supplies its
    own. A blank reason from a student would be a bug in the view, not in this function.
    """
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status in (SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW):
        raise ValidationError("That session has already been settled.")
    booking.status = SupportBooking.STATUS_CANCELLED
    booking.settled_at = None
    booking.cancel_reason = (reason or "").strip()[:280]
    booking.cancelled_at = now or timezone.now()
    booking.cancelled_by = actor
    booking.save(update_fields=[
        "status", "settled_at", "cancel_reason", "cancelled_at", "cancelled_by", "updated_at",
    ])
    # Only when the student is the one calling it off. The other caller is the teacher
    # withdrawing their own hour, and telling somebody what they just did themselves is
    # noise that teaches them to stop reading the bell.
    if actor is not None and actor.id == booking.student_id:
        _notify_teacher_cancelled(booking)
    return booking


@transaction.atomic
def settle(booking, status: str, *, actor=None, now=None, teacher_note: str = "") -> SupportBooking:
    """Record whether the session actually happened.

    ``HELD`` is what earns the student their points, which is why only the support teacher
    (or an admin) may set it — enforced by the view, since this function is also used by
    management paths.
    """
    if status not in (SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW):
        raise ValidationError("A session is settled as held or not attended.")
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status == SupportBooking.STATUS_CANCELLED:
        raise ValidationError("That booking was cancelled.")
    was = booking.status
    booking.status = status
    booking.settled_at = now or timezone.now()
    booking.settled_by = actor
    note = (teacher_note or "").strip()[:500]
    fields = ["status", "settled_at", "settled_by", "updated_at"]
    if note:
        # Only overwritten when something was typed: re-settling to fix a mis-click must not
        # silently wipe the note the teacher wrote the first time.
        booking.teacher_note = note
        fields.append("teacher_note")
    booking.save(update_fields=fields)

    # The save above is what fires the reward hook, so the ledger row exists by now and the
    # student can be told the actual figure rather than a promise of one.
    #
    # On the TRANSITION only. Re-settling an already-held session to fix its note must not
    # announce a second payment for the same hour — the award is idempotent, and the
    # notification has to be too or the ledger and the bell stop agreeing.
    if status == SupportBooking.STATUS_HELD and was != SupportBooking.STATUS_HELD:
        _notify_student_awarded(booking)
    return booking


@transaction.atomic
def rate(booking, rating: int, *, comment: str = "", now=None) -> SupportBooking:
    """The student's verdict on the hour they were given.

    Only a HELD session can be rated — there is nothing to judge about a session that was
    cancelled, missed, or has not happened yet. Re-rating overwrites, so a student who
    misclicks 1 is not stuck with it.

    This deliberately does not touch points. Settling as HELD is what pays, whatever the
    rating says; making the money depend on the review would put the teacher's interest
    against the student's honesty.
    """
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status != SupportBooking.STATUS_HELD:
        raise ValidationError("You can rate a session once your teacher marks it attended.")
    try:
        value = int(rating)
    except (TypeError, ValueError):
        raise ValidationError("Choose a rating from 1 to 5.") from None
    if not (SupportBooking.RATING_MIN <= value <= SupportBooking.RATING_MAX):
        raise ValidationError("Choose a rating from 1 to 5.")

    booking.rating = value
    booking.rating_comment = (comment or "").strip()[:500]
    booking.rated_at = now or timezone.now()
    booking.save(update_fields=["rating", "rating_comment", "rated_at", "updated_at"])
    return booking


# ── What the session paid ─────────────────────────────────────────────────────
#
# The award itself is written by ``rewards.hooks.sync_support_booking`` on the booking's
# post_save, and has been since the desk shipped. What was missing is anybody ever being
# told: the student's page said "points arrive once your teacher confirms you attended" and
# then, when they did, showed a green tick and nothing else. These read the ledger back so
# the earning can be named at the moment it happens.
#
# Read, never written, from here. The ledger has exactly one writer (``rewards.services``)
# and a second one would be the end of "why did I get 10?" being answerable.


def awards_for(bookings) -> dict[int, dict]:
    """``{booking_id: {"points": int, "xp": int}}``, for the sessions that actually paid.

    One query for a whole list, because the diary and the student's own booking list are
    both lists — a per-row lookup here would be an N+1 on the page a teacher opens most.

    **Only a HELD booking carries an earning**, and that gate is on the booking's status
    rather than on the ledger row alone. Revoking an award zeroes its points but is
    documented to leave XP standing — "XP is never taken away" — so a session corrected
    from HELD to NO_SHOW keeps a live XP figure in the ledger for as long as the student
    keeps the XP. That is the right answer for the reward board and the wrong one here:
    a row labelled "Missed" must not also say "+10 XP". The retained XP is a platform-wide
    rule and belongs on the rewards page, which is where it is already shown.

    Rows worth nothing at all are dropped too. "+0 XP" reads as a broken award, where
    nothing at all correctly reads as nothing at all.

    Because the gate reads ``booking.status`` off the objects handed in, they must be the
    current ones. ``settle`` re-reads its row under a lock and returns *that* object, so a
    caller holding the pre-settle copy would ask about a booking still marked BOOKED and be
    told, correctly and uselessly, that it earned nothing.
    """
    ids = [b.id for b in bookings if b.status == SupportBooking.STATUS_HELD]
    if not ids:
        return {}
    from rewards.constants import support_session_key
    from rewards.models import PointAward

    by_key = {support_session_key(i): i for i in ids}
    out: dict[int, dict] = {}
    for key, points, xp in PointAward.objects.filter(
        idempotency_key__in=list(by_key)
    ).values_list("idempotency_key", "points", "xp"):
        if points or xp:
            out[by_key[key]] = {"points": int(points), "xp": int(xp)}
    return out


def award_for(booking) -> dict | None:
    """What one session paid, or ``None``."""
    return awards_for([booking]).get(booking.id)


def rating_summary(support_teacher) -> dict:
    """Average rating and count for one support teacher's settled sessions."""
    rated = SupportBooking.objects.filter(
        availability__support_teacher=support_teacher,
        status=SupportBooking.STATUS_HELD,
        rating__isnull=False,
    )
    stats = rated.aggregate(avg=Avg("rating"), n=Count("id"))
    return {
        "average": round(stats["avg"], 2) if stats["avg"] is not None else None,
        "count": stats["n"],
    }


def bookings_for_teacher(
    support_teacher, *, upcoming_only=False, now=None, include_cancelled=False
):
    """A support teacher's diary.

    Cancelled rows are excluded by default because the callers that count seats and chase
    unsettled sessions are asking "who is coming", and a returned seat is nobody.

    ``include_cancelled`` is for the diary the teacher actually reads. A student who called
    off an hour gave a reason, that reason is stored, and until now the teacher had no
    surface that could show it — the row was filtered out one layer below the page. The seat
    maths is unaffected: every count that matters filters on ``status`` explicitly.
    """
    qs = (
        SupportBooking.objects.filter(availability__support_teacher=support_teacher)
        .select_related("availability", "student", "classroom")
        .order_by("availability__starts_at", "id")
    )
    if not include_cancelled:
        qs = qs.exclude(status=SupportBooking.STATUS_CANCELLED)
    if upcoming_only:
        qs = qs.filter(
            Q(availability__starts_at__gt=(now or timezone.now()))
            | Q(status=SupportBooking.STATUS_BOOKED)
        )
    return qs


# ── Oversight: the whole desk, for an administrator ───────────────────────────
#
# Everything above answers a question one person has about their own week. An administrator
# has a different question — "is the desk being run?" — and it is not answerable by opening
# ten teachers' calendars one at a time. So these read across every support teacher at once,
# and each aggregate is a single grouped query rather than a loop: the cost of this page must
# not grow with the number of support teachers on it.


def support_teachers_qs():
    """Every account that is a support desk.

    Filtered on the stored ``role`` rather than :func:`normalized_role`, matching
    :func:`bookable_support_teacher_ids` — the two must agree, or the overview would list a
    desk no student can book, or hide one they can.
    """
    return (
        get_user_model()
        .objects.filter(role=SUPPORT_ACCOUNT_ROLE)
        .order_by("first_name", "last_name", "id")
    )


def rating_feed(support_teacher, *, limit: int = 50):
    """The ratings a support teacher has actually been given, newest first.

    Only ``HELD`` sessions carry a rating (``rate`` refuses every other status), so this is
    the whole of the feedback that exists. Ordered on ``rated_at`` and not on when the hour
    fell: a student who rates a session a week later has just said something new.
    """
    return (
        SupportBooking.objects.filter(
            availability__support_teacher=support_teacher,
            status=SupportBooking.STATUS_HELD,
            rating__isnull=False,
        )
        .select_related("student", "classroom", "availability")
        .order_by("-rated_at", "-id")[:limit]
    )


def desk_overview(*, now=None, days: int = CALENDAR_DAYS) -> list[dict]:
    """One row per support teacher: who they cover, what they have done, how it went.

    Six grouped queries plus one pass over the calendar window, for any number of teachers.

    The counts deliberately reuse the same filters as the paths they describe —
    ``ROLE_TA``+``STATUS_ACTIVE`` for a desk's classrooms, ``ROLE_STUDENT``+``STATUS_ACTIVE``
    for its reach — because a number shown beside a list must be computed the way the list
    is. A "12 students" that counts removed members next to a roster of 8 is the bug that
    reads as a data problem and is really an arithmetic one.
    """
    now = now or timezone.now()
    teachers = list(support_teachers_qs())
    if not teachers:
        return []
    ids = [t.id for t in teachers]

    # ── Which classrooms each desk covers, and how many students that reaches ──
    memberships = list(
        ClassroomMembership.objects.filter(
            user_id__in=ids,
            role=ClassroomMembership.ROLE_TA,
            status=ClassroomMembership.STATUS_ACTIVE,
        ).select_related("classroom")
    )
    classrooms_by_teacher: dict[int, list] = {}
    for m in memberships:
        classrooms_by_teacher.setdefault(m.user_id, []).append(m.classroom)

    covered_ids = {m.classroom_id for m in memberships}
    # The (classroom, student) pairs rather than a per-classroom count: a student in two of
    # the same teacher's classrooms must be one student, and summing counts would say two.
    roster: dict[int, set[int]] = {}
    if covered_ids:
        for classroom_id, user_id in ClassroomMembership.objects.filter(
            classroom_id__in=covered_ids,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        ).values_list("classroom_id", "user_id"):
            roster.setdefault(classroom_id, set()).add(user_id)

    # ── What has happened at each desk ────────────────────────────────────────
    by_status: dict[int, dict[str, int]] = {}
    for row in (
        SupportBooking.objects.filter(availability__support_teacher_id__in=ids)
        .values("availability__support_teacher_id", "status")
        .annotate(n=Count("id"))
    ):
        by_status.setdefault(row["availability__support_teacher_id"], {})[row["status"]] = row["n"]

    ratings: dict[int, dict] = {
        row["availability__support_teacher_id"]: {
            "average": round(row["avg"], 2) if row["avg"] is not None else None,
            "count": row["n"],
        }
        for row in SupportBooking.objects.filter(
            availability__support_teacher_id__in=ids,
            status=SupportBooking.STATUS_HELD,
            rating__isnull=False,
        )
        .values("availability__support_teacher_id")
        .annotate(avg=Avg("rating"), n=Count("id"))
    }

    upcoming = dict(
        SupportBooking.objects.filter(
            availability__support_teacher_id__in=ids,
            status=SupportBooking.STATUS_BOOKED,
            availability__starts_at__gt=now,
        )
        .values("availability__support_teacher_id")
        .annotate(n=Count("id"))
        .values_list("availability__support_teacher_id", "n")
    )
    # The one number that is a to-do rather than a fact: the hour has passed and nobody has
    # said whether the student turned up, so nobody has been paid.
    awaiting = dict(
        SupportBooking.objects.filter(
            availability__support_teacher_id__in=ids,
            status=SupportBooking.STATUS_BOOKED,
            availability__ends_at__lte=now,
        )
        .values("availability__support_teacher_id")
        .annotate(n=Count("id"))
        .values_list("availability__support_teacher_id", "n")
    )

    # ── This week's grid, counted the same way the grid renders it ────────────
    dates = calendar_dates(now, days=days)
    window_start = _hour_start(dates[0], CALENDAR_OPEN_HOUR)
    window_end = _hour_start(dates[-1], CALENDAR_CLOSE_HOUR)
    rows_by_teacher: dict[int, list] = {}
    for row in SupportAvailability.objects.filter(
        support_teacher_id__in=ids, starts_at__lt=window_end, ends_at__gt=window_start
    ):
        rows_by_teacher.setdefault(row.support_teacher_id, []).append(row)
    window_bookings: dict[int, list] = {}
    for b in (
        SupportBooking.objects.filter(
            availability_id__in=[r.id for rs in rows_by_teacher.values() for r in rs]
        )
        .exclude(status=SupportBooking.STATUS_CANCELLED)
        .order_by("id")
    ):
        window_bookings.setdefault(b.availability_id, []).append(b)

    out = []
    for teacher in teachers:
        classrooms = classrooms_by_teacher.get(teacher.id, [])
        reach: set[int] = set()
        for classroom in classrooms:
            reach |= roster.get(classroom.id, set())
        counts = by_status.get(teacher.id, {})
        week = _desk_week(rows_by_teacher.get(teacher.id, []), window_bookings, dates, now)
        hours = [h for day in week for h in day["hours"]]
        out.append({
            "teacher": teacher,
            "classrooms": classrooms,
            "students": len(reach),
            "held": counts.get(SupportBooking.STATUS_HELD, 0),
            "missed": counts.get(SupportBooking.STATUS_NO_SHOW, 0),
            "cancelled": counts.get(SupportBooking.STATUS_CANCELLED, 0),
            "upcoming": upcoming.get(teacher.id, 0),
            "awaiting_settle": awaiting.get(teacher.id, 0),
            "free_hours": sum(1 for h in hours if h["state"] == "open"),
            "closed_hours": sum(1 for h in hours if h["state"] == "closed"),
            "ratings": ratings.get(teacher.id, {"average": None, "count": 0}),
        })
    return out
