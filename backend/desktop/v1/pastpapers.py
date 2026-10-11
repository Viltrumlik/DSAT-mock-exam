"""Past papers on ``/api/desktop/v1/``: the whole test in one response, then small writes.

    POST pastpapers/{practice_test_id}/open      {start, have}   → ExamBundle
    POST pastpapers/attempts/{id}/start          Idempotency-Key start.{id}
    POST pastpapers/attempts/{id}/sync           Idempotency-Key sync.{id}.{module}.{seq}
    POST pastpapers/attempts/{id}/submit         Idempotency-Key submit.{id}.{module}
    POST pastpapers/attempts/{id}/pause | resume
    GET  pastpapers/attempts/{id}/result?have=…

Every state change is the ``TestAttempt`` state machine's own (``start_attempt``,
``submit_module_1``, ``submit_module_2``) under the attempt's row lock, exactly as the
website's ``TestAttemptViewSet`` drives it. What differs is the shape and three rules the
app needs:

* ``open`` resumes, restores an ABANDONED sitting, or creates one — and never abandons. (The
  website's create abandons a MODULE_2_ACTIVE attempt it thinks is stale; for an app that
  reopens mid-module that restarted the test.)
* ``sync`` is a background safety copy: it merges answers into the live module and never
  changes state, even on an expired module (past papers accept late answers anyway).
* responses carry ``AttemptLite``, never the full snapshot; module 2 ships up front unless
  ``DESKTOP_V1_SHIP_MODULE_2`` is off.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from access.permissions import RequiresSubmitTest
from exams.engine_db_guard import TransitionConflict
from exams.engine_integrity import autoheal_attempt_for_runtime
from exams.models import (
    AuditLog,
    Module,
    PracticeTest,
    Question,
    TestAttempt,
    ensure_full_mock_practice_test_modules,
)

from . import content, idem
from .conventions import (
    POLL_AFTER_MS,
    V1APIView,
    error,
    iso,
    iso_date,
    not_visible,
    ok,
    parse_have,
    parse_have_query,
    parse_sync_body,
    pastpaper_media_ttl,
    require_idempotency_key,
    ship_module_2,
    state_conflict,
)
from .media import signed_media
from .snapshots import fresh_pastpaper, modules_with_counts, pastpaper_lite, pastpaper_modules

logger = logging.getLogger(__name__)

ACTIVE = (TestAttempt.STATE_MODULE_1_ACTIVE, TestAttempt.STATE_MODULE_2_ACTIVE)
FINISHED = (TestAttempt.STATE_SCORING, TestAttempt.STATE_COMPLETED)

REASON_MODULE_NOT_ACTIVE = "module_not_active"
EMPTY_DETAIL = "This practice test has no questions yet."


# ── shared ───────────────────────────────────────────────────────────────────────────────
class PastpaperView(V1APIView):
    # The same gate as the website's TestAttemptViewSet.
    permission_classes = [IsAuthenticated, RequiresSubmitTest]


def enqueue_scoring(attempt_id: int, request=None) -> None:
    """The website's scoring enqueue (Celery when a broker exists, inline otherwise)."""
    from exams.views import _enqueue_scoring_when_in_scoring_state

    _enqueue_scoring_when_in_scoring_state(attempt_id=attempt_id, request=request)


def own_attempt(request, attempt_id: int) -> TestAttempt:
    """The caller's own past-paper attempt, or 404 — another student's attempt and a mock
    exam's section are both simply "not visible" here."""
    attempt = (
        TestAttempt.objects.filter(
            pk=attempt_id, student=request.user, practice_test__mock_exam__isnull=True
        )
        .select_related("practice_test")
        .first()
    )
    if attempt is None:
        raise not_visible()
    return attempt


def test_block(pt: PracticeTest) -> dict:
    """``test`` in the bundle. Tools follow the website runner: every Math past paper gets
    the full calculator and the reference sheet; Reading and Writing gets neither."""
    is_math = pt.subject == "MATH"
    return {
        "id": pt.id,
        "subject": pt.subject,
        "title": pt.title or "",
        "label": pt.label or "",
        "form_type": pt.form_type or "",
        "practice_date": iso_date(pt.practice_date),
        "collection_name": pt.collection_name or "",
        "tools": {"calculator": "graphing" if is_math else None, "reference_sheet": is_math},
    }


