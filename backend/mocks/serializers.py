"""Serializer for the mock attempt runner.

Emits the exact top-level contract the frontend exam-runner consumes, for the ACTIVE
section's module — plus mock-specific extras (`is_on_break`, `break_remaining_seconds`)
the frontend uses to show the between-sections break screen. mock_kind='MOCK' (not MIDTERM)
so the runner keeps the calculator on the Math section.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from exams.serializers import QuestionSerializer

from .state_machine import (
    ACTIVE_MODULE,
    STATE_BREAK,
    STATE_ENGLISH_M1,
    STATE_ENGLISH_M2,
    STATE_MATH_M1,
    STATE_MATH_M2,
    STATE_NOT_STARTED,
    WIRE_STATE,
)

_RESUMABLE = {STATE_NOT_STARTED, STATE_ENGLISH_M1, STATE_ENGLISH_M2, STATE_BREAK, STATE_MATH_M1, STATE_MATH_M2}
READING_WRITING = "READING_WRITING"


class MockAttemptSerializer(serializers.Serializer):
    def to_representation(self, attempt):
        now = timezone.now()
        mock = attempt.mock
        state = attempt.current_state
        active = mock.active_module(state)
        is_active = active is not None
        on_break = state == STATE_BREAK

        timing = attempt.get_timing(now=now) if is_active else None
        remaining = timing.remaining_seconds if timing else None
        is_expired = bool(timing and timing.is_expired)
        break_t = attempt.get_break_timing(now=now) if on_break else None
        break_remaining = break_t.remaining_seconds if break_t else None

        subject = READING_WRITING
        section_modules: list = []
        module_payload = None
        saved_answers = None
        flagged = None
        current_module_id = None
        current_module_start = None
        module_duration = None

        if is_active:
            subject = ACTIVE_MODULE[state][0]
            mods = mock.english_modules() if subject == READING_WRITING else mock.math_modules()
            section_modules = [
                {"id": m.id, "module_order": m.module_order, "time_limit_minutes": m.time_limit_minutes} for m in mods
            ]
            module_payload = {
                "id": active.id,
                "module_order": active.module_order,
                "time_limit_minutes": int(active.time_limit_minutes or 0),
                "questions": QuestionSerializer(active.questions.all().order_by("order", "id"), many=True).data,
            }
            current_module_id = active.id
            current_module_start = (attempt.phase_started_at or {}).get(state)
            saved_answers = dict((attempt.module_answers or {}).get(str(active.id), {}))
            flagged = list((attempt.flagged or {}).get(str(active.id), []))
            module_duration = int(active.time_limit_minutes or 0) * 60
        elif state in (STATE_MATH_M1, STATE_MATH_M2):
            subject = "MATH"

        return {
            "id": attempt.id,
            "current_state": WIRE_STATE.get(state, state),
            "version_number": int(attempt.version_number or 0),
            "practice_test_details": {
                "id": mock.id,
                "subject": subject,
                "title": mock.title,
                "mock_exam_id": None,
                "mock_kind": "MOCK",
                "modules": section_modules,
            },
            "current_module": current_module_id,
            "current_module_details": module_payload,
            "current_module_start_time": current_module_start,
            "server_now": now.isoformat(),
            "remaining_seconds": remaining,
            "module_duration_seconds": module_duration,
            "current_module_saved_answers": saved_answers,
            "current_module_flagged_questions": flagged,
            "is_completed": bool(attempt.is_completed),
            "is_expired": is_expired,
            "is_paused": False,
            "can_submit": bool(is_active and not is_expired),
            "can_resume": state in _RESUMABLE,
            "results_ready": bool(attempt.is_completed),
            "score": None,  # runner never shows the score; the results endpoint does
            "completed_modules": [],
            # ── mock-specific extras (frontend break screen) ──
            "is_on_break": on_break,
            "break_remaining_seconds": break_remaining,
            "mock_phase": state,
        }
