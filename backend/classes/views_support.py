"""Support-teacher booking API.

Student:
  GET    /api/classes/support/calendar/             the next four days, 08:00–18:00
  GET    /api/classes/support/slots/                what I may book
  GET    /api/classes/support/bookings/             my bookings
  POST   /api/classes/support/bookings/             { availability_id | support_teacher_id +
                                                      starts_at, classroom_id?, topic? }
  DELETE /api/classes/support/bookings/<id>/        give the seat back
Support teacher:
  GET    /api/classes/support/availability/         my published slots
  POST   /api/classes/support/availability/         { starts_at, ends_at, capacity?, note? }
  DELETE /api/classes/support/availability/<id>/    cancel a slot
  GET    /api/classes/support/diary/                who booked me
  POST   /api/classes/support/bookings/<id>/settle/ { status: HELD | NO_SHOW }

Settling as HELD is what earns the student their 10 points, so only the support teacher who
owns the slot (or an admin) may do it — a student cannot mark their own session attended.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as acc_const
from access.services import normalized_role
from users.photos import profile_image_url

from . import support as support_service
from .models import Classroom
from .models_support import SupportAvailability, SupportBooking
from .views_rankings import _display_name


def _is_support_teacher(user) -> bool:
    return normalized_role(user) == acc_const.ROLE_SUPPORT_TEACHER


def _is_admin(user) -> bool:
    return bool(getattr(user, "is_superuser", False)) or normalized_role(user) in (
        acc_const.ROLE_SUPER_ADMIN,
        acc_const.ROLE_ADMIN,
    )


def _slot_json(slot: SupportAvailability, *, include_seats=True) -> dict:
    data = {
        "id": slot.id,
        "support_teacher_id": slot.support_teacher_id,
        "support_teacher": _display_name(slot.support_teacher),
        "starts_at": slot.starts_at,
        "ends_at": slot.ends_at,
        "capacity": slot.capacity,
        "note": slot.note,
        "is_cancelled": slot.is_cancelled,
    }
    if include_seats:
        data["seats_left"] = slot.seats_left
    return data


def _booking_json(booking: SupportBooking) -> dict:
    return {
        "id": booking.id,
        "status": booking.status,
        "topic": booking.topic,
        "booked_at": booking.booked_at,
        "settled_at": booking.settled_at,
        "classroom_id": booking.classroom_id,
        "classroom_name": booking.classroom.name if booking.classroom else None,
        "student_id": booking.student_id,
        "student": _display_name(booking.student),
        "slot": _slot_json(booking.availability, include_seats=False),
    }


def _parse_dt(value):
    if not value:
        return None
    dt = parse_datetime(str(value))
    if dt is None:
        return None
    return timezone.make_aware(dt, timezone.get_current_timezone()) if timezone.is_naive(dt) else dt


class SupportSlotsView(APIView):
    """Student: the slots I am entitled to book."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        slots = support_service.open_slots_for(request.user)
        return Response({"slots": [_slot_json(s) for s in slots]})