def is_deferred(attempt: TestAttempt, module: Module) -> bool:
    """Module 2 is held back only while the setting says so AND the attempt has not reached
    it. A resumed MODULE_2_ACTIVE attempt always gets its live module."""
    if ship_module_2() or int(module.module_order) != 2:
        return False
    return attempt.current_state not in (TestAttempt.STATE_MODULE_2_ACTIVE, *FINISHED)


def _block(module: Module, payload: list[dict], *, have: dict, deferred: bool = False) -> dict:
    return content.module_block(
        module_id=module.id,
        order=int(module.module_order),
        time_limit_minutes=int(module.time_limit_minutes or 0),
        questions=payload,
        have=have,
        deferred=deferred,
    )


def module_blocks(attempt: TestAttempt, modules: list[Module], have: dict) -> tuple[list[dict], list[str]]:
    """``modules[]`` and the image keys they reference (deferred modules contribute none)."""
    by_module = content.questions_by_module([m.id for m in modules])
    blocks: list[dict] = []
    keys: list[str] = []
    for module in modules:
        payload = content.questions_payload(by_module.get(module.id, []))
        deferred = is_deferred(attempt, module)
        blocks.append(_block(module, payload, have=have, deferred=deferred))
        if not deferred:
            keys.extend(content.image_keys(payload))
    return blocks, keys


def _clean_ids(raw) -> list[int]:
    out: list[int] = []
    for item in raw if isinstance(raw, list) else []:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value not in out:
            out.append(value)
    return out


def saved_answers(attempt: TestAttempt, modules: list[Module]) -> tuple[dict, dict]:
    """``answers`` / ``flagged`` keyed by module id. Cleared (``""``) answers are left out:
    on the wire an absent key and ``""`` both mean unanswered."""
    stored_answers = attempt.module_answers or {}
    stored_flags = attempt.flagged_questions or {}
    answers: dict[str, dict[str, str]] = {}
    flagged: dict[str, list[int]] = {}
    for module in modules:
        raw = stored_answers.get(str(module.id)) or {}
        answers[str(module.id)] = (
            {
                str(k): str(v)
                for k, v in raw.items()
                if v is not None and str(v).strip() != "" and str(k).isdigit()
            }
            if isinstance(raw, dict)
            else {}
        )
        flagged[str(module.id)] = _clean_ids(stored_flags.get(str(module.id)))
    return answers, flagged


def _module_question_ids(module_id: int) -> set[int]:
    return set(Question.objects.filter(module_id=module_id).values_list("id", flat=True))


def _normalize_locked(locked: TestAttempt) -> tuple[TestAttempt, bool]:
    """The website's runtime repairs, under the caller's lock: make sure both modules exist,
    auto-heal pointer drift. Returns the re-read attempt and whether the heal moved it into
    SCORING (which must enqueue scoring once the transaction commits)."""
    attempt = TestAttempt.objects.select_related("practice_test", "current_module").get(pk=locked.pk)
    ensure_full_mock_practice_test_modules(attempt.practice_test)
    before = attempt.current_state
    autoheal_attempt_for_runtime(attempt)
    attempt = TestAttempt.objects.select_related("practice_test", "current_module").get(pk=locked.pk)
    healed_to_scoring = before != TestAttempt.STATE_SCORING and attempt.current_state == TestAttempt.STATE_SCORING
    return attempt, healed_to_scoring


def _conflict(attempt_id: int, detail: str = "The attempt is no longer in that state.") -> Exception:
    return state_conflict(pastpaper_lite(fresh_pastpaper(attempt_id)), detail)


def _is_future_target(attempt: TestAttempt, module_id: int) -> bool:
    """Whether ``module_id`` is a module of this paper the attempt has not reached yet."""
    target = (
        Module.objects.filter(pk=module_id, practice_test_id=attempt.practice_test_id)
        .values_list("module_order", flat=True)
        .first()
    )
    if target is None:
        return False
    state = attempt.current_state
    if state in (TestAttempt.STATE_NOT_STARTED, TestAttempt.STATE_ABANDONED):
        return True
    if state in ACTIVE:
        live = Module.objects.filter(pk=attempt.current_module_id).values_list("module_order", flat=True).first()
        return live is not None and int(target) > int(live)
    return False


