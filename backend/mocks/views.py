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


def _expected_version(request):
    """The attempt version the client believes it is writing on top of, if it named one."""
    raw = request.data.get("expected_version_number")
    if raw is None:
        raw = request.headers.get("If-Match")
    if raw is None:
        return None
    try:
        return int(str(raw).strip().strip('"'))
    except (TypeError, ValueError):
        return None


def _is_background_save(request) -> bool:
    """Whether this save is a fire-and-forget flush from a leaving/hidden tab.

    ``examApiClient.saveAttemptKeepalive`` sets it on pagehide/close. Such a request proves
    the student is NOT looking at the exam, so it may persist answers but must never advance
    the attempt — opening the next module would start its 32/35-minute clock on a closed tab
    and burn it before the student ever sees a question. Same rule the midterm runs.
    """
    return bool(request.data.get("background"))


class MockAttemptViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = MockAttemptSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        return MockAttempt.objects.filter(student=self.request.user).select_related("mock")

    def _snapshot(self, attempt):
        return Response(MockAttemptSerializer(attempt).data)

    def _conflict(self, attempt):
        return Response(
            {
                "error": "Version conflict.",
                "detail": "Attempt was updated elsewhere; refresh required.",
                "attempt": MockAttemptSerializer(attempt).data,
            },
            status=status.HTTP_409_CONFLICT,
        )

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
            noop = False
            with transaction.atomic():
                locked = self.get_queryset().select_for_update().get(pk=pk)
                # Module-targeted submit (idempotency BY MODULE): a retried/duplicate submit
                # prepared for an EARLIER module must never finalize the module the attempt has
                # since advanced to. The full mock has FOUR submittable boundaries
                # (E1->E2->BREAK->M1->M2), so the same retry that skipped Module 2 on pastpapers
                # would skip a mock section here. If the targeted module is no longer active, the
                # intended submit already landed: return current state as a success no-op.
                _target_mid = request.data.get("module_id")
                try:
                    _target_mid = int(_target_mid) if _target_mid is not None else None
                except (TypeError, ValueError):
                    _target_mid = None
                if _target_mid is not None:
                    _active = locked.mock.active_module(locked.current_state)
                    if getattr(_active, "id", None) != _target_mid:
                        noop = True
                        logger.info(
                            "[FORENSIC] mock_submit_module_stale_target_noop attempt_id=%s target=%s current_state=%s active=%s",
                            locked.pk, _target_mid, locked.current_state, getattr(_active, "id", None),
                        )
                if not noop:
                    timing = locked.get_timing()
                    if timing and timing.is_expired:
                        # Deadline passed: advance WITHOUT accepting the late payload —
                        # already-autosaved answers still count. Closes the timer-bypass
                        # where a client suppresses autosave to keep a module open and
                        # then submits answers entered after the server deadline.
                        locked.submit_module(answers=None, flagged=None)
                    else:
                        locked.submit_module(answers=answers, flagged=flagged)
            return self._after_submit_snapshot(request, pk)

        return consume_idempotency_key(attempt=attempt, endpoint="submit_module", key=idempotency_key_from_request(request), compute=compute)

    @action(detail=True, methods=["post"], url_path="save_attempt")
    def save_attempt(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        answers = request.data.get("answers") or {}
        flagged = request.data.get("flagged")
        expected = _expected_version(request)
        background = _is_background_save(request)

        def compute():
            auto_submitted = False
            with transaction.atomic():
                locked = self.get_queryset().select_for_update().get(pk=pk)
                # A stale duplicate tab must not re-assert answers the live tab has moved
                # past: answer the drift with a hard 409 carrying the canonical attempt.
                if expected is not None and int(locked.version_number or 0) != expected:
                    return self._conflict(locked)
                timing = locked.get_timing()
                expired = bool(timing and timing.is_expired)
                if expired and background:
                    # A keepalive flush that arrives AFTER the deadline writes NOTHING. It
                    # must not advance (module 2's clock would run on a closed tab) and it
                    # must not autosave either — `autosave` has no expiry check of its own,
                    # so banking a post-deadline payload here would let any crafted client
                    # hold a module open forever just by setting `background`. Whatever was
                    # saved before the bell stands; `sweep_mock_attempts` closes the attempt.
                    pass
                elif expired:
                    # Deadline passed: close the module WITHOUT accepting the late payload.
                    # submit_module (the endpoint) already refuses late answers; accepting
                    # them here would just move the timer bypass one endpoint sideways.
                    locked.submit_module(answers=None, flagged=None)
                    auto_submitted = True
                else:
                    locked.autosave(answers=answers, flagged=flagged)
            resp = self._after_submit_snapshot(request, pk)
            # Only the LAST module reaching SCORING means "the paper is over". An E1->E2 or
            # M1->M2 auto-advance is not the end of the mock, and the snapshot's own
            # is_expired is already correct for the fresh module — forcing the flag there
            # would tell the runner the exam had ended halfway through it.
            if auto_submitted and self.get_queryset().get(pk=pk).current_state in (STATE_SCORING, STATE_COMPLETED):
                resp.data["is_expired"] = True
            return resp

        return consume_idempotency_key(attempt=attempt, endpoint="save_attempt", key=idempotency_key_from_request(request), compute=compute)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        """Freeze the active module's clock because the student left the exam.

        A full mock has no pause BUTTON — this is only ever fired by the runner's
        leave handlers (tab hidden, page hide, navigate away). Without it a dropped
        connection or a closed laptop burns a 32/35-minute module the student cannot
        see. The break is not pausable and this no-ops there.
        """
        get_object_or_404(self.get_queryset(), pk=pk)  # ownership / 404 guard
        with transaction.atomic():
            self.get_queryset().select_for_update().get(pk=pk).pause()
        return self._snapshot(self.get_queryset().get(pk=pk))

    @action(detail=True, methods=["post"], url_path="resume_pause")
    def resume_pause(self, request, pk=None):
        """Bank the time the student was away and start the clock again. Idempotent."""
        get_object_or_404(self.get_queryset(), pk=pk)  # ownership / 404 guard
        with transaction.atomic():
            self.get_queryset().select_for_update().get(pk=pk).resume_pause()
        return self._snapshot(self.get_queryset().get(pk=pk))

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
