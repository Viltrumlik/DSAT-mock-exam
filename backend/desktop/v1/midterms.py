"""Midterms on ``/api/desktop/v1/``, with every rule the website enforces kept.

    POST midterms/{midterm_id}/prepare          {code?}   start gate, create-or-resume, code check
    POST midterms/attempts/{id}/open            {have}    X-Lockdown-Session; live module only
    POST midterms/attempts/{id}/sync            X-Lockdown-Session + Idempotency-Key
    POST midterms/attempts/{id}/submit          X-Lockdown-Session + Idempotency-Key
    POST midterms/attempts/{id}/offscreen       X-Lockdown-Session + Idempotency-Key
    GET  midterms/attempts/{id}/result

The challenge/session handshake stays where it is (``desktop_challenge/`` and
``desktop_session/`` on the midterm attempt). Nothing here owns a rule:

* the start gate is ``midterms.access.can_start_midterm``; create-or-resume pins the version
  and spends a re-sit exactly as ``MidtermAttemptViewSet.create`` does;
* the lockdown token check is ``desktop.lockdown.refusal`` (never ``reading``: content always
  needs the token while the rule applies);
* the clock is the server's (``midterms.views._module_deadline``), late answers are banked up
  to ``LATE_ANSWER_GRACE_SECONDS`` past a module's deadline (``_late_answers_accepted``) and
  dropped after it (``_drop_late_payload``), and a module ends only when its time is up;
* off-screen strikes are counted on the server, once per idempotency key, and the third
  ends the sitting (``submit_final``).

``sync`` never changes state: module 2's anchor is capped at the module-1 deadline plus the
grace in the model, so an early or late transition gains nobody anything.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle

from desktop import lockdown as desktop_lockdown
from midterms.access import (
    can_start_midterm,
    consume_resit,
    midterm_results_state,
    resolve_midterm_schedule,
    resolve_version_for_student,
)
from midterms.engine_db_guard import TransitionConflict
from midterms.models import Midterm, MidtermAttempt
from midterms.proctoring import GRACE_SECONDS as OFFSCREEN_GRACE_SECONDS
from midterms.proctoring import VIOLATION_LIMIT as OFFSCREEN_VIOLATION_LIMIT
from midterms.state_machine import (
    STATE_ABANDONED,
    STATE_ACTIVE,
    STATE_COMPLETED,
    STATE_MODULE_2_ACTIVE,
    STATE_NOT_STARTED,
    STATE_SCORING,
    WIRE_STATE,
    TransitionNotAllowed,
)
from midterms.tasks import enqueue_midterm_scoring
from midterms.views import (
    _REASON_DETAIL,
    LATE_ANSWER_GRACE_SECONDS,
    _drop_late_payload,
    _late_answers_accepted,
    _module_deadline,
)

from . import content, idem
from .conventions import (
    POLL_AFTER_MS,
    V1APIView,
    bad_request,
    error,
    forbidden,
    lockdown_refusal,
    midterm_media_ttl,
    ms,
    not_visible,
    ok,
    parse_have,
    parse_sync_body,
    require_idempotency_key,
    state_conflict,
)
from .media import signed_media
from .snapshots import fresh_midterm, midterm_lite

logger = logging.getLogger(__name__)

RUNNING = (STATE_ACTIVE, STATE_MODULE_2_ACTIVE)
FINISHED = (STATE_SCORING, STATE_COMPLETED)

REASON_MODULE_NOT_ACTIVE = "module_not_active"
REASON_LATE = "late"

CODE_INCORRECT_DETAIL = "That code doesn't match. Check it with your teacher and try again."
CODE_REQUIRED_DETAIL = "Enter the access code from your teacher to begin."
NOT_EXPIRED_DETAIL = "This module is still running."
NOT_RUNNING_DETAIL = "This midterm is no longer running."

#: Midterm.calculator_mode → the app's CalculatorMode wire value.
_CALCULATOR = {Midterm.CALCULATOR_FULL: "graphing", Midterm.CALCULATOR_SCIENTIFIC: "scientific"}


# ── throttles ────────────────────────────────────────────────────────────────────────────
class _LiveScopedThrottle(ScopedRateThrottle):
    """``ScopedRateThrottle`` that reads its rate from the live settings each time (the stock
    class captures ``DEFAULT_THROTTLE_RATES`` at import, so a changed env var or a test's
    ``override_settings`` would never reach it). Keyed per student."""

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)


class PrepareThrottle(_LiveScopedThrottle):
    scope_attr = "throttle_scope"


class CodeThrottle(_LiveScopedThrottle):
    """Counts only the prepares that carry a code, so the 6-digit code cannot be guessed
    through ``prepare`` while ordinary reopenings never run into it."""

    def allow_request(self, request, view):
        data = request.data if isinstance(request.data, dict) else {}
        if data.get("code") in (None, ""):
            return True
        self.scope = "desktop_v1_code"
        self.rate = self.get_rate()
        if self.rate is None:
            return True
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return super(ScopedRateThrottle, self).allow_request(request, view)


# ── shared ───────────────────────────────────────────────────────────────────────────────
class MidtermView(V1APIView):
    permission_classes = [IsAuthenticated]  # as MidtermAttemptViewSet


def calculator_for(midterm: Midterm) -> str | None:
    return _CALCULATOR.get(midterm.calculator_mode)


def own_attempt(request, attempt_id: int) -> MidtermAttempt:
    attempt = (
        MidtermAttempt.objects.filter(pk=attempt_id, student=request.user).select_related("midterm").first()
    )
    if attempt is None:
        raise not_visible()
    return attempt


def require_lockdown(request, attempt: MidtermAttempt) -> None:
    """The sitting's lockdown token, while the rule applies — never ``reading``."""
    refused = desktop_lockdown.refusal(request, attempt)
    if refused is not None:
        raise lockdown_refusal(refused)