# ── open ─────────────────────────────────────────────────────────────────────────────────
def _resumable(user, practice_test_id: int) -> TestAttempt | None:
    """The sitting ``open`` continues: the active one, else the newest ABANDONED one newer
    than the last finished sitting (restored from its checkpoint by ``start_attempt``)."""
    base = TestAttempt.objects.filter(student=user, practice_test_id=practice_test_id)
    active = (
        base.filter(is_completed=False)
        .exclude(current_state=TestAttempt.STATE_ABANDONED)
        .order_by("-id")
        .first()
    )
    if active is not None:
        return active
    last_finished_id = base.filter(is_completed=True).order_by("-id").values_list("id", flat=True).first()
    abandoned = base.filter(is_completed=False, current_state=TestAttempt.STATE_ABANDONED)
    if last_finished_id is not None:
        abandoned = abandoned.filter(id__gt=last_finished_id)
    return abandoned.order_by("-id").first()


def _create(user, pt: PracticeTest) -> tuple[TestAttempt, bool]:
    """Create the sitting; a racing duplicate (double-click, two windows) lands on the one
    the unique constraint kept."""
    try:
        with transaction.atomic():
            return TestAttempt.objects.create(student=user, practice_test=pt, mock_exam=None), True
    except IntegrityError:
        existing = _resumable(user, pt.pk)
        if existing is None:
            raise
        return existing, False


class PastpaperOpenView(PastpaperView):
    def post(self, request, practice_test_id: int):
        data = request.data if isinstance(request.data, dict) else {}
        start = data.get("start") is True
        have = parse_have(data.get("have"))
        user = request.user

        pt = PracticeTest.objects.filter(pk=practice_test_id, mock_exam__isnull=True).first()
        if pt is None:
            raise not_visible()
        attempt = _resumable(user, pt.pk)
        if attempt is None and not PracticeTest.objects.filter(pk=pt.pk, assigned_users=user).exists():
            # Creating needs the library's gate (assigned to this student). A sitting that
            # already exists is resumed even if the paper has since been unassigned.
            raise not_visible()
        if not pt.has_questions_for_attempts():
            raise error(status.HTTP_400_BAD_REQUEST, "practice_test_empty", EMPTY_DETAIL)

        created = False
        if attempt is None:
            attempt, created = _create(user, pt)

        healed_to_scoring = False
        try:
            with transaction.atomic():
                locked = TestAttempt.objects.select_for_update(of=("self",)).get(pk=attempt.pk)
                current, healed_to_scoring = _normalize_locked(locked)
                state = current.current_state
                # ABANDONED: restore from the checkpoint. Active: start_attempt only heals the
                # module pointer. NOT_STARTED: the clock starts only when the app says so
                # (`start: false` is the welcome screen; `start` comes later).
                if state == TestAttempt.STATE_ABANDONED or state in ACTIVE or (
                    state == TestAttempt.STATE_NOT_STARTED and start
                ):
                    current.start_attempt()
        except TransitionConflict:
            raise _conflict(attempt.pk, "The test changed while it was opening. Open it again.")
        except DjangoValidationError:
            raise error(status.HTTP_400_BAD_REQUEST, "practice_test_empty", EMPTY_DETAIL)
        if healed_to_scoring:
            enqueue_scoring(attempt.pk, request)
        if created:
            AuditLog.objects.create(user=user, action="START_TEST", details=f"Started practice test: {pt}")

        fresh = fresh_pastpaper(attempt.pk)
        modules = pastpaper_modules(fresh)
        blocks, keys = module_blocks(fresh, modules, have)
        answers, flagged = saved_answers(fresh, modules)
        return ok(
            {
                "attempt": pastpaper_lite(fresh),
                "test": test_block(fresh.practice_test),
                "modules": blocks,
                "answers": answers,
                "flagged": flagged,
                "media": signed_media(keys, ttl_seconds=pastpaper_media_ttl(), request=request),
                "annotations": content.annotations_for(student=user, ref=str(fresh.id)),
            }
        )


