"""Invigilated mock sittings — the student half and the staff console.

Student:  POST /mocks/sessions/join/     {code}   -> request a place
          GET  /mocks/sessions/mine/               -> my places (the waiting room polls this)

Staff:    /mocks/admin/sessions/                   -> CRUD (create = admin only)
          .../<id>/rotate_code/                    -> admin only
          .../<id>/participants/                   -> the approval queue
          .../<id>/decide/  {participant, approve} -> teacher or admin
          .../<id>/start/                          -> teacher or admin; opens the room
          .../<id>/end/                            -> teacher or admin; takes every paper in
"""

from __future__ import annotations

import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status as http, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import CanCreateMockSessions, CanRunMockSessions

from .models import MockSession, MockSessionParticipant
from .session_serializers import (
    MockSessionParticipantSerializer,
    MockSessionSerializer,
    StudentMockSessionSerializer,
)
from .sessions import REASON_DETAIL, decide_place, end_session, request_place, start_session

logger = logging.getLogger(__name__)


# ── student ──────────────────────────────────────────────────────────────────


class JoinMockSessionView(APIView):
    """Type the code the teacher read out; get in the queue."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        place, reason = request_place(request.user, request.data.get("code"))
        if place is None:
            return Response(
                {"error": reason, "detail": REASON_DETAIL.get(reason, "Could not join that sitting.")},
                status=http.HTTP_403_FORBIDDEN,
            )
        return Response(StudentMockSessionSerializer().to_representation(place))


class MyMockSessionsView(APIView):
    """Every sitting this student has a place in, today first.

    This is what the waiting room polls. It is deliberately one cheap query returning one
    small row per place: with no usable push transport on this deployment (the SSE endpoint
    parks a sync gunicorn worker per client), thirty students waiting for a Start have to
    poll something, and it must stay small enough that thirty of them every few seconds is
    not a problem.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        places = (
            MockSessionParticipant.objects.filter(student=request.user)
            .exclude(session__status=MockSession.STATUS_CANCELLED)
            .select_related("session", "session__mock")
            .order_by("-session__session_date", "-requested_at")[:20]
        )
        ser = StudentMockSessionSerializer()
        return Response({"results": [ser.to_representation(p) for p in places]})


# ── staff console ────────────────────────────────────────────────────────────


class StaffMockSessionViewSet(viewsets.ModelViewSet):
    """The session console. Creating one is an admin act; running it is a teacher's."""

    serializer_class = MockSessionSerializer

    def get_permissions(self):
        # Create/update/delete/rotate the code: admin. Everything else (the controls used on
        # the day) also admits a teacher.
        admin_only = {"create", "update", "partial_update", "destroy", "rotate_code"}
        cls = CanCreateMockSessions if self.action in admin_only else CanRunMockSessions
        return [IsAuthenticated(), cls()]

    def get_queryset(self):
        return (
            MockSession.objects.all()
            .select_related("mock", "created_by")
            .prefetch_related("participants")
            .order_by("-session_date", "-created_at")
        )

    def perform_create(self, serializer):
        session = serializer.save(created_by=self.request.user)
        if not session.access_code:
            session.generate_access_code()
            session.save(update_fields=["access_code", "access_code_set_at", "updated_at"])

    @action(detail=True, methods=["post"], url_path="rotate_code")
    def rotate_code(self, request, pk=None):
        """Issue a fresh code — the fix for a code that leaked before the sitting."""
        session = self.get_object()
        session.generate_access_code()
        session.save(update_fields=["access_code", "access_code_set_at", "updated_at"])
        return Response(self.get_serializer(session).data)

    @action(detail=True, methods=["get"])
    def participants(self, request, pk=None):
        session = self.get_object()
        rows = (
            session.participants.select_related("student", "attempt")
            .order_by("status", "requested_at")
        )
        return Response({"results": MockSessionParticipantSerializer(rows, many=True).data})

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        """Approve or reject one request, or several at once."""
        session = self.get_object()
        approve = bool(request.data.get("approve", True))
        ids = request.data.get("participant_ids")
        if ids is None:
            single = request.data.get("participant")
            ids = [single] if single is not None else []
        try:
            ids = [int(i) for i in ids]
        except (TypeError, ValueError):
            return Response({"detail": "participant_ids must be integers."}, status=http.HTTP_400_BAD_REQUEST)
        if not ids:
            return Response({"detail": "Nothing to decide."}, status=http.HTTP_400_BAD_REQUEST)

        rows = list(session.participants.filter(pk__in=ids).select_related("student"))
        for place in rows:
            decide_place(place, approve=approve, actor=request.user)
        return Response({"decided": len(rows), "approved": approve})

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """Open the paper for the whole approved room, on one clock."""
        session = self.get_object()
        if session.status == MockSession.STATUS_ENDED:
            return Response({"detail": "This sitting has already ended."}, status=http.HTTP_400_BAD_REQUEST)
        if session.status == MockSession.STATUS_CANCELLED:
            return Response({"detail": "This sitting was cancelled."}, status=http.HTTP_400_BAD_REQUEST)
        result = start_session(session, actor=request.user)
        payload = self.get_serializer(session).data
        payload.update(result)
        return Response(payload)

    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        """Close the room: every unfinished paper is taken in and scored."""
        session = self.get_object()
        result = end_session(session, actor=request.user)
        payload = self.get_serializer(session).data
        payload.update(result)
        return Response(payload)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        session = self.get_object()
        MockSession.objects.filter(pk=session.pk).update(
            status=MockSession.STATUS_CANCELLED, updated_at=timezone.now()
        )
        session.refresh_from_db()
        return Response(self.get_serializer(session).data)
