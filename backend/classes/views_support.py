"""Support-teacher booking API.

Student:
  GET    /api/classes/support/calendar/             the next four days, 08:00–18:00
  GET    /api/classes/support/slots/                what I may book
  GET    /api/classes/support/bookings/             my bookings
  POST   /api/classes/support/bookings/             { availability_id | support_teacher_id +
                                                      starts_at, classroom_id?, topic? }
  DELETE /api/classes/support/bookings/<id>/        give the seat back
  POST   /api/classes/support/bookings/<id>/rate/   { rating: 1-5, comment? }
Support teacher:
  GET    /api/classes/support/availability/         my published slots
  POST   /api/classes/support/availability/         { starts_at, ends_at, capacity?, note? }
  DELETE /api/classes/support/availability/<id>/    cancel a slot
  GET    /api/classes/support/my-calendar/          my week, with who is coming
  POST   /api/classes/support/hours/close/          { starts_at }        withdraw one hour
  POST   /api/classes/support/hours/open/           { starts_at, capacity?, note? }
  GET    /api/classes/support/diary/                who booked me
  POST   /api/classes/support/bookings/<id>/settle/ { status: HELD | NO_SHOW, teacher_note? }
Administrator:
  GET    /api/classes/support/desks/                every desk, with its numbers
  GET    /api/classes/support/desks/teachers/       the picker
  GET    /api/classes/support/ratings/?support_teacher=<id>   the comments, not just the average

...plus `?support_teacher=<id>` on `my-calendar` and `diary`, matching the `support_teacher`
body field the hour and availability writes already accept. An administrator therefore reads
and edits a teacher's week through the **same** endpoints the teacher does, rather than a
parallel set that could quietly come to disagree with them.

Settling as HELD is what earns the student their session award, so only the support teacher
who owns the slot (or an admin) may do it — a student cannot mark their own session
attended. The award is written by ``rewards.hooks``; every booking payload carries it back
as ``award`` so the earning can be named where it happens instead of merely promised.

The rating runs the other way and is the student's alone: a review the teacher can write is
not a review. It never touches points.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
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


def _booking_json(booking: SupportBooking, *, award: dict | None = None) -> dict:
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
        # Why the seat came back. The teacher held the hour open for it, so they get told.
        "cancel_reason": booking.cancel_reason,
        "cancelled_at": booking.cancelled_at,
        # How it went, from both sides.
        "rating": booking.rating,
        "rating_comment": booking.rating_comment,
        "rated_at": booking.rated_at,
        "teacher_note": booking.teacher_note,
        # What the session actually paid, read back out of the reward ledger — ``null``
        # until it is settled as held, and still ``null`` if the award was later revoked.
        #
        # The page has always promised "points arrive once your teacher confirms you
        # attended" and then, when they did, shown a green tick and nothing else. The
        # ledger has been writing the award since the desk shipped; this is the field that
        # lets somebody see it.
        "award": award,
        "slot": _slot_json(booking.availability, include_seats=False),
    }


def _booking_list_json(bookings) -> list[dict]:
    """A list of bookings with their awards attached, in one extra query for the lot."""
    bookings = list(bookings)
    awards = support_service.awards_for(bookings)
    return [_booking_json(b, award=awards.get(b.id)) for b in bookings]


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
            # Sent with the calendar, not discovered on refusal: a student should see "1 of 2
            # left" before they pick an hour, not after the server turns them down.
            "allowance": support_service.booking_allowance(request.user),
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


def _target_teacher(request):
    """Whose calendar is being edited: ``(user, error_response)``.

    A support teacher may only ever edit their own. An administrator may name someone else
    with `support_teacher=<id>` — which is the whole of "the admin sets support work hours".
    Without a resolver, the write paths were hard-wired to `request.user`, so an admin
    pressing a button on a teacher's grid quietly published the hour onto their own calendar,
    where no student would ever see it.

    Omitting the field keeps the old behaviour exactly, so nothing a support teacher does
    changes.
    """
    raw = request.data.get("support_teacher")
    if raw in (None, ""):
        return request.user, None
    if not _is_admin(request.user):
        return None, Response(
            {"detail": "Only an administrator can set somebody else's hours."},
            status=http.HTTP_403_FORBIDDEN,
        )
    from django.contrib.auth import get_user_model

    target = get_user_model().objects.filter(pk=raw).first()
    if target is None or not _is_support_teacher(target):
        return None, Response({"detail": "That user is not a support teacher."}, status=400)
    return target, None


def _target_desk(request):
    """Whose desk is being READ: ``(user, error_response)``.

    The mirror of :func:`_target_teacher` for the GET paths, which name their target in the
    query string rather than the body.

    Without it, ``my-calendar`` and ``diary`` were hard-wired to ``request.user``. An admin
    opening a support teacher's week therefore got a 200 and their **own** empty grid —
    which is the most misleading of the three possible answers, because it reads as "this
    teacher has nothing on" rather than "you asked the wrong question".

    Omitting the parameter keeps the old behaviour exactly, so nothing a support teacher
    does changes.
    """
    raw = request.query_params.get("support_teacher")
    if raw in (None, ""):
        return request.user, None
    if not _is_admin(request.user):
        return None, Response(
            {"detail": "Only an administrator can read somebody else's desk."},
            status=http.HTTP_403_FORBIDDEN,
        )
    target = get_user_model().objects.filter(pk=raw).first()
    if target is None or not _is_support_teacher(target):
        return None, Response({"detail": "That user is not a support teacher."}, status=400)
    return target, None


class SupportAvailabilityView(APIView):
    """Support teacher: publish and withdraw slots. An admin may act on a teacher's behalf."""

    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        return _is_support_teacher(request.user) or _is_admin(request.user)

    def get(self, request):
        if not self._guard(request):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        # An admin opening a teacher's grid needs to read it before they can edit it.
        whose = request.query_params.get("support_teacher")
        owner_id = request.user.pk
        if whose and _is_admin(request.user):
            owner_id = whose
        slots = (
            SupportAvailability.objects.filter(support_teacher_id=owner_id)
            .select_related("support_teacher")
            .order_by("starts_at", "id")
        )
        return Response({"slots": [_slot_json(s) for s in slots]})

    def post(self, request):
        if not self._guard(request):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        owner, denied = _target_teacher(request)
        if denied:
            return denied
        starts_at = _parse_dt(request.data.get("starts_at"))
        ends_at = _parse_dt(request.data.get("ends_at"))
        if starts_at is None or ends_at is None:
            return Response({"detail": "starts_at and ends_at are required."}, status=400)
        if ends_at <= starts_at:
            return Response({"detail": "The slot must end after it starts."}, status=400)

        # ``capacity`` is optional. Treating a missing field as 1 was fine while this only ever
        # created rows; applying that default on republish silently shrank a group a teacher
        # had opened earlier and left its students overbooked.
        capacity_given = request.data.get("capacity") not in (None, "")
        try:
            capacity = max(1, int(request.data.get("capacity") or 1))
        except (TypeError, ValueError):
            capacity = 1

        note = (request.data.get("note") or "").strip()
        with transaction.atomic():
            slot, created = SupportAvailability.objects.get_or_create(
                support_teacher=owner,
                starts_at=starts_at,
                defaults={"ends_at": ends_at, "capacity": capacity, "note": note},
            )
            if not created:
                # Publishing over an existing row applies the teacher's values, whether the row
                # was withdrawn or minted by a student booking that hour off the calendar. This
                # used to run only for withdrawn rows, so once students could materialise rows
                # themselves a teacher opening a group clinic on an already-booked hour got a
                # 200 and no clinic.
                slot = SupportAvailability.objects.select_for_update().get(pk=slot.pk)
                booked = slot.bookings.filter(
                    status__in=SupportBooking.OCCUPYING_STATUSES
                ).count()
                if capacity_given and capacity < booked:
                    # Refuse rather than overbook. Withdrawing the slot is the way to undo a
                    # booking, and that path cancels them explicitly instead of stranding them.
                    return Response(
                        {
                            "detail": (
                                f"{booked} student{'' if booked == 1 else 's'} already booked "
                                f"this time — you cannot reduce it below {booked}. Withdraw the "
                                f"slot instead if you need to cancel."
                            )
                        },
                        status=400,
                    )
                slot.is_cancelled = False
                slot.ends_at = ends_at
                slot.note = note
                if capacity_given:
                    slot.capacity = capacity
                else:
                    slot.capacity = max(slot.capacity, booked)
                slot.save(
                    update_fields=["is_cancelled", "ends_at", "capacity", "note", "updated_at"]
                )
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
        return Response({"bookings": _booking_list_json(bookings)})

    def post(self, request):
        classroom = None
        if request.data.get("classroom_id"):
            classroom = get_object_or_404(Classroom, pk=request.data["classroom_id"])
        topic = (request.data.get("topic") or "").strip()

        # Two ways in. ``availability_id`` books a row the teacher published; the calendar
        # instead names an hour, and the row is materialised inside the booking transaction so
        # a refusal leaves nothing behind.
        if request.data.get("availability_id"):
            slot = get_object_or_404(
                SupportAvailability.objects.select_related("support_teacher"),
                pk=request.data["availability_id"],
            )
            try:
                booking = support_service.book(
                    request.user, slot, classroom=classroom, topic=topic
                )
            except ValidationError as exc:
                return Response({"detail": "; ".join(exc.messages)}, status=400)
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
                booking = support_service.book_at(
                    request.user, teacher, starts_at, classroom=classroom, topic=topic
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
        is_student = booking.student_id == request.user.id
        allowed = is_student or _is_admin(request.user) or (
            booking.availability.support_teacher_id == request.user.id
        )
        if not allowed:
            return Response({"detail": "Not your booking."}, status=http.HTTP_403_FORBIDDEN)

        reason = (request.data.get("reason") or "").strip()
        if is_student and not reason:
            # Required of the student and only the student. The teacher cancelling is
            # usually withdrawing the hour, and the student is owed the reason more than
            # the teacher is: they held an hour open that nobody else could take.
            return Response(
                {"detail": "Tell your teacher why you can't make it — they held the hour for you."},
                status=400,
            )
        try:
            support_service.cancel(booking, actor=request.user, reason=reason)
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
                booking,
                str(request.data.get("status") or "").strip().upper(),
                actor=request.user,
                teacher_note=request.data.get("teacher_note") or "",
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        booking = SupportBooking.objects.select_related(
            "availability", "availability__support_teacher", "classroom", "student"
        ).get(pk=booking.pk)
        # Read AFTER the settle, so the response carries the award the save just triggered.
        # This is what makes the earning visible at the moment it is decided instead of on
        # whatever page the student happens to open next.
        return Response(_booking_json(booking, award=support_service.award_for(booking)))


class SupportBookingRateView(APIView):
    """Student: how the session went.

    Only the student who sat in it, and only once the teacher has marked it attended — there
    is nothing to judge about a session that was cancelled, missed, or has not happened.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, booking_id):
        booking = get_object_or_404(
            SupportBooking.objects.select_related("availability"), pk=booking_id
        )
        if booking.student_id != request.user.id:
            # Explicitly not the teacher: a rating the teacher can write is not a rating.
            return Response(
                {"detail": "Only the student who attended can rate this session."},
                status=http.HTTP_403_FORBIDDEN,
            )
        try:
            support_service.rate(
                booking,
                request.data.get("rating"),
                comment=request.data.get("comment") or "",
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        booking = SupportBooking.objects.select_related(
            "availability", "availability__support_teacher", "classroom", "student"
        ).get(pk=booking.pk)
        return Response(_booking_json(booking, award=support_service.award_for(booking)))


class SupportDiaryView(APIView):
    """Support teacher: who booked me. An admin may read somebody else's with
    ``?support_teacher=<id>``."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (_is_support_teacher(request.user) or _is_admin(request.user)):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        owner, denied = _target_desk(request)
        if denied:
            return denied
        # Cancelled rows included here and nowhere else. The student gave a reason for
        # calling the hour off, it has been stored since the desk shipped, and the one
        # person it was collected for could not see it — the row was filtered out a layer
        # below the page. Every seat count still filters on status explicitly.
        bookings = support_service.bookings_for_teacher(owner, include_cancelled=True)
        return Response({
            "bookings": _booking_list_json(bookings),
            "ratings": support_service.rating_summary(owner),
        })


class SupportTeacherCalendarView(APIView):
    """Support teacher: my own week, with who is coming to each hour.

    The mirror of the student calendar. Every hour is open by default, so what a teacher
    does here is withdraw the ones they cannot do and see the appointments they have —
    which is why each hour carries its bookings rather than a bare seat count.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (_is_support_teacher(request.user) or _is_admin(request.user)):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        owner, denied = _target_desk(request)
        if denied:
            return denied
        days = support_service.teacher_calendar_for(owner)
        booked_total = sum(
            len(h["bookings"]) for d in days for h in d["hours"] if h["state"] == "booked"
        )
        free_total = sum(1 for d in days for h in d["hours"] if h["state"] == "open")
        return Response({
            "support_teacher_id": owner.pk,
            "support_teacher": _display_name(owner),
            "days": support_service.CALENDAR_DAYS,
            "open_hour": support_service.CALENDAR_OPEN_HOUR,
            "close_hour": support_service.CALENDAR_CLOSE_HOUR,
            "free_hours": free_total,
            "booked_sessions": booked_total,
            "awaiting_settle": support_service.bookings_for_teacher(owner)
            .filter(status=SupportBooking.STATUS_BOOKED, availability__ends_at__lte=timezone.now())
            .count(),
            "ratings": support_service.rating_summary(owner),
            "dates": [d["date"] for d in days],
            "days_out": [
                {
                    "date": d["date"],
                    "hours": [
                        {
                            **{k: v for k, v in h.items() if k != "bookings"},
                            "bookings": [
                                {
                                    "id": b.id,
                                    "status": b.status,
                                    "topic": b.topic,
                                    "student": _display_name(b.student),
                                    "student_id": b.student_id,
                                    "classroom_name": b.classroom.name if b.classroom else None,
                                    "rating": b.rating,
                                }
                                for b in h["bookings"]
                            ],
                        }
                        for h in d["hours"]
                    ],
                }
                for d in days
            ],
        })


class SupportHourView(APIView):
    """Withdraw or re-open one hour of the calendar — the teacher's own, or an admin on
    their behalf via `support_teacher`.

    Hours are open by default and mostly have no row at all, so "withdraw 15:00" has to be
    able to mint the row that records the withdrawal. That is the whole reason this exists
    next to the id-based availability endpoints: the grid speaks in times, not row ids.
    """

    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        return _is_support_teacher(request.user) or _is_admin(request.user)

    def post(self, request, action):
        if not self._guard(request):
            return Response({"detail": "Support teachers only."}, status=http.HTTP_403_FORBIDDEN)
        if action not in ("close", "open"):
            return Response({"detail": "Unknown action."}, status=400)
        owner, denied = _target_teacher(request)
        if denied:
            return denied

        starts_at = _parse_dt(request.data.get("starts_at"))
        if starts_at is None:
            return Response({"detail": "starts_at is required."}, status=400)
        local = timezone.localtime(starts_at)
        if local.minute or local.second:
            return Response({"detail": "Support hours start on the hour."}, status=400)

        ends_at = starts_at + timedelta(minutes=support_service.SLOT_MINUTES)
        with transaction.atomic():
            slot, _created = SupportAvailability.objects.get_or_create(
                support_teacher=owner,
                starts_at=starts_at,
                defaults={"ends_at": ends_at, "capacity": 1},
            )
            slot = SupportAvailability.objects.select_for_update().get(pk=slot.pk)
            slot.is_cancelled = action == "close"
            note = request.data.get("note")
            if note is not None:
                slot.note = str(note).strip()[:240]
            capacity = request.data.get("capacity")
            if action == "open" and capacity not in (None, ""):
                try:
                    slot.capacity = max(1, int(capacity))
                except (TypeError, ValueError):
                    pass
            slot.save(update_fields=["is_cancelled", "note", "capacity", "updated_at"])

            cancelled = 0
            if action == "close":
                # A withdrawn hour with a live booking on it is an appointment nobody is
                # going to attend. The student is told why rather than finding an empty room.
                for booking in slot.bookings.filter(status=SupportBooking.STATUS_BOOKED):
                    support_service.cancel(
                        booking, actor=request.user,
                        reason="Your teacher withdrew this hour.",
                    )
                    cancelled += 1

        return Response({
            **_slot_json(slot),
            "bookings_cancelled": cancelled,
        })


# ── Oversight, for an administrator ───────────────────────────────────────────


class _SupportAdminView(APIView):
    """Admin-only, and by role rather than by permission.

    ``AuthGuard adminOnly`` on the console admits anyone holding ``manage_tests``, so a
    ``test_auditor`` reaches every ops page. Staffing decisions and a teacher's ratings are
    not theirs to read, so the gate is ``_is_admin`` — the same one the write paths already
    use — and it is enforced here rather than left to the nav hiding a link.
    """

    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        if _is_admin(request.user):
            return None
        return Response({"detail": "Administrators only."}, status=http.HTTP_403_FORBIDDEN)


class SupportDeskOverviewView(_SupportAdminView):
    """Every support desk on one screen: who they cover, what they have done, how it went.

    This is the question an administrator actually has — "is the desk being run?" — and it
    was not answerable at all before. The per-teacher endpoints each answer it for one
    person, and opening ten of them in turn is not oversight, it is a chore nobody does.
    """

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        rows = support_service.desk_overview()
        return Response({
            "days": support_service.CALENDAR_DAYS,
            "open_hour": support_service.CALENDAR_OPEN_HOUR,
            "close_hour": support_service.CALENDAR_CLOSE_HOUR,
            "teachers": [
                {
                    "id": row["teacher"].id,
                    "name": _display_name(row["teacher"]),
                    "email": row["teacher"].email,
                    "subject": getattr(row["teacher"], "subject", None),
                    "photo_url": profile_image_url(row["teacher"], request),
                    "classrooms": [
                        {"id": c.id, "name": c.name} for c in row["classrooms"]
                    ],
                    "students": row["students"],
                    "held": row["held"],
                    "missed": row["missed"],
                    "cancelled": row["cancelled"],
                    "upcoming": row["upcoming"],
                    "awaiting_settle": row["awaiting_settle"],
                    "free_hours": row["free_hours"],
                    "closed_hours": row["closed_hours"],
                    "ratings": row["ratings"],
                }
                for row in rows
            ],
        })


class SupportRatingsView(_SupportAdminView):
    """What students actually wrote about one support teacher.

    The average alone cannot tell a head of school whether a 3.4 is one bad week or a
    pattern, so the comments come with it. They are shown WITH the student's name: this is
    a management surface, the school asked for it, and a rating that cannot be followed up
    is a number rather than feedback. The student is never told a rating is anonymous, so
    nothing here breaks a promise that was made — but it is a policy choice, not a
    technical one, and it lives in this docstring so the next reader knows it was made.
    """

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        raw = request.query_params.get("support_teacher")
        target = get_user_model().objects.filter(pk=raw).first() if raw else None
        if target is None or not _is_support_teacher(target):
            return Response({"detail": "That user is not a support teacher."}, status=400)
        return Response({
            "support_teacher_id": target.pk,
            "support_teacher": _display_name(target),
            "summary": support_service.rating_summary(target),
            "ratings": [
                {
                    "booking_id": b.id,
                    "rating": b.rating,
                    "comment": b.rating_comment,
                    "rated_at": b.rated_at,
                    "student": _display_name(b.student),
                    "student_id": b.student_id,
                    "classroom_name": b.classroom.name if b.classroom else None,
                    "starts_at": b.availability.starts_at,
                    "topic": b.topic,
                    "teacher_note": b.teacher_note,
                }
                for b in support_service.rating_feed(target)
            ],
        })


class SupportDeskTeachersView(_SupportAdminView):
    """The picker: every support-teacher account, whether or not they cover a class.

    Deliberately not derived from classroom memberships. A support teacher assigned to
    nothing is exactly the row an administrator needs to see — they are on the payroll and
    no student can book them — and a membership-derived list is the one list that can never
    show it.
    """

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        return Response({
            "support_teachers": [
                {
                    "id": t.id,
                    "name": _display_name(t),
                    "email": t.email,
                    "subject": getattr(t, "subject", None),
                }
                for t in support_service.support_teachers_qs()
            ]
        })
