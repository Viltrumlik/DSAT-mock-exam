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
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import Event, EventRegistration
from .serializers import (
    EventRegistrationSerializer,
    EventSerializer,
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
