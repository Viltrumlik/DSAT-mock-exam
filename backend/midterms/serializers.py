"""Serializers for the midterm attempt runner + admin authoring.

``MidtermAttemptSerializer`` emits the EXACT top-level contract the frontend exam-runner
consumes (``frontend/src/features/testing-simulation/types/attempt.ts``) so the runner is
reused with zero changes — MINUS pause, and with the per-question answer key ALWAYS masked
(``module_results``/``correct_answers`` never appear; ``score`` is served only by the
dedicated review endpoint under the release gate).
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from exams.serializers import QuestionSerializer

from .state_machine import (
    STATE_ACTIVE,
    STATE_NOT_STARTED,
    WIRE_STATE,
)
from .timing import get_midterm_timing


class MidtermAttemptSerializer(serializers.Serializer):
    """Runner-facing attempt snapshot. Never exposes the answer key or an unreleased score."""

    def to_representation(self, attempt):
        now = timezone.now()
        midterm = attempt.midterm
        # Version-aware: serve the assigned version's questions when the midterm has
        # versions (else the midterm's own module). The version itself is never exposed.
        module = attempt.effective_module
        state = attempt.current_state
        is_active = state == STATE_ACTIVE

        timing = get_midterm_timing(attempt, now=now) if is_active else None
        remaining = timing.remaining_seconds if timing else None
        is_expired = bool(timing and timing.is_expired)

        module_payload = None
        current_module_id = None
        current_module_start = None
        saved_answers = None
        flagged = None
        module_duration_seconds = None
        if is_active and module is not None:
            module_payload = {
                "id": module.id,
                "module_order": 1,
                "time_limit_minutes": int(midterm.duration_minutes or 0),
                "questions": QuestionSerializer(attempt.effective_questions(), many=True).data,
            }
            current_module_id = module.id
            current_module_start = attempt.started_at.isoformat() if attempt.started_at else None
            saved_answers = dict(attempt.answers or {})
            flagged = list(attempt.flagged or [])
            module_duration_seconds = int(midterm.duration_minutes or 0) * 60

        modules_meta = []
        if module is not None:
            modules_meta = [
                {"id": module.id, "module_order": 1, "time_limit_minutes": int(midterm.duration_minutes or 0)}
            ]

        return {
            "id": attempt.id,
            "current_state": WIRE_STATE.get(state, state),
            "version_number": int(attempt.version_number or 0),
            "practice_test_details": {
                "id": midterm.id,
                "subject": midterm.subject,
                "level": midterm.level,
                "title": midterm.title,
                "mock_exam_id": None,
                "mock_kind": "MIDTERM",
                # Authoritative tool gate: Math middle/senior midterms offer Desmos. Computed
                # server-side so the runner never re-derives the rule (subject casing differs).
                "calculator_enabled": bool(midterm.calculator_enabled),
                "modules": modules_meta,
            },
            "current_module": current_module_id,
            "current_module_details": module_payload,
            "current_module_start_time": current_module_start,
            "server_now": now.isoformat(),
            "remaining_seconds": remaining,
            "module_duration_seconds": module_duration_seconds,
            "current_module_saved_answers": saved_answers,
            "current_module_flagged_questions": flagged,
            "is_completed": bool(attempt.is_completed),
            "is_expired": is_expired,
            "is_paused": False,
            "can_submit": bool(is_active and not is_expired),
            "can_resume": state in (STATE_NOT_STARTED, STATE_ACTIVE),
            "results_ready": bool(attempt.is_completed),
            # Score + answer key are NEVER on the runner path; the review endpoint gates them.
            "score": None,
            "completed_modules": [module.id] if (attempt.is_completed and module is not None) else [],
        }