def _order_of(attempt: MidtermAttempt, module_id: int) -> int | None:
    """Which of THIS attempt's modules ``module_id`` is (1 or 2); None if it is not one."""
    for order in (1, 2):
        if getattr(attempt.effective_module_for_order(order), "id", None) == module_id:
            return order
    return None


def _question_ids(attempt: MidtermAttempt, order: int) -> set[int]:
    return set(attempt.effective_questions_for_order(order).values_list("id", flat=True))


def _module_content(attempt: MidtermAttempt, order: int, have: dict) -> tuple[dict | None, list[str], list[int]]:
    """One module of this sitting's own paper: ``(block, image_keys, question_ids)``."""
    module = attempt.effective_module_for_order(order)
    if module is None:
        return None, [], []
    questions = list(attempt.effective_questions_for_order(order))
    payload = content.questions_payload(questions)
    block = content.module_block(
        module_id=module.id,
        order=order,
        time_limit_minutes=attempt.midterm.duration_for_order(order),
        questions=payload,
        have=have,
    )
    return block, content.image_keys(payload), [q.id for q in questions]


def _conflict(attempt_id: int, detail: str = "The attempt is no longer in that state.") -> Exception:
    return state_conflict(midterm_lite(fresh_midterm(attempt_id)), detail)


def _active_attempt(user, midterm):
    return (
        MidtermAttempt.objects.filter(student=user, midterm=midterm, is_completed=False)
        .exclude(current_state=STATE_ABANDONED)
        .first()
    )