# ── start ────────────────────────────────────────────────────────────────────────────────
class PastpaperStartView(PastpaperView):
    """Only after a welcome screen (``open`` with ``start: false``). The app starts its own
    clock on the click and sends this in the background."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        key = require_idempotency_key(request)

        def compute(locked):
            current, healed_to_scoring = _normalize_locked(locked)
            current.start_attempt()
            outcome = idem.Outcome(body={})
            if healed_to_scoring:
                outcome.after_commit.append(lambda: enqueue_scoring(attempt.pk, request))
            return outcome

        try:
            idem.run(attempt=attempt, endpoint=idem.ENDPOINT_START, key=key, compute=compute)
        except TransitionConflict:
            raise _conflict(attempt.pk)
        except DjangoValidationError:
            raise error(status.HTTP_400_BAD_REQUEST, "practice_test_empty", EMPTY_DETAIL)
        return ok({"attempt": pastpaper_lite(fresh_pastpaper(attempt.pk))})


# ── sync ─────────────────────────────────────────────────────────────────────────────────
class PastpaperSyncView(PastpaperView):
    """The quiet background copy. Merges into the live module; never moves the attempt."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        key = require_idempotency_key(request)
        body = parse_sync_body(request.data)

        def compute(locked):
            current = TestAttempt.objects.get(pk=locked.pk)
            if current.current_state not in ACTIVE or current.current_module_id != body.module_id:
                # Not remembered: nothing was written, so a retry under this key may be applied
                # once the module it names is live (an outbox that sent it out of order).
                return idem.Outcome(body={"applied": False, "reason": REASON_MODULE_NOT_ACTIVE}, store=False)
            question_ids = _module_question_ids(body.module_id)
            mid = str(body.module_id)
            merged = dict((current.module_answers or {}).get(mid) or {})
            for qid, value in body.answers_for(question_ids).items():
                if value == "":
                    merged.pop(qid, None)
                else:
                    merged[qid] = value
            module_answers = dict(current.module_answers or {})
            module_answers[mid] = merged
            flagged = dict(current.flagged_questions or {})
            flagged[mid] = body.flagged_for(question_ids)
            # No version check: one writer per device. A plain UPDATE, not save(): nothing
            # here completes the attempt, so there is no signal worth firing per heartbeat.
            TestAttempt.objects.filter(pk=current.pk).update(
                module_answers=module_answers,
                flagged_questions=flagged,
                version_number=int(current.version_number or 0) + 1,
                updated_at=timezone.now(),
            )
            return idem.Outcome(body={"applied": True, "reason": None})

        outcome = idem.run(attempt=attempt, endpoint=idem.ENDPOINT_SYNC, key=key, compute=compute)
        return ok(
            {
                "applied": bool(outcome.body.get("applied")),
                "reason": outcome.body.get("reason"),
                "attempt": pastpaper_lite(fresh_pastpaper(attempt.pk)),
            }
        )


