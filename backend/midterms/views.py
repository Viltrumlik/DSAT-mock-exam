"""Student-facing midterm attempt runner endpoints.

Mirrors the shape of ``exams.TestAttemptViewSet`` (status/start/submit_module/save_attempt)
so the frontend exam-runner is reused by pointing its API client at this base path. There is
NO pause endpoint (midterms are strictly timed), NO retake (enforced at create), and the
answer key / unreleased score is never exposed (see MidtermAttemptSerializer + review()).
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

from .access import can_start_midterm, midterm_results_state
from .idempotency import consume_idempotency_key
from .models import Midterm, MidtermAttempt
from .serializers import MidtermAttemptSerializer
from .state_machine import STATE_ABANDONED, STATE_ACTIVE, STATE_COMPLETED, STATE_SCORING
from .tasks import enqueue_midterm_scoring

logger = logging.getLogger(__name__)

_REASON_DETAIL = {
    "midterm_unpublished": "This midterm is not available yet.",
    "midterm_completed": "You have already completed this midterm.",
    "no_access": "You do not have access to this midterm.",
    "midterm_not_open": "This midterm has not opened yet.",
    "midterm_closed": "This midterm's deadline has passed.",
}


def _expected_version(request):
    raw = request.data.get("expected_version_number")
    if raw is None:
        raw = request.headers.get("If-Match")
    if raw is None:
        return None
    try:
        return int(str(raw).strip().strip('"'))
    except (TypeError, ValueError):
        return None


class MidtermAttemptViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = MidtermAttemptSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        return MidtermAttempt.objects.filter(student=self.request.user).select_related(
            "midterm", "midterm__question_module"
        )

    def _lock_queryset(self):
        """Row-lock queryset for mutating transitions.

        NEVER select_related the nullable ``midterm__question_module`` here: Postgres
        rejects ``SELECT ... FOR UPDATE`` on the nullable side of an outer join
        (``FeatureNotSupported``), which 500s start/save/submit. ``midterm`` is non-null,
        so its inner join is safe and keeps the instance usable by the transition methods.
        """
        return MidtermAttempt.objects.filter(student=self.request.user).select_related("midterm")

    def _snapshot(self, attempt) -> Response:
        return Response(MidtermAttemptSerializer(attempt).data)

    def _conflict(self, attempt) -> Response:
        return Response(
            {
                "error": "Version conflict.",
                "detail": "Attempt was updated elsewhere; refresh required.",
                "attempt": MidtermAttemptSerializer(attempt).data,
            },
            status=status.HTTP_409_CONFLICT,
        )

    def _active_attempt(self, midterm):
        return (
            MidtermAttempt.objects.filter(student=self.request.user, midterm=midterm, is_completed=False)
            .exclude(current_state=STATE_ABANDONED)
            .first()
        )

    # POST /midterms/attempts/  {midterm}  -> create-or-resume (holds NOT_STARTED; runner shows welcome)
    def create(self, request):
        midterm_id = request.data.get("midterm") or request.data.get("midterm_id")
        midterm = get_object_or_404(Midterm, pk=midterm_id)
        ok, reason = can_start_midterm(request.user, midterm)
        if not ok:
            return Response(
                {"error": reason, "detail": _REASON_DETAIL.get(reason, "Cannot start this midterm.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        existing = self._active_attempt(midterm)
        if existing is not None:
            return Response(MidtermAttemptSerializer(existing).data, status=status.HTTP_200_OK)
        try:
            attempt = MidtermAttempt.objects.create(midterm=midterm, student=request.user)
        except IntegrityError:
            attempt = self._active_attempt(midterm)
            if attempt is None:
                raise
            return Response(MidtermAttemptSerializer(attempt).data, status=status.HTTP_200_OK)
        return Response(MidtermAttemptSerializer(attempt).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        return self._snapshot(attempt)

    @action(detail=True, methods=["get"])
    def status(self, request, pk=None):
        # Read-only snapshot for timer resume / polling. Never mutates.
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        return self._snapshot(attempt)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)

        def compute():
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                locked.start_attempt()
            return self._snapshot(self.get_queryset().get(pk=pk))

        return consume_idempotency_key(
            attempt=attempt, endpoint="start", key=idempotency_key_from_request(request), compute=compute
        )

    @action(detail=True, methods=["post"], url_path="submit_module")
    def submit_module(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        # A midterm can't be submitted early — it may only end when its timer runs
        # out (the deadline is authoritative, enforced here regardless of client).
        # Checked before the idempotency wrapper so the 403 is never cached and a
        # legitimate post-deadline submit with the same key still succeeds.
        if attempt.current_state == STATE_ACTIVE:
            timing = attempt.get_timing()
            if timing is not None and not timing.is_expired:
                return Response(
                    {"detail": "This midterm can only be submitted when its time runs out."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        answers = request.data.get("answers") or {}
        flagged = request.data.get("flagged")

        def compute():
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                if locked.current_state == STATE_ACTIVE:
                    # Late/expired explicit submit is still accepted (merge + advance).
                    locked.submit(answers=answers, flagged=flagged)
            refreshed = self.get_queryset().get(pk=pk)
            if refreshed.current_state == STATE_SCORING:
                enqueue_midterm_scoring(attempt_id=refreshed.id, request=request)
                refreshed.refresh_from_db()
            return self._snapshot(refreshed)

        return consume_idempotency_key(
            attempt=attempt, endpoint="submit_module", key=idempotency_key_from_request(request), compute=compute
        )

    @action(detail=True, methods=["post"], url_path="save_attempt")
    def save_attempt(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        answers = request.data.get("answers") or {}
        flagged = request.data.get("flagged")
        expected = _expected_version(request)

        def compute():
            auto_submitted = False
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                if locked.current_state == STATE_ACTIVE:
                    # Autosave is a HARD conflict on version drift (stale tab) — mirror exams.
                    if expected is not None and int(locked.version_number or 0) != expected:
                        return self._conflict(locked)
                    timing = locked.get_timing()
                    if timing and timing.is_expired:
                        locked.submit(answers=answers, flagged=flagged)  # deadline passed -> auto-submit
                        auto_submitted = True
                    else:
                        locked.autosave(answers=answers, flagged=flagged)
            refreshed = self.get_queryset().get(pk=pk)
            if auto_submitted and refreshed.current_state == STATE_SCORING:
                enqueue_midterm_scoring(attempt_id=refreshed.id, request=request)
                refreshed.refresh_from_db()
            resp = self._snapshot(refreshed)
            if auto_submitted:
                resp.data["is_expired"] = True
            return resp

        return consume_idempotency_key(
            attempt=attempt, endpoint="save_attempt", key=idempotency_key_from_request(request), compute=compute
        )

    @action(detail=True, methods=["get"])
    def review(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        if not (attempt.is_completed and attempt.current_state == STATE_COMPLETED):
            return Response({"detail": "Results not ready."}, status=status.HTTP_403_FORBIDDEN)
        state = midterm_results_state(attempt)
        midterm = attempt.midterm
        payload = {
            "score_only": True,
            "released": bool(state["results_visible"]),
            "mock_kind": "MIDTERM",
            "subject": midterm.subject,
            "scoring_scale": midterm.scoring_scale,
        }
        if state["results_visible"]:
            payload["total_score"] = attempt.score
            payload["score_ceiling"] = midterm.score_ceiling
        if state.get("certificate"):
            payload["certificate"] = state["certificate"]
        return Response(payload)

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        return self.review(request, pk=pk)