# ── prepare ──────────────────────────────────────────────────────────────────────────────
class MidtermPrepareView(MidtermView):
    """Everything before the lockdown handshake, in one request: the start gate, the sitting
    (created or resumed), and the access code. No questions — a NOT_STARTED sitting's
    summary is deliberately readable anywhere (``refusal(..., reading=True)`` lets it through)."""

    throttle_classes = [PrepareThrottle, CodeThrottle]
    throttle_scope = "desktop_v1_prepare"

    def post(self, request, midterm_id: int):
        data = request.data if isinstance(request.data, dict) else {}
        code = data.get("code")
        if code is not None and not isinstance(code, (str, int)):
            raise bad_request("code must be a string.")
        code = str(code).strip() if code is not None else ""
        user = request.user

        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            raise not_visible()
        allowed, reason = can_start_midterm(user, midterm)
        if not allowed:
            if reason in ("no_access", "midterm_unpublished"):
                raise not_visible()
            raise forbidden(_REASON_DETAIL.get(reason, "You can't start this midterm right now."), reason=reason)

        attempt = _active_attempt(user, midterm)
        if attempt is None:
            version = resolve_version_for_student(user, midterm)
            try:
                with transaction.atomic():
                    attempt = MidtermAttempt.objects.create(midterm=midterm, student=user, version=version)
            except IntegrityError:
                attempt = _active_attempt(user, midterm)
                if attempt is None:
                    raise
            else:
                # Spent here, as on the website: the student has now actually opened the paper.
                consume_resit(user, midterm, attempt)

        schedule = resolve_midterm_schedule(user, midterm)
        requires_code = bool(schedule is not None and schedule.requires_code())
        if code and requires_code:
            if not schedule.code_matches(code):
                raise error(status.HTTP_403_FORBIDDEN, "code_incorrect", CODE_INCORRECT_DETAIL)
            if attempt.code_verified_at is None:
                MidtermAttempt.objects.filter(pk=attempt.pk).update(code_verified_at=timezone.now())

        fresh = fresh_midterm(attempt.pk)
        module_count = fresh.module_count()
        orders = list(range(1, module_count + 1))
        return ok(
            {
                "attempt": midterm_lite(fresh),
                "requires_code": requires_code,
                "code_verified": fresh.code_verified_at is not None,
                "rules": {
                    "title": midterm.title,
                    "subject": midterm.subject,
                    "question_count": sum(fresh.effective_questions_for_order(o).count() for o in orders),
                    "module_count": module_count,
                    "durations_min": [midterm.duration_for_order(o) for o in orders],
                    "calculator": calculator_for(midterm),
                    "offscreen_limit": OFFSCREEN_VIOLATION_LIMIT,
                    "offscreen_grace_seconds": OFFSCREEN_GRACE_SECONDS,
                    "late_grace_seconds": LATE_ANSWER_GRACE_SECONDS,
                },
            }
        )


# ── open ─────────────────────────────────────────────────────────────────────────────────
def test_block(midterm: Midterm) -> dict:
    """``test`` in the bundle. No reference sheet on a midterm (the website runner shows it on
    Math past papers only); the calculator is the midterm's level-gated mode."""
    return {
        "id": midterm.id,
        "subject": midterm.subject,
        "title": midterm.title,
        "label": None,
        "form_type": None,
        "practice_date": None,
        "collection_name": None,
        "tools": {"calculator": calculator_for(midterm), "reference_sheet": False},
    }


def _saved_for(attempt: MidtermAttempt, module_id: int, question_ids: list[int]) -> tuple[dict, dict]:
    ids = {str(q) for q in question_ids}
    stored = attempt.answers or {}
    answers = {
        str(k): str(v) for k, v in stored.items() if str(k) in ids and v is not None and str(v).strip() != ""
    }
    flags: list[int] = []
    for f in attempt.flagged or []:
        if str(f) in ids:
            value = int(f)
            if value not in flags:
                flags.append(value)
    return {str(module_id): answers}, {str(module_id): flags}