class SupportCalendarView(APIView):
    """Student: the open calendar — every support teacher assigned to one of my classes,
    each with the next few days of school-hours slots and what state each hour is in."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        calendar = support_service.open_calendar_for(request.user)
        return Response({
            "days": support_service.CALENDAR_DAYS,
            "open_hour": support_service.CALENDAR_OPEN_HOUR,
            "close_hour": support_service.CALENDAR_CLOSE_HOUR,
            "dates": support_service.calendar_dates(),
            "teachers": [
                {
                    "id": entry["teacher"].id,
                    "name": _display_name(entry["teacher"]),
                    "photo_url": profile_image_url(entry["teacher"], request),
                    "classrooms": [
                        {"id": c.id, "name": c.name} for c in entry["classrooms"]
                    ],
                    "days": [
                        {"date": day["date"], "hours": day["hours"]} for day in entry["days"]
                    ],
                }
                for entry in calendar
            ],
        })


class SupportAvailabilityView(APIView):
    """Support teacher: publish and withdraw my own slots."""

    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        return _is_support_teacher(request.user) or _is_admin(request.user)

    def get(self, request):
        if not self._guard(request):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        slots = (
            SupportAvailability.objects.filter(support_teacher=request.user)
            .select_related("support_teacher")
            .order_by("starts_at", "id")
        )
        return Response({"slots": [_slot_json(s) for s in slots]})

    def post(self, request):
        if not self._guard(request):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        starts_at = _parse_dt(request.data.get("starts_at"))
        ends_at = _parse_dt(request.data.get("ends_at"))
        if starts_at is None or ends_at is None:
            return Response({"detail": "starts_at and ends_at are required."}, status=400)
        if ends_at <= starts_at:
            return Response({"detail": "The slot must end after it starts."}, status=400)

        try:
            capacity = max(1, int(request.data.get("capacity") or 1))
        except (TypeError, ValueError):
            capacity = 1

        slot, created = SupportAvailability.objects.get_or_create(
            support_teacher=request.user,
            starts_at=starts_at,
            defaults={
                "ends_at": ends_at,
                "capacity": capacity,
                "note": (request.data.get("note") or "").strip(),
            },
        )
        if not created and slot.is_cancelled:
            # Republishing a withdrawn slot reuses the row — the unique (teacher, start)
            # constraint means there is nothing else it could do.
            slot.is_cancelled = False
            slot.ends_at = ends_at
            slot.capacity = capacity
            slot.save(update_fields=["is_cancelled", "ends_at", "capacity", "updated_at"])
        return Response(
            _slot_json(slot), status=http.HTTP_201_CREATED if created else http.HTTP_200_OK
        )


class SupportAvailabilityDetailView(SupportAvailabilityView):
    """Withdraw one slot. Separate from the collection view so that GET/POST on the detail
    URL return 405 instead of reaching a handler that has no such argument and raising."""

    def get(self, request, slot_id):
        return Response(status=http.HTTP_405_METHOD_NOT_ALLOWED)

    def post(self, request, slot_id):
        return Response(status=http.HTTP_405_METHOD_NOT_ALLOWED)

    def delete(self, request, slot_id):
        if not self._guard(request):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        slot = get_object_or_404(SupportAvailability, pk=slot_id)
        if slot.support_teacher_id != request.user.id and not _is_admin(request.user):
            return Response({"detail": "Not your slot."}, status=http.HTTP_403_FORBIDDEN)
        slot.is_cancelled = True
        slot.save(update_fields=["is_cancelled", "updated_at"])
        # Bookings on a withdrawn slot are cancelled, not left dangling — the student would
        # otherwise keep a confirmed-looking appointment nobody is going to attend.
        for booking in slot.bookings.filter(status=SupportBooking.STATUS_BOOKED):
            support_service.cancel(booking, actor=request.user)
        return Response({"detail": "Slot cancelled.", "id": slot.id})


class SupportBookingsView(APIView):
    """Student: my bookings, and making one."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        bookings = (
            SupportBooking.objects.filter(student=request.user)
            .select_related("availability", "availability__support_teacher", "classroom", "student")
            .order_by("-booked_at", "-id")
        )
        return Response({"bookings": [_booking_json(b) for b in bookings]})

    def post(self, request):
        # Two ways in. ``availability_id`` books a row the teacher published; the calendar
        # instead names an hour that has no row yet, and materialises one on the way past.
        if request.data.get("availability_id"):
            slot = get_object_or_404(
                SupportAvailability.objects.select_related("support_teacher"),
                pk=request.data["availability_id"],
            )
        else:
            teacher = get_object_or_404(
                get_user_model(), pk=request.data.get("support_teacher_id")
            )
            starts_at = _parse_dt(request.data.get("starts_at"))
            if starts_at is None:
                return Response(
                    {"detail": "Choose a time — starts_at is required."}, status=400
                )
            # Entitlement first: without this an outsider could mint availability rows for
            # any teacher on the platform simply by naming an hour.
            if teacher.id not in support_service.bookable_support_teacher_ids(request.user):
                return Response(
                    {"detail": "You can only book a support teacher assigned to one of your classes."},
                    status=400,
                )
            try:
                slot = support_service.slot_for(teacher, starts_at)
            except ValidationError as exc:
                return Response({"detail": "; ".join(exc.messages)}, status=400)
        classroom = None
        if request.data.get("classroom_id"):
            classroom = get_object_or_404(Classroom, pk=request.data["classroom_id"])
        try:
            booking = support_service.book(
                request.user, slot, classroom=classroom,
                topic=(request.data.get("topic") or "").strip(),
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        booking = SupportBooking.objects.select_related(
            "availability", "availability__support_teacher", "classroom", "student"
        ).get(pk=booking.pk)
        return Response(_booking_json(booking), status=http.HTTP_201_CREATED)


class SupportBookingDetailView(SupportBookingsView):
    """Cancel one booking. Separate for the same reason as the availability detail view."""

    def get(self, request, booking_id):
        return Response(status=http.HTTP_405_METHOD_NOT_ALLOWED)

    def post(self, request, booking_id):
        return Response(status=http.HTTP_405_METHOD_NOT_ALLOWED)

    def delete(self, request, booking_id):
        booking = get_object_or_404(SupportBooking, pk=booking_id)
        allowed = booking.student_id == request.user.id or _is_admin(request.user) or (
            booking.availability.support_teacher_id == request.user.id
        )
        if not allowed:
            return Response({"detail": "Not your booking."}, status=http.HTTP_403_FORBIDDEN)
        try:
            support_service.cancel(booking, actor=request.user)
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        return Response({"detail": "Booking cancelled.", "id": booking.id})


class SupportBookingSettleView(APIView):
    """Support teacher: record whether the session happened. HELD is what pays."""

    permission_classes = [IsAuthenticated]

    def post(self, request, booking_id):
        booking = get_object_or_404(
            SupportBooking.objects.select_related("availability"), pk=booking_id
        )
        owns_slot = booking.availability.support_teacher_id == request.user.id
        if not (owns_slot or _is_admin(request.user)):
            # Explicitly not the student: settling as HELD awards them points, so letting
            # them do it would be self-service.
            return Response(
                {"detail": "Only the support teacher can settle this session."},
                status=http.HTTP_403_FORBIDDEN,
            )
        try:
            support_service.settle(
                booking, str(request.data.get("status") or "").strip().upper(), actor=request.user
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        booking = SupportBooking.objects.select_related(
            "availability", "availability__support_teacher", "classroom", "student"
        ).get(pk=booking.pk)
        return Response(_booking_json(booking))


class SupportDiaryView(APIView):
    """Support teacher: who booked me."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (_is_support_teacher(request.user) or _is_admin(request.user)):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        bookings = support_service.bookings_for_teacher(request.user)
        return Response({"bookings": [_booking_json(b) for b in bookings]})
