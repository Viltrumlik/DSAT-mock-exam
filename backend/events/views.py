"""Event endpoints.

Plain `APIView`s, never `.as_view({...})` — that form silently drops `permission_classes` in
this codebase and is how an admin endpoint once shipped as AllowAny.

Every refusal from `services` becomes `{"code", "detail"}`. The code is what the page
branches on; the detail is what it shows.
"""

from __future__ import annotations

from django.db.models import Count, Q
from django.http import Http404, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status as http
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from rewards.views import _is_reward_staff

from . import services
from .models import Event, EventRegistration
from .serializers import (
    AdminRegistrationSerializer,
    EventRegistrationSerializer,
    EventSerializer,
    EventWriteSerializer,
)
from .serializers import _image_url

#: `full` is the one refusal that is about the world rather than the request.
_STATUS_FOR_CODE = {"full": http.HTTP_409_CONFLICT}


def _refused(exc: services.EventRefused) -> Response:
    return Response(
        {"code": exc.code, "detail": exc.message},
        status=_STATUS_FOR_CODE.get(exc.code, http.HTTP_400_BAD_REQUEST),
    )


def _with_counts(queryset):
    """Annotate the seats taken, so a list of cards is one query rather than one per card."""
    return queryset.annotate(
        registered_total=Count(
            "registrations",
            filter=Q(registrations__status=EventRegistration.STATUS_REGISTERED),
        )
    )


def _my_rows(user, events):
    rows = EventRegistration.objects.filter(student=user, event__in=[e.pk for e in events])
    return {row.event_id: row for row in rows}


def _serialize(events, request):
    events = list(events)
    return EventSerializer(
        events,
        many=True,
        context={"request": request, "my_rows": _my_rows(request.user, events)},
    ).data


class EventsView(APIView):
    """What is coming up: published events that have not finished yet."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        events = _with_counts(
            Event.objects.filter(status=Event.STATUS_PUBLISHED, ends_at__gte=timezone.now())
        ).order_by("starts_at")
        return Response({"events": _serialize(events, request)})


class MyEventsView(APIView):
    """The student's own seats, past ones included."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        event_ids = EventRegistration.objects.filter(student=request.user).values_list(
            "event_id", flat=True
        )
        events = _with_counts(Event.objects.filter(pk__in=list(event_ids))).order_by("-starts_at")
        return Response({"events": _serialize(events, request)})


class EventSignUpView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, event_id: int):
        event = get_object_or_404(Event, pk=event_id)
        try:
            row = services.sign_up(event, request.user)
        except services.EventRefused as exc:
            return _refused(exc)
        return Response(EventRegistrationSerializer(row).data, status=http.HTTP_201_CREATED)


class EventCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, event_id: int):
        row = get_object_or_404(
            EventRegistration.objects.select_related("event"),
            event_id=event_id,
            student=request.user,
        )
        try:
            services.cancel_registration(row)
        except services.EventRefused as exc:
            return _refused(exc)
        return Response(EventRegistrationSerializer(row).data)


class EventCoverView(APIView):
    """The cover image, for a mail client that has no session.

    Media lives in a private bucket and every `.url` is signed for about an hour, so a signed
    URL pasted into an email breaks by lunchtime. This redirects to a freshly signed one each
    time the image is loaded. Published events only, so an unpublished poster never leaks.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request, event_id: int):
        event = Event.objects.filter(pk=event_id, status=Event.STATUS_PUBLISHED).first()
        url = _image_url(event, request) if event else None
        if not url:
            raise Http404
        response = HttpResponseRedirect(url)
        # Well inside the signed URL's own hour, so a cached redirect never outlives it.
        response["Cache-Control"] = "public, max-age=600"
        return response


class _StaffView(APIView):
    """The gate the stories console uses, copied rather than imported.

    `shop` and `stories` each carry their own byte-identical copy; a shared base class would
    put three consoles' permissions in one file nobody owns.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _guard(self, request):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


def _ops_payload(event, request):
    return EventSerializer(event, context={"request": request, "my_rows": {}}).data


class AdminEventsView(_StaffView):
    """Every event, draft and cancelled included, and a way to create one."""

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        events = _with_counts(Event.objects.all()).order_by("-starts_at")
        return Response({
            "events": EventSerializer(
                events, many=True, context={"request": request, "my_rows": {}}
            ).data
        })

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = EventWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = serializer.save(created_by=request.user)
        return Response(_ops_payload(event, request), status=http.HTTP_201_CREATED)


class AdminEventDetailView(_StaffView):
    def get(self, request, event_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        event = get_object_or_404(_with_counts(Event.objects.all()), pk=event_id)
        return Response(_ops_payload(event, request))

    def patch(self, request, event_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        event = get_object_or_404(Event, pk=event_id)
        serializer = EventWriteSerializer(event, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            # Through the service, never `serializer.save()`: the seat-count rule and the
            # "tell the students holding a seat" rule live there, and a second door into the
            # same edit is a second place for them to be forgotten.
            event, _moved = services.update_and_announce(event, dict(serializer.validated_data))
        except services.EventRefused as exc:
            return _refused(exc)
        return Response(_ops_payload(event, request))

    def delete(self, request, event_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        event = get_object_or_404(Event, pk=event_id)
        try:
            services.delete_draft(event)
        except services.EventRefused as exc:
            return _refused(exc)
        return Response(status=http.HTTP_204_NO_CONTENT)


class AdminEventPublishView(_StaffView):
    def post(self, request, event_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        event = get_object_or_404(Event, pk=event_id)
        try:
            announced = services.publish_and_announce(event)
        except services.EventRefused as exc:
            return _refused(exc)
        event.refresh_from_db()
        # `announced` is False when it was already published: pressing the button twice is
        # not an error, it just tells nobody a second time.
        return Response({**_ops_payload(event, request), "announced": announced})


class AdminEventCancelView(_StaffView):
    def post(self, request, event_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        event = get_object_or_404(Event, pk=event_id)
        try:
            event = services.cancel_and_announce(event, actor=request.user)
        except services.EventRefused as exc:
            return _refused(exc)
        return Response(_ops_payload(event, request))


class AdminRegistrationsView(_StaffView):
    """Who signed up, and the four counters the desk reads at the door."""

    def get(self, request, event_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        event = get_object_or_404(Event, pk=event_id)
        rows = list(
            event.registrations.select_related("student").order_by("registered_at", "id")
        )
        live = [r for r in rows if r.status == EventRegistration.STATUS_REGISTERED]
        counts = {
            "registered": len(live),
            "attended": len([r for r in live if r.attendance == EventRegistration.ATTENDANCE_ATTENDED]),
            "missed": len([r for r in live if r.attendance == EventRegistration.ATTENDANCE_MISSED]),
            "not_marked": len([r for r in live if r.attendance is None]),
            "cancelled": len(rows) - len(live),
        }
        return Response({
            "registrations": AdminRegistrationSerializer(rows, many=True).data,
            "counts": counts,
            "marking_opens_at": services.marking_opens_at(event),
        })


class AdminAttendanceView(_StaffView):
    def post(self, request, registration_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        row = get_object_or_404(
            EventRegistration.objects.select_related("event", "student"), pk=registration_id
        )
        try:
            services.mark_attendance(
                row, request.data.get("attendance"), actor=request.user
            )
        except services.EventRefused as exc:
            return _refused(exc)
        return Response(AdminRegistrationSerializer(row).data)