class MidtermOpenView(MidtermView):
    """The live module's content — only to the window holding the sitting's lockdown token —
    then the clock starts (``start_attempt`` does nothing once it is running)."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        require_lockdown(request, attempt)
        data = request.data if isinstance(request.data, dict) else {}
        have = parse_have(data.get("have"))

        if attempt.current_state == STATE_NOT_STARTED:
            schedule = resolve_midterm_schedule(request.user, attempt.midterm)
            if schedule is not None and schedule.requires_code() and attempt.code_verified_at is None:
                raise forbidden(CODE_REQUIRED_DETAIL, reason="code_required")
        try:
            with transaction.atomic():
                locked = (
                    MidtermAttempt.objects.select_for_update(of=("self",))
                    .select_related("midterm")
                    .get(pk=attempt.pk)
                )
                locked.start_attempt()
        except (TransitionConflict, TransitionNotAllowed):
            raise _conflict(attempt.pk, NOT_RUNNING_DETAIL)

        fresh = fresh_midterm(attempt.pk)
        if fresh.current_state not in RUNNING:
            raise _conflict(attempt.pk, NOT_RUNNING_DETAIL)
        order = fresh.current_module_order
        block, keys, question_ids = _module_content(fresh, order, have)
        if block is None:
            raise error(status.HTTP_400_BAD_REQUEST, "practice_test_empty", "This midterm has no questions yet.")
        answers, flagged = _saved_for(fresh, block["id"], question_ids)
        return ok(
            {
                "attempt": midterm_lite(fresh),
                "test": test_block(fresh.midterm),
                "modules": [block],
                "answers": answers,
                "flagged": flagged,
                "media": signed_media(keys, ttl_seconds=midterm_media_ttl(), request=request),
                "annotations": content.annotations_for(student=request.user, ref=f"mt-{fresh.id}"),
            }
        )


# ── sync ─────────────────────────────────────────────────────────────────────────────────
class MidtermSyncView(MidtermView):
    """The heartbeat. Banks answers while the module runs and up to the late grace past its
    deadline; never changes state."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        require_lockdown(request, attempt)
        key = require_idempotency_key(request)
        body = parse_sync_body(request.data)

        def compute(locked):
            if locked.current_state not in RUNNING:
                return idem.Outcome(body={"applied": False, "reason": REASON_MODULE_NOT_ACTIVE})
            live_order = locked.current_module_order
            target_order = _order_of(locked, body.module_id)
            if target_order is None or target_order > live_order:
                return idem.Outcome(body={"applied": False, "reason": REASON_MODULE_NOT_ACTIVE})
            question_ids = _question_ids(locked, target_order)
            answers = body.answers_for(question_ids)
            if not _late_answers_accepted(locked, target_order=target_order):
                _drop_late_payload(locked, endpoint="desktop_v1_sync", order=target_order, answers=answers)
                return idem.Outcome(body={"applied": False, "reason": REASON_LATE})
            if target_order == live_order:
                applied = locked.autosave(answers=answers, flagged=body.flagged_for(question_ids))
            else:
                # A copy for module 1 arriving after module 2 began: bank its answers (inside
                # module 1's grace), leave the flags alone — the live module's flag set is
                # module 2's now.
                applied = locked.autosave(answers=answers, flagged=None)
            return idem.Outcome(
                body={"applied": bool(applied), "reason": None if applied else REASON_MODULE_NOT_ACTIVE}
            )

        outcome = idem.run(attempt=attempt, endpoint=idem.ENDPOINT_SYNC, key=key, compute=compute)
        return ok(
            {
                "applied": bool(outcome.body.get("applied")),
                "reason": outcome.body.get("reason"),
                "attempt": midterm_lite(fresh_midterm(attempt.pk)),
            }
        )


