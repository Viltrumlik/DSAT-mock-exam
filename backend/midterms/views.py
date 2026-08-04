"""Student-facing midterm attempt runner endpoints.

Mirrors the shape of ``exams.TestAttemptViewSet`` (status/start/submit_module/save_attempt)
so the frontend exam-runner is reused by pointing its API client at this base path. There is
NO pause endpoint (midterms are strictly timed), NO retake (enforced at create), and the
answer key / unreleased score is never exposed (see MidtermAttemptSerializer + review()).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.reliability import idempotency_key_from_request

from .access import (
    can_start_midterm,
    consume_resit,
    midterm_results_state,
    resolve_midterm_schedule,
    resolve_version_for_student,
)
from .idempotency import consume_idempotency_key
from .models import MODULE_BREAK_GRACE_SECONDS, Midterm, MidtermAttempt
from .proctoring import GRACE_SECONDS as OFFSCREEN_GRACE_SECONDS
from .proctoring import VIOLATION_LIMIT as OFFSCREEN_VIOLATION_LIMIT
from .serializers import MidtermAttemptSerializer
from .state_machine import (
    STATE_ABANDONED,
    STATE_ACTIVE,
    STATE_COMPLETED,
    STATE_MODULE_2_ACTIVE,
    STATE_SCORING,
)

from .tasks import enqueue_midterm_scoring

logger = logging.getLogger(__name__)

# The two "a module is running" states — the strict timer, off-screen policing and autosave
# all apply on either module of a two-module midterm.
_ACTIVE_STATES = (STATE_ACTIVE, STATE_MODULE_2_ACTIVE)

# How long past a module's deadline a request may still introduce answers the server has
# never seen. Deliberately the SAME value the engine already treats as a legitimately late
# module boundary — a smaller number would have the engine accept the arrival as on-time
# while throwing that same request's answers away.
LATE_ANSWER_GRACE_SECONDS = MODULE_BREAK_GRACE_SECONDS

_REASON_DETAIL = {
    "midterm_unpublished": "This midterm is not available yet.",
    "midterm_completed": "You have already completed this midterm.",
    "no_access": "You do not have access to this midterm.",
    "midterm_not_open": "This midterm has not opened yet.",
    "midterm_closed": "This midterm's deadline has passed.",
    "midterm_no_code": "This midterm hasn't started yet. Wait for your teacher to start it and share the access code.",
    # NB: there is no "retake_no_result" refusal any more — missing the original sitting is a
    # reason to be OWED the retake, not to be refused it (midterms.access.retake_eligibility).
    "retake_not_in_cohort": "This retake belongs to a midterm you were not assigned.",
    "retake_already_passed": "You passed this midterm, so there is no retake to sit.",
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


def _target_module_id(request):
    """The exams.Module id this submit was PREPARED for, when the client names one.

    The runner always sends it (``examApiClient.submitModule``); a missing/garbled value
    just means "don't module-target", preserving the old behaviour for any other caller.
    """
    raw = request.data.get("module_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _module_deadline(attempt, order: int):
    """Wall-clock deadline of one module, derived ONLY from the attempt's own anchors.

    Never from anything the client said: an earlier attempt at this resolved the deadline
    from a client-supplied ``module_id``, so naming module 2 while still on module 1 read the
    NULL ``module_2_started_at``, produced "no deadline", and banked answers hours late — the
    very bypass it was written to close, now unbounded.
    """
    anchor = attempt.module_2_started_at if int(order) == 2 else attempt.started_at
    if not anchor:
        return None
    minutes = attempt.midterm.duration_for_order(order)
    if minutes <= 0:
        return None
    return anchor + timedelta(minutes=minutes)


def _late_answers_accepted(attempt, *, target_order=None, now=None) -> bool:
    """Whether answers the server has NEVER SEEN may still be banked by this request.

    A closing request legitimately carries the last answers a student gave — that is why the
    payload is accepted at all, and dropping it wholesale has already cost real students real
    marks here. But "the closing body is always trusted" is also the timer bypass: suppress
    autosave, keep answering for an hour, then post everything.

    So it is bounded rather than refused: answers are banked while the module runs and for
    ``LATE_ANSWER_GRACE_SECONDS`` past its deadline — the same tolerance the engine already
    declares for a legitimately late module boundary (``MODULE_BREAK_GRACE_SECONDS``) — and
    declined after that. Declining NEVER erases anything: ``_merge_answers(None)`` returns the
    saved map untouched, so everything autosaved on time is still scored exactly as it was.
    """
    order = int(target_order) if target_order else attempt.current_module_order
    deadline = _module_deadline(attempt, order)
    if deadline is None:
        # That module has no anchor (e.g. a payload aimed at a module 2 that never started).
        # Fall back to the module actually running, so an unanchored target cannot mean
        # "unbounded"; if nothing is anchored either, the attempt hasn't started — accept.
        deadline = _module_deadline(attempt, attempt.current_module_order)
        if deadline is None:
            return True
    return (now or timezone.now()) <= deadline + timedelta(seconds=LATE_ANSWER_GRACE_SECONDS)


def _target_order_for(attempt, module_id) -> int:
    """Which of THIS attempt's modules a module id refers to; the live one when unknown."""
    if module_id is not None:
        for order in (1, 2):
            if getattr(attempt.effective_module_for_order(order), "id", None) == module_id:
                return order
    return attempt.current_module_order


