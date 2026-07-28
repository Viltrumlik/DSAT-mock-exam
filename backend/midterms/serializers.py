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

from .proctoring import GRACE_SECONDS as OFFSCREEN_GRACE_SECONDS
from .proctoring import VIOLATION_LIMIT as OFFSCREEN_VIOLATION_LIMIT
from .state_machine import (
    STATE_ACTIVE,
    STATE_MODULE_2_ACTIVE,
    STATE_NOT_STARTED,
    WIRE_STATE,
)
from .timing import get_midterm_timing


class MidtermAttemptSerializer(serializers.Serializer):
    """Runner-facing attempt snapshot. Never exposes the answer key or an unreleased score."""

    def to_representation(self, attempt):
        now = timezone.now()
        midterm = attempt.midterm
        state = attempt.current_state
        is_active = state in (STATE_ACTIVE, STATE_MODULE_2_ACTIVE)
        # The module the student is on: 1 while ACTIVE, 2 while MODULE_2_ACTIVE.
        current_order = 2 if state == STATE_MODULE_2_ACTIVE else 1
        count = attempt.module_count()

        mins1 = int(midterm.duration_minutes or 0)
        mins2 = int(midterm.duration_minutes_2 or 0)
        mod1 = attempt.effective_module_for_order(1)
        mod2 = attempt.effective_module_for_order(2) if count >= 2 else None

        timing = get_midterm_timing(attempt, now=now) if is_active else None
        remaining = timing.remaining_seconds if timing else None
        is_expired = bool(timing and timing.is_expired)

        # The list of modules this exam has (1 or 2). Drives the runner's module rail.
        modules_meta = []
        if mod1 is not None:
            modules_meta.append({"id": mod1.id, "module_order": 1, "time_limit_minutes": mins1})
        if mod2 is not None:
            modules_meta.append({"id": mod2.id, "module_order": 2, "time_limit_minutes": mins2})

        module_payload = None
        current_module_id = None
        current_module_start = None
        saved_answers = None
        flagged = None
        module_duration_seconds = None
        cur_mod = mod2 if current_order == 2 else mod1
        cur_mins = mins2 if current_order == 2 else mins1
        if is_active and cur_mod is not None:
            # Serve ONLY the live module's questions/answers/flags/timer. Answers are a flat
            # {qid: ans} dict spanning both modules, so we scope by the current module's ids
            # (a no-op for a single-module attempt, where qids are the whole set).
            cur_questions = list(attempt.effective_questions_for_order(current_order))
            cur_qids = {str(q.id) for q in cur_questions}
            module_payload = {
                "id": cur_mod.id,
                "module_order": current_order,
                "time_limit_minutes": cur_mins,
                "questions": QuestionSerializer(cur_questions, many=True).data,
            }
            current_module_id = cur_mod.id
            anchor = attempt.module_2_started_at if current_order == 2 else attempt.started_at
            current_module_start = anchor.isoformat() if anchor else None
            saved_answers = {k: v for k, v in (attempt.answers or {}).items() if k in cur_qids}
            flagged = [f for f in (attempt.flagged or []) if str(f) in cur_qids]
            module_duration_seconds = cur_mins * 60

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
            "can_resume": state in (STATE_NOT_STARTED, STATE_ACTIVE, STATE_MODULE_2_ACTIVE),
            "results_ready": bool(attempt.is_completed),
            # ── proctoring: off-screen rule ──────────────────────────────────
            # The runner renders the warning and the countdown, so it needs the tally and
            # the limits — but it never DECIDES them (the server owns the count; see
            # MidtermAttemptViewSet.offscreen). Sent on every snapshot so a refresh or a
            # second tab picks up the true count instead of starting from zero.
            "offscreen_violations": int(attempt.offscreen_violations or 0),
            "offscreen_limit": OFFSCREEN_VIOLATION_LIMIT,
            "offscreen_grace_seconds": OFFSCREEN_GRACE_SECONDS,
            "terminated_reason": attempt.terminated_reason or "",
            # Score + answer key are NEVER on the runner path; the review endpoint gates them.
            "score": None,
            "completed_modules": (
                [m.id for m in (mod1, mod2) if m is not None] if attempt.is_completed else []
            ),
        }
