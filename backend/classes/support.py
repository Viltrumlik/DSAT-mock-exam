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
from django.db.models import Count, Q
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
        existing.save(update_fields=["status", "classroom", "topic", "settled_at", "settled_by", "updated_at"])
        return existing

    return SupportBooking.objects.create(
        availability=availability, student=student, classroom=classroom,
        topic=topic, status=SupportBooking.STATUS_BOOKED,
    )


@transaction.atomic
def cancel(booking, *, actor=None) -> SupportBooking:
    """Give the seat back. Settled bookings are history and cannot be cancelled."""
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status in (SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW):
        raise ValidationError("That session has already been settled.")
    booking.status = SupportBooking.STATUS_CANCELLED
    booking.settled_at = None
    booking.settled_by = actor
    booking.save(update_fields=["status", "settled_at", "settled_by", "updated_at"])
    return booking


@transaction.atomic
def settle(booking, status: str, *, actor=None, now=None) -> SupportBooking:
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
    booking.status = status
    booking.settled_at = now or timezone.now()
    booking.settled_by = actor
    booking.save(update_fields=["status", "settled_at", "settled_by", "updated_at"])
    return booking


def bookings_for_teacher(support_teacher, *, upcoming_only=False, now=None):
    """A support teacher's diary."""
    qs = (
        SupportBooking.objects.filter(availability__support_teacher=support_teacher)
        .exclude(status=SupportBooking.STATUS_CANCELLED)
        .select_related("availability", "student", "classroom")
        .order_by("availability__starts_at", "id")
    )
    if upcoming_only:
        qs = qs.filter(
            Q(availability__starts_at__gt=(now or timezone.now()))
            | Q(status=SupportBooking.STATUS_BOOKED)
        )
    return qs