def _drop_late_payload(attempt, *, endpoint: str, order: int, answers) -> None:
    """Forensics for a declined payload — counts only, never the answers themselves.

    Worth alerting on: a burst means either a cheat or, more importantly, that honest
    students are losing work somewhere upstream of the deadline.
    """
    deadline = _module_deadline(attempt, order)
    overdue = int((timezone.now() - deadline).total_seconds()) if deadline else None
    unseen = [k for k in (answers or {}) if str(k) not in (attempt.answers or {})]
    logger.warning(
        "[FORENSIC] midterm_late_answers_declined endpoint=%s attempt_id=%s module_order=%s "
        "overdue_seconds=%s grace=%s payload_keys=%s unseen_keys=%s",
        endpoint, attempt.pk, order, overdue, LATE_ANSWER_GRACE_SECONDS,
        len(answers or {}), len(unseen),
    )


def _is_background_save(request) -> bool:
    """Whether this save is a fire-and-forget flush from a leaving/hidden tab.

    Such a request proves the student is NOT looking at the exam, so it may persist answers
    but must never advance module 1 -> module 2: doing so starts module 2's clock on a
    closed tab and burns it before the student ever sees a question.
    """
    return bool(request.data.get("background"))


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
        # Pin the student's assigned version (random-assigned if the midterm has versions
        # and none was set yet). None → single-set midterm (uses the midterm's own module).
        version = resolve_version_for_student(request.user, midterm)
        try:
            attempt = MidtermAttempt.objects.create(midterm=midterm, student=request.user, version=version)
        except IntegrityError:
            attempt = self._active_attempt(midterm)
            if attempt is None:
                raise
            return Response(MidtermAttemptSerializer(attempt).data, status=status.HTTP_200_OK)
        # A re-sit grant is SPENT here, not when it was issued: the student has now actually
        # opened the paper. Marking it at grant time would burn it on a student who never
        # turned up, and leaving it open would let them sit the same midterm forever.
        consume_resit(request.user, midterm, attempt)
        return Response(MidtermAttemptSerializer(attempt).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        return self._snapshot(attempt)

    @action(detail=True, methods=["get"])
    def status(self, request, pk=None):
        # Read-only snapshot for timer resume / polling. Never mutates.
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        return self._snapshot(attempt)

    @action(detail=True, methods=["post"], url_path="verify_code")
    def verify_code(self, request, pk=None):
        """Check the classroom access code before a midterm may start.

        Returns ``{ok, requires_code}``. When the schedule has no code (or none is
        scheduled — standalone), this is a no-op success. On a correct code the
        attempt is flagged verified so ``start`` will proceed; a wrong code is 403.
        """
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        sched = resolve_midterm_schedule(request.user, attempt.midterm)
        if sched is None or not sched.requires_code():
            return Response({"ok": True, "requires_code": False})
        code = request.data.get("code")
        if not sched.code_matches(code):
            return Response(
                {"ok": False, "requires_code": True, "detail": "Incorrect access code."},
                status=status.HTTP_403_FORBIDDEN,
            )
        from django.utils import timezone

        MidtermAttempt.objects.filter(pk=attempt.pk).update(code_verified_at=timezone.now())
        return Response({"ok": True, "requires_code": True})

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        # Access-code gate: if the classroom requires a code, it must have been
        # verified first (see verify_code). Resuming an already-started attempt is
        # unaffected (only NOT_STARTED transitions actually begin the timer).
        if attempt.current_state == MidtermAttempt.STATE_NOT_STARTED:
            sched = resolve_midterm_schedule(request.user, attempt.midterm)
            if sched is not None and sched.requires_code() and attempt.code_verified_at is None:
                return Response(
                    {"detail": "Enter the access code from your teacher to begin.", "reason": "code_required"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        def compute():
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                locked.start_attempt()
            return self._snapshot(self.get_queryset().get(pk=pk))

        return consume_idempotency_key(
            attempt=attempt, endpoint="start", key=idempotency_key_from_request(request), compute=compute
        )

    @action(detail=True, methods=["post"], url_path="offscreen")
    def offscreen(self, request, pk=None):
        """Report that the student left the exam window; return what it cost them.

        The offence count lives HERE, not in the browser, because a client-side tally is
        cleared by a refresh or a new tab — precisely what a student gaming the rule would
        do. The browser reports the event; the server decides the consequence:

            offence 1 and 2  -> ``grace_seconds`` to return, else the client submits
            offence 3        -> no grace; the attempt is terminated immediately here

        Idempotent per browser event via the standard idempotency key, so a retried
        report cannot burn two of the student's three chances.
        """
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        if attempt.current_state not in _ACTIVE_STATES:
            # Nothing to police once the paper is in. Report the current tally so a late
            # event from a closing tab is a harmless no-op rather than an error.
            return Response(
                {
                    "violations": int(attempt.offscreen_violations or 0),
                    "grace_seconds": 0,
                    "terminated": bool(attempt.terminated_reason),
                    "limit": OFFSCREEN_VIOLATION_LIMIT,
                }
            )

        def compute():
            terminated = False
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                if locked.current_state not in _ACTIVE_STATES:
                    count = int(locked.offscreen_violations or 0)
                else:
                    count = int(locked.offscreen_violations or 0) + 1
                    MidtermAttempt.objects.filter(pk=locked.pk).update(offscreen_violations=count)
                    locked.offscreen_violations = count
                    if count >= OFFSCREEN_VIOLATION_LIMIT:
                        # Third strike ends the WHOLE sitting immediately, from either module
                        # — never an advance to module 2. submit_final goes straight to SCORING.
                        locked.submit_final()
                        MidtermAttempt.objects.filter(pk=locked.pk).update(
                            terminated_reason=MidtermAttempt.TERMINATION_OFFSCREEN
                        )
                        terminated = True
            refreshed = self.get_queryset().get(pk=pk)
            if terminated and refreshed.current_state == STATE_SCORING:
                enqueue_midterm_scoring(attempt_id=refreshed.id, request=request)
                refreshed.refresh_from_db()
            return Response(
                {
                    "violations": int(refreshed.offscreen_violations or 0),
                    # 0 once the allowance is spent — the client stops offering a countdown.
                    "grace_seconds": 0 if terminated else OFFSCREEN_GRACE_SECONDS,
                    "terminated": terminated,
                    "limit": OFFSCREEN_VIOLATION_LIMIT,
                    "attempt": MidtermAttemptSerializer(refreshed).data,
                }
            )

        return consume_idempotency_key(
            attempt=attempt, endpoint="offscreen", key=idempotency_key_from_request(request), compute=compute
        )

    @action(detail=True, methods=["post"], url_path="submit_module")
    def submit_module(self, request, pk=None):
        attempt = get_object_or_404(self.get_queryset(), pk=pk)
        # A midterm can't be submitted early — it may only end when its timer runs
        # out (the deadline is authoritative, enforced here regardless of client).
        # Checked before the idempotency wrapper so the 403 is never cached and a
        # legitimate post-deadline submit with the same key still succeeds.
        #
        # The ONE exception is a proctoring termination: a student who has spent their
        # off-screen allowance has forfeited the rest of the sitting, so their paper is
        # taken in early BY the rule. The bypass is not client-assertable — it requires
        # the server-side violation count to already be at the limit, so a crafted request
        # cannot use it to submit early.
        # The strict early-submit lock applies to the CURRENT module: get_timing() returns
        # the live module's timing, so module 1 and module 2 are each locked until their own
        # timer expires. On expiry, submit() advances M1->M2 or finalizes on M2.
        if attempt.current_state in _ACTIVE_STATES:
            timing = attempt.get_timing()
            forfeited = int(attempt.offscreen_violations or 0) >= OFFSCREEN_VIOLATION_LIMIT
            if timing is not None and not timing.is_expired and not forfeited:
                return Response(
                    {"detail": "This midterm can only be submitted when its time runs out."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        answers = request.data.get("answers") or {}
        flagged = request.data.get("flagged")

        target_module_id = _target_module_id(request)

        def compute():
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                if locked.current_state in _ACTIVE_STATES:
                    # Module-targeted submit (idempotency BY MODULE). A retried or racing
                    # submit prepared for module 1 must NEVER finalize module 2 with module
                    # 1's answers: the front-door timer check above ran before this lock, so
                    # an autosave can advance M1->M2 in between and this request would then
                    # end module 2 the instant it began — the pastpaper "Module 2 skip"
                    # incident, exactly. If the module this payload was built for is no
                    # longer live, the intended submit already landed: no-op successfully.
                    live_module = locked.effective_module_for_order(locked.current_module_order)
                    live_id = getattr(live_module, "id", None)
                    if target_module_id is not None and live_id != target_module_id:
                        logger.info(
                            "[FORENSIC] midterm_submit_module_stale_target_noop attempt_id=%s "
                            "target=%s current_state=%s live_module=%s",
                            locked.pk, target_module_id, locked.current_state, live_id,
                        )
                        # Don't finalize — but don't throw the payload away either. This may
                        # be the only copy of an answer the student gave to the module that
                        # just closed (the racing autosave can lose that race). `autosave`
                        # merges and never blanks, so banking it is safe and keeps the
                        # no-op from costing marks — bounded by the same late-answer grace,
                        # judged against the deadline of the module this payload was FOR
                        # (the live module's fresh timer would wave everything through).
                        stale_order = _target_order_for(locked, target_module_id)
                        if _late_answers_accepted(locked, target_order=stale_order):
                            locked.autosave(answers=answers, flagged=flagged)
                        else:
                            _drop_late_payload(
                                locked, endpoint="submit_module_stale", order=stale_order, answers=answers
                            )
                    else:
                        # The submitted payload is accepted — it is often the only carrier
                        # of the last answer a student gave — but only within the late-answer
                        # grace. Past that the attempt STILL advances/finalizes; it just does
                        # so without answers the server never saw. Nothing already saved is
                        # touched, so an honest paper scores exactly as it did.
                        if _late_answers_accepted(locked):
                            locked.submit(answers=answers, flagged=flagged)
                        else:
                            _drop_late_payload(
                                locked, endpoint="submit_module",
                                order=locked.current_module_order, answers=answers,
                            )
                            locked.submit(answers=None, flagged=None)
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
        background = _is_background_save(request)

        def compute():
            auto_submitted = False
            with transaction.atomic():
                locked = self._lock_queryset().select_for_update().get(pk=pk)
                if locked.current_state in _ACTIVE_STATES:
                    # Autosave is a HARD conflict on version drift (stale tab) — mirror exams.
                    if expected is not None and int(locked.version_number or 0) != expected:
                        return self._conflict(locked)
                    timing = locked.get_timing()
                    expired = bool(timing and timing.is_expired)
                    if expired and background:
                        # A background flush (pagehide / tab close) arriving AFTER the
                        # deadline writes NOTHING. It must not advance — the student isn't
                        # there to sit module 2, and starting it now would run its clock on a
                        # closed tab. It must not autosave either: `autosave` has no expiry
                        # check of its own, so banking a post-deadline payload here would let
                        # any crafted client hold a module open forever simply by setting
                        # `background` — an unlimited-time cheat, far worse than the tab-close
                        # problem this flag exists to solve. Whatever was saved before the
                        # deadline stands, and the attempt is closed by the student's next
                        # real interaction or by `sweep_midterm_attempts`.
                        pass
                    elif expired:
                        # Current module's timer ran out: submit() advances M1->M2 (new timer)
                        # or finalizes on module 2. This is the server-driven auto-advance.
                        # The same grace applies here, or the bypass simply moves endpoints:
                        # save_attempt's expired branch banks its payload too.
                        if _late_answers_accepted(locked):
                            locked.submit(answers=answers, flagged=flagged)
                        else:
                            _drop_late_payload(
                                locked, endpoint="save_attempt",
                                order=locked.current_module_order, answers=answers,
                            )
                            locked.submit(answers=None, flagged=None)
                        auto_submitted = True
                    else:
                        locked.autosave(answers=answers, flagged=flagged)
            refreshed = self.get_queryset().get(pk=pk)
            # Only the FINAL module reaching SCORING enqueues scoring. An M1->M2 advance is an
            # auto-submit that does NOT finish the paper.
            reached_scoring = auto_submitted and refreshed.current_state == STATE_SCORING
            if reached_scoring:
                enqueue_midterm_scoring(attempt_id=refreshed.id, request=request)
                refreshed.refresh_from_db()
            resp = self._snapshot(refreshed)
            if reached_scoring:
                # Tell the client the PAPER is over. On an M1->M2 advance the snapshot's own
                # is_expired is computed against the fresh module-2 timer (False), which is
                # correct — the runner then renders module 2 rather than the results screen.
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
