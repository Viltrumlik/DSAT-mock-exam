"""Student-facing full-mock attempt runner endpoints.

Reuses the exam-runner contract (status/start/submit_module/save_attempt) plus a mock-specific
end_break action. One MockAttempt spans 4 modules + a server-authoritative break; no pause.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.reliability import idempotency_key_from_request

from .access import can_start_mock
from .idempotency import consume_idempotency_key
from .models import Mock, MockAttempt
from .serializers import MockAttemptSerializer
from .state_machine import STATE_ABANDONED, STATE_BREAK, STATE_COMPLETED, STATE_SCORING
from .tasks import enqueue_mock_scoring

logger = logging.getLogger(__name__)

_REASON_DETAIL = {"mock_unpublished": "This mock is not available yet."}


class MockAttemptViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = MockAttemptSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        return MockAttempt.objects.filter(student=self.request.user).select_related("mock")

    def _snapshot(self, attempt):
        return Response(MockAttemptSerializer(attempt).data)

    def _active(self, mock):
        return (
            MockAttempt.objects.filter(student=self.request.user, mock=mock, is_completed=False)
            .exclude(current_state=STATE_ABANDONED)
            .first()
        )

    def _after_submit_snapshot(self, request, pk):
        refreshed = self.get_queryset().get(pk=pk)
        if refreshed.current_state == STATE_SCORING:
            enqueue_mock_scoring(attempt_id=refreshed.id, request=request)
            refreshed.refresh_from_db()
        return self._snapshot(refreshed)

    def create(self, request):
        mock_id = request.data.get("mock") or request.data.get("mock_id")
        mock = get_object_or_404(Mock, pk=mock_id)
        ok, reason = can_start_mock(request.user, mock)
        if not ok:
            return Response({"error": reason, "detail": _REASON_DETAIL.get(reason, "Cannot start this mock.")}, status=status.HTTP_403_FORBIDDEN)
        existing = self._active(mock)
        if existing is not None:
            return Response(MockAttemptSerializer(existing).data, status=status.HTTP_200_OK)
        try:
            attempt = MockAttempt.objects.create(mock=mock, student=request.user)
        except IntegrityError:
            attempt = self._active(mock)
            if attempt is None:
                raise
            return Response(MockAttemptSerializer(attempt).data, status=status.HTTP_200_OK)
        return Response(MockAttemptSerializer(attempt).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        return self._snapshot(get_object_or_404(self.get_queryset(), pk=pk))

    @action(detail=True, methods=["get"])
    def status(self, request, pk=None):
        return self._snapshot(get_object_or_404(self.get_queryset(), pk=pk))

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)

        def compute():
            with transaction.atomic():
                self.get_queryset().select_for_update().get(pk=pk).start_attempt()
            return self._snapshot(self.get_queryset().get(pk=pk))

        return consume_idempotency_key(attempt=attempt, endpoint="start", key=idempotency_key_from_request(request), compute=compute)

    @action(detail=True, methods=["post"], url_path="submit_module")
    def submit_module(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        answers = request.data.get("answers") or {}
        flagged = request.data.get("flagged")

        def compute():
            with transaction.atomic():
                locked = self.get_queryset().select_for_update().get(pk=pk)
                locked.submit_module(answers=answers, flagged=flagged)
            return self._after_submit_snapshot(request, pk)

        return consume_idempotency_key(attempt=attempt, endpoint="submit_module", key=idempotency_key_from_request(request), compute=compute)

    @action(detail=True, methods=["post"], url_path="save_attempt")
    def save_attempt(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        answers = request.data.get("answers") or {}
        flagged = request.data.get("flagged")

        def compute():
            auto_submitted = False
            with transaction.atomic():
                locked = self.get_queryset().select_for_update().get(pk=pk)
                timing = locked.get_timing()
                if timing and timing.is_expired:
                    locked.submit_module(answers=answers, flagged=flagged)  # deadline passed -> advance
                    auto_submitted = True
                else:
                    locked.autosave(answers=answers, flagged=flagged)
            resp = self._after_submit_snapshot(request, pk)
            if auto_submitted:
                resp.data["is_expired"] = True
            return resp

        return consume_idempotency_key(attempt=attempt, endpoint="save_attempt", key=idempotency_key_from_request(request), compute=compute)

    @action(detail=True, methods=["post"], url_path="end_break")
    def end_break(self, request, pk=None):
        """Proceed from the break to Math (student clicks Start Math, or the timer elapsed)."""
        attempt = get_object_or_404(self.get_queryset(), pk=pk)

        def compute():
            with transaction.atomic():
                self.get_queryset().select_for_update().get(pk=pk).end_break()
            return self._snapshot(self.get_queryset().get(pk=pk))

        return consume_idempotency_key(attempt=attempt, endpoint="end_break", key=idempotency_key_from_request(request), compute=compute)

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        if not (attempt.is_completed and attempt.current_state == STATE_COMPLETED):
            return Response({"detail": "Results not ready."}, status=status.HTTP_403_FORBIDDEN)
        return Response({
            "mock_kind": "MOCK",
            "title": attempt.mock.title,
            "english_score": attempt.english_score,
            "math_score": attempt.math_score,
            "total_score": attempt.total_score,
            "score_ceiling": 1600,
        })
