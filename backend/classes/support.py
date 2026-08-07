"""Support-booking rules.

The one rule the school stated: **a student may only book a support teacher assigned to a
classroom that student is in.** Everything here exists to make that true and to keep it true
when someone leaves a class.

Eligibility is computed from live membership on every call rather than snapshotted onto the
booking. A student removed from a class stops being able to book its support teachers
immediately, which is the point — a snapshot would keep the door open until someone noticed.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Classroom, ClassroomMembership
from .models_support import SupportAvailability, SupportBooking


def _active_student_classroom_ids(student):
    return ClassroomMembership.objects.filter(
        user=student,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).values_list("classroom_id", flat=True)


def _support_classroom_ids(support_teacher):
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