# ── submit ───────────────────────────────────────────────────────────────────────────────
class PastpaperSubmitView(PastpaperView):
    """The module's end, with every answer. Module-targeted: a submit prepared for a module
    that is no longer live is a successful no-op, never applied to the next module (the
    "Module 2 skip" incident)."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        key = require_idempotency_key(request)
        body = parse_sync_body(request.data)

        def compute(locked):
            current, healed_to_scoring = _normalize_locked(locked)
            if current.current_state == TestAttempt.STATE_NOT_STARTED:
                # The app sat module 1 offline after a welcome screen whose background
                # `start` never landed. The submit is the proof the student sat it: start,
                # then hand it in, rather than throw module 1 away.
                first = next((m for m in pastpaper_modules(fresh_pastpaper(current.pk)) if m.module_order == 1), None)
                if first is not None and first.id == body.module_id:
                    current.start_attempt()
                    current = TestAttempt.objects.select_related("practice_test", "current_module").get(pk=current.pk)
            if current.current_state not in ACTIVE or current.current_module_id != body.module_id:
                logger.info(
                    "[FORENSIC] desktop_v1_submit_stale_target_noop attempt_id=%s target=%s current=%s state=%s",
                    current.pk, body.module_id, current.current_module_id, current.current_state,
                )
                outcome = idem.Outcome(
                    body={"applied": False, "reason": REASON_MODULE_NOT_ACTIVE, "transitioned_to": None},
                    # A module already handed in: remember the no-op, so a retry can never end the
                    # next module. A module NOT YET reached: forget it, so the same key goes
                    # through once the earlier module lands (outbox order, or a sitting the
                    # website abandoned that `open` will restore).
                    store=not _is_future_target(current, body.module_id),
                )
                if healed_to_scoring:
                    outcome.after_commit.append(lambda: enqueue_scoring(attempt.pk, request))
                return outcome

            question_ids = _module_question_ids(body.module_id)
            mid = str(body.module_id)
            # The website's merge: what is already saved, overwritten per question by the
            # body. A cleared answer is cleared.
            merged = dict((current.module_answers or {}).get(mid) or {})
            for qid, value in body.answers_for(question_ids).items():
                if value == "":
                    merged.pop(qid, None)
                else:
                    merged[qid] = value
            flagged = body.flagged_for(question_ids)
            order = int(current.current_module.module_order)
            if order == 1:
                moved = current.submit_module_1(merged, flagged)
                current.refresh_from_db()
            else:
                moved = current.submit_module_2(merged, flagged)
            transitioned_to = current.current_state if moved else None
            outcome = idem.Outcome(body={"applied": True, "reason": None, "transitioned_to": transitioned_to})
            if current.current_state == TestAttempt.STATE_SCORING and (moved or healed_to_scoring):
                outcome.after_commit.append(lambda: enqueue_scoring(attempt.pk, request))
            return outcome

        try:
            outcome = idem.run(attempt=attempt, endpoint=idem.ENDPOINT_SUBMIT, key=key, compute=compute)
        except TransitionConflict:
            raise _conflict(attempt.pk)
        except DjangoValidationError:
            raise _conflict(attempt.pk)

        fresh = fresh_pastpaper(attempt.pk)
        next_module, media_rows = None, []
        if fresh.current_state == TestAttempt.STATE_MODULE_2_ACTIVE and not ship_module_2():
            # Module 2 was held back at open: it arrives with the module-1 submit — on the
            # first answer and on every replay of it.
            modules = {m.module_order: m for m in pastpaper_modules(fresh)}
            first, second = modules.get(1), modules.get(2)
            if first is not None and second is not None and first.id == body.module_id:
                payload = content.questions_payload(content.questions_by_module([second.id]).get(second.id, []))
                next_module = _block(second, payload, have={})
                media_rows = signed_media(
                    content.image_keys(payload), ttl_seconds=pastpaper_media_ttl(), request=request
                )
        return ok(
            {
                "applied": bool(outcome.body.get("applied")),
                "reason": outcome.body.get("reason"),
                "transitioned_to": outcome.body.get("transitioned_to"),
                "attempt": pastpaper_lite(fresh),
                "next_module": next_module,
                "media": media_rows,
                "result": {"poll_after_ms": POLL_AFTER_MS} if fresh.current_state in FINISHED else None,
            }
        )


# ── pause / resume ───────────────────────────────────────────────────────────────────────
class PastpaperPauseView(PastpaperView):
    """Stop the clock (the website's ``pause``). Needs a connection; idempotent."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        with transaction.atomic():
            locked = TestAttempt.objects.select_for_update(of=("self",)).get(pk=attempt.pk)
            if locked.current_state not in ACTIVE:
                raise _conflict(attempt.pk, "Only a running module can be paused.")
            if locked.pause_started_at is None:
                locked.pause_started_at = timezone.now()
                locked.save(update_fields=["pause_started_at", "updated_at"])
        return ok({"attempt": pastpaper_lite(fresh_pastpaper(attempt.pk))})


class PastpaperResumeView(PastpaperView):
    """Restart the clock, banking the paused window into the live module (the website's
    ``resume_pause``). Idempotent."""

    def post(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        with transaction.atomic():
            locked = TestAttempt.objects.select_for_update(of=("self",)).get(pk=attempt.pk)
            if locked.pause_started_at is not None:
                now = timezone.now()
                elapsed = max(0, int((now - locked.pause_started_at).total_seconds()))
                order = (
                    Module.objects.filter(pk=locked.current_module_id).values_list("module_order", flat=True).first()
                    if locked.current_module_id
                    else None
                )
                fields = ["pause_started_at", "updated_at"]
                if order == 1:
                    locked.module_1_paused_seconds = int(locked.module_1_paused_seconds or 0) + elapsed
                    fields.append("module_1_paused_seconds")
                elif order == 2:
                    locked.module_2_paused_seconds = int(locked.module_2_paused_seconds or 0) + elapsed
                    fields.append("module_2_paused_seconds")
                locked.pause_started_at = None
                locked.save(update_fields=fields)
        return ok({"attempt": pastpaper_lite(fresh_pastpaper(attempt.pk))})


# ── result ───────────────────────────────────────────────────────────────────────────────
def _previous_score(attempt: TestAttempt) -> int | None:
    """The website review's rule: the student's previous completed sitting of this paper."""
    previous = TestAttempt.objects.filter(
        student_id=attempt.student_id,
        practice_test_id=attempt.practice_test_id,
        current_state=TestAttempt.STATE_COMPLETED,
        is_completed=True,
        score__isnull=False,
    ).exclude(pk=attempt.pk)
    if attempt.completed_at:
        row = previous.filter(completed_at__lt=attempt.completed_at).order_by("-completed_at", "-pk").first()
    else:
        row = previous.filter(pk__lt=attempt.pk).order_by("-pk").first()
    return row.score if row is not None else None


class PastpaperResultView(PastpaperView):
    """While scoring: 200 ``{attempt_id, state: SCORING, poll_after_ms}``. Completed: the score,
    per-question correctness, and each module's content unless ``have`` says the app holds it.
    Built from the website's ``review`` logic. Like the website it carries no explanations."""

    def get(self, request, attempt_id: int):
        attempt = own_attempt(request, attempt_id)
        state = attempt.current_state
        if state == TestAttempt.STATE_SCORING:
            return ok({"attempt_id": attempt.id, "state": state, "poll_after_ms": POLL_AFTER_MS})
        if state != TestAttempt.STATE_COMPLETED or not attempt.is_completed:
            raise _conflict(attempt.pk, "This test has not been handed in yet.")

        have = parse_have_query(request.query_params.get("have"))
        modules = [
            m
            for m in modules_with_counts().filter(practice_test_id=attempt.practice_test_id).order_by("module_order", "id")
            if m.question_count
        ]
        by_module = content.questions_by_module([m.id for m in modules])
        stored_answers = attempt.module_answers or {}
        stored_flags = attempt.flagged_questions or {}

        totals = {"questions": 0, "answered": 0, "correct": 0}
        module_rows, question_rows, content_map, keys = [], [], {}, []
        for module in modules:
            questions = by_module.get(module.id, [])
            answers = stored_answers.get(str(module.id)) or {}
            answers = answers if isinstance(answers, dict) else {}
            flagged = {str(f) for f in (stored_flags.get(str(module.id)) or [])}
            correct = 0
            for order, question in enumerate(questions, start=1):
                raw = answers.get(str(question.id))
                answered = raw is not None and str(raw).strip() != ""
                is_correct = bool(question.check_answer(raw)) if answered else False
                totals["questions"] += 1
                if answered:
                    totals["answered"] += 1
                    if is_correct:
                        totals["correct"] += 1
                        correct += 1
                question_rows.append(
                    {
                        "id": question.id,
                        "module_id": module.id,
                        "order": order,
                        "student_answer": str(raw) if answered else None,
                        "correct_answers": question.correct_answers or "",
                        "is_correct": is_correct,
                        "was_flagged": str(question.id) in flagged,
                    }
                )
            module_rows.append(
                {"order": int(module.module_order), "module_id": module.id, "correct": correct, "total": len(questions)}
            )
            payload = content.questions_payload(questions)
            digest = content.content_hash(payload)
            cached = have.get(str(module.id)) == digest
            content_map[str(module.id)] = {"content_hash": digest, "questions": None if cached else payload}
            if not cached:
                keys.extend(content.image_keys(payload))

        skipped = totals["questions"] - totals["answered"]
        previous = _previous_score(attempt)
        return ok(
            {
                "attempt_id": attempt.id,
                "practice_test_id": attempt.practice_test_id,
                "state": TestAttempt.STATE_COMPLETED,
                "poll_after_ms": None,
                "score": attempt.score,
                "previous_score": previous,
                "score_delta": (attempt.score - previous) if (previous is not None and attempt.score is not None) else None,
                "completed_at": iso(attempt.completed_at),
                "totals": {
                    "questions": totals["questions"],
                    "answered": totals["answered"],
                    "correct": totals["correct"],
                    "incorrect": totals["questions"] - totals["correct"] - skipped,
                    "skipped": skipped,
                },
                "modules": module_rows,
                "questions": question_rows,
                "content": content_map,
                "media": signed_media(keys, ttl_seconds=pastpaper_media_ttl(), request=request),
            }
        )