# ── submit ───────────────────────────────────────────────────────────────────────────────
class MidtermSubmitView(MidtermView):
    """A module ends only when its time is up. Early → 409 ``module_not_expired`` with
    ``retry_after_ms`` — checked BEFORE the idempotency layer, so it is never stored and the
    same key succeeds once the deadline passes. Then the website's exact module-targeted,
    late-graced submit."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        require_lockdown(request, attempt)
        key = require_idempotency_key(request)
        body = parse_sync_body(request.data)

        if attempt.current_state in RUNNING:
            live = attempt.effective_module_for_order(attempt.current_module_order)
            # Only a submit for the LIVE module can be early. A retry of a module-1 submit
            # that already advanced the sitting must reach its stored outcome, not be told
            # to wait for module 2's clock.
            if getattr(live, "id", None) == body.module_id:
                timing = attempt.get_timing()
                forfeited = int(attempt.offscreen_violations or 0) >= OFFSCREEN_VIOLATION_LIMIT
                if timing is not None and not timing.is_expired and not forfeited:
                    deadline = _module_deadline(attempt, attempt.current_module_order)
                    if deadline is not None:
                        retry_after_ms = max(1, ms(deadline - timezone.now()))
                    else:  # pragma: no cover - a running module always has its anchor
                        retry_after_ms = max(1, int(timing.remaining_seconds) * 1000)
                    raise error(
                        status.HTTP_409_CONFLICT,
                        "module_not_expired",
                        NOT_EXPIRED_DETAIL,
                        retry_after_ms=retry_after_ms,
                        attempt=midterm_lite(fresh_midterm(attempt.pk)),
                    )

        def compute(locked):
            noop = {"applied": False, "reason": REASON_MODULE_NOT_ACTIVE, "transitioned_to": None}
            if locked.current_state not in RUNNING:
                return idem.Outcome(body=noop)
            live_order = locked.current_module_order
            target_order = _order_of(locked, body.module_id)
            if target_order is None:
                return idem.Outcome(body=noop)
            question_ids = _question_ids(locked, target_order)
            answers = body.answers_for(question_ids)
            if target_order != live_order:
                # Stale target: the submit it was prepared for already landed. Never finalize
                # the live module with it — but bank its answers inside the grace of the
                # module it was FOR (the live module's fresh clock would wave anything in).
                logger.info(
                    "[FORENSIC] desktop_v1_midterm_submit_stale_target_noop attempt_id=%s target=%s state=%s",
                    locked.pk, body.module_id, locked.current_state,
                )
                if target_order < live_order:
                    if _late_answers_accepted(locked, target_order=target_order):
                        locked.autosave(answers=answers, flagged=None)
                    else:
                        _drop_late_payload(
                            locked, endpoint="desktop_v1_submit_stale", order=target_order, answers=answers
                        )
                return idem.Outcome(body=noop)
            if _late_answers_accepted(locked):
                moved = locked.submit(answers=answers, flagged=body.flagged_for(question_ids))
                applied, reason = True, None
            else:
                # Past the grace the module still ends — just without answers the server never
                # saw. Everything saved on time is scored exactly as it was.
                _drop_late_payload(locked, endpoint="desktop_v1_submit", order=live_order, answers=answers)
                moved = locked.submit(answers=None, flagged=None)
                applied, reason = False, REASON_LATE
            transitioned_to = WIRE_STATE.get(locked.current_state, locked.current_state) if moved else None
            outcome = idem.Outcome(body={"applied": applied, "reason": reason, "transitioned_to": transitioned_to})
            if moved and locked.current_state == STATE_SCORING:
                outcome.after_commit.append(lambda: enqueue_midterm_scoring(attempt_id=attempt.pk, request=request))
            return outcome

        try:
            outcome = idem.run(attempt=attempt, endpoint=idem.ENDPOINT_SUBMIT, key=key, compute=compute)
        except (TransitionConflict, TransitionNotAllowed):
            raise _conflict(attempt.pk)

        fresh = fresh_midterm(attempt.pk)
        next_module, media_rows = None, []
        if fresh.current_state == STATE_MODULE_2_ACTIVE and _order_of(fresh, body.module_id) == 1:
            # Module 2 of a midterm never ships early: it arrives with the module-1 submit,
            # on the first answer and on every replay of it.
            next_module, keys, _ = _module_content(fresh, 2, {})
            media_rows = signed_media(keys, ttl_seconds=midterm_media_ttl(), request=request)
        return ok(
            {
                "applied": bool(outcome.body.get("applied")),
                "reason": outcome.body.get("reason"),
                "transitioned_to": outcome.body.get("transitioned_to"),
                "attempt": midterm_lite(fresh),
                "next_module": next_module,
                "media": media_rows,
                "result": {"poll_after_ms": POLL_AFTER_MS} if fresh.current_state in FINISHED else None,
            }
        )


# ── offscreen ────────────────────────────────────────────────────────────────────────────
class MidtermOffscreenView(MidtermView):
    """The student left the exam window. The server decides what it costs: strikes 1 and 2
    get ``grace_seconds`` to come back; the third ends the sitting here. Counted once per
    idempotency key, so a retried report never spends two of three chances."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        require_lockdown(request, attempt)
        key = require_idempotency_key(request)
        data = request.data if isinstance(request.data, dict) else {}
        away_ms = data.get("away_ms")
        logger.info(
            "desktop_v1_offscreen attempt_id=%s event_id=%s away_ms=%s",
            attempt.pk, str(data.get("event_id") or "")[:64],
            away_ms if isinstance(away_ms, int) and not isinstance(away_ms, bool) else None,
        )

        if attempt.current_state not in RUNNING:
            # Nothing to police once the paper is in: a late event from a closing window is a
            # harmless no-op that reports the tally, and is not stored.
            return ok(
                {
                    "violations": int(attempt.offscreen_violations or 0),
                    "limit": OFFSCREEN_VIOLATION_LIMIT,
                    "grace_seconds": 0,
                    "terminated": bool(attempt.terminated_reason),
                    "attempt": midterm_lite(fresh_midterm(attempt.pk)),
                }
            )

        def compute(locked):
            terminated = False
            count = int(locked.offscreen_violations or 0)
            if locked.current_state in RUNNING:
                count += 1
                MidtermAttempt.objects.filter(pk=locked.pk).update(offscreen_violations=count)
                locked.offscreen_violations = count
                if count >= OFFSCREEN_VIOLATION_LIMIT:
                    # The third strike ends the WHOLE sitting, from either module.
                    locked.submit_final()
                    MidtermAttempt.objects.filter(pk=locked.pk).update(
                        terminated_reason=MidtermAttempt.TERMINATION_OFFSCREEN
                    )
                    terminated = True
            outcome = idem.Outcome(body={"violations": count, "terminated": terminated})
            if terminated:
                outcome.after_commit.append(lambda: enqueue_midterm_scoring(attempt_id=attempt.pk, request=request))
            return outcome

        try:
            outcome = idem.run(attempt=attempt, endpoint=idem.ENDPOINT_OFFSCREEN, key=key, compute=compute)
        except (TransitionConflict, TransitionNotAllowed):
            raise _conflict(attempt.pk)
        terminated = bool(outcome.body.get("terminated"))
        return ok(
            {
                "violations": int(outcome.body.get("violations") or 0),
                "limit": OFFSCREEN_VIOLATION_LIMIT,
                "grace_seconds": 0 if terminated else OFFSCREEN_GRACE_SECONDS,
                "terminated": terminated,
                "attempt": midterm_lite(fresh_midterm(attempt.pk)),
            }
        )


# ── result ───────────────────────────────────────────────────────────────────────────────
class MidtermResultView(MidtermView):
    """The website's ``review`` shape (score only, release-gated) plus ``state``, and
    ``poll_after_ms`` while scoring. The release gate is ``midterm_results_state``, unchanged."""

    def get(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        if attempt.current_state == STATE_SCORING:
            return ok({"attempt_id": attempt.id, "state": STATE_SCORING, "poll_after_ms": POLL_AFTER_MS})
        if not (attempt.is_completed and attempt.current_state == STATE_COMPLETED):
            raise _conflict(attempt.pk, "This midterm has not been handed in yet.")
        state = midterm_results_state(attempt)
        released = bool(state["results_visible"])
        midterm = attempt.midterm
        return ok(
            {
                "attempt_id": attempt.id,
                "state": STATE_COMPLETED,
                "poll_after_ms": None,
                "score_only": True,
                "released": released,
                "mock_kind": "MIDTERM",
                "subject": midterm.subject,
                # The scale THIS sitting was scored on — the midterm's may have changed since.
                "scoring_scale": attempt.scoring_scale,
                "total_score": attempt.score if released else None,
                "score_ceiling": attempt.score_ceiling if released else None,
                "certificate": state.get("certificate") or None,
            }
        )
