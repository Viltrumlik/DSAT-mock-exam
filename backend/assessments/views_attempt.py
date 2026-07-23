from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from django.conf import settings as dj_settings
from users.permissions import IsAuthenticatedAndNotFrozen
from classes.models import ClassroomMembership
from .models import (
    AssessmentQuestion,
    HomeworkAssignment,
    AssessmentAttempt,
    AssessmentAnswer,
    AssessmentResult,
    AssessmentAttemptAuditEvent,
)
from .throttles import AssessmentAnswerPerAttemptThrottle
from .async_tasks import grade_attempt_task
from .grading_service import grade_attempt
from .serializers import (
    AssessmentSetRunnerSerializer,
    StartAttemptSerializer,
    SaveAnswerSerializer,
    SubmitAttemptSerializer,
    AttemptSerializer,
    ResultSerializer,
    AssessmentQuestionRunnerSerializer,
    ApiAssessmentDetailSerializer,
    SaveAnswerStaleWriteSerializer,
    SaveAnswerStoredSerializer,
    AttemptBundleResponseSerializer,
    SubmitAttemptQueuedResponseSerializer,
    SubmitAttemptCompleteResponseSerializer,
    SubmitAssessmentVersionConflictSerializer,
    SubmitAttemptBadRequestSerializer,
)
from .helpers import (
    _audit_attempt,
    _build_hw_meta,
)

logger = logging.getLogger(__name__)


def _frozen_question_ids(assessment_set_id: int) -> list[int]:
    """The ordered question ids to pin onto an attempt at start — the set's CURRENT
    live active order.

    Content is delivered/graded/reviewed LIVE (like the pastpaper runner), so this
    pins only WHICH questions the attempt covers, from the live set at start. A NEW
    attempt (or retry) therefore always picks up the teacher's latest questions; a
    question ADDED after the student started is not in this frozen list, so it can't
    grow their in-progress attempt.
    """
    return list(
        AssessmentQuestion.objects.filter(assessment_set_id=assessment_set_id, is_active=True)
        .order_by("order", "id")
        .values_list("id", flat=True)
    )


class StartAttemptView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Start or resume attempt",
        request=StartAttemptSerializer,
        responses={
            200: AttemptSerializer,
            403: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    @transaction.atomic
    def post(self, request):
        ser = StartAttemptSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        homework_id = ser.validated_data.get("homework_id")
        assignment_id = ser.validated_data.get("assignment_id")

        base_qs = HomeworkAssignment.objects.select_related(
            "assignment", "classroom", "assessment_set"
        )
        if homework_id:
            hw = base_qs.filter(pk=int(homework_id)).first()
        else:
            # Back-compat: resolve by assignment. A bundle may hold several
            # assessments — then homework_id is required to disambiguate.
            hws = list(base_qs.filter(assignment_id=int(assignment_id)))
            if len(hws) > 1:
                return Response(
                    {"detail": "This homework has multiple assessments — pass homework_id."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            hw = hws[0] if hws else None
        if not hw:
            return Response({"detail": "Assessment homework not found."}, status=status.HTTP_404_NOT_FOUND)

        classroom = hw.classroom
        if not classroom.memberships.filter(user=request.user, role=ClassroomMembership.ROLE_STUDENT).exists():
            return Response({"detail": "Only students can start this assessment."}, status=status.HTTP_403_FORBIDDEN)

        # Optional: retry mode — student retries only a specific subset of
        # questions (e.g. the ones they got wrong in a previous attempt).
        # When provided, question_order is restricted to those IDs rather than
        # the full set.  This lets the frontend implement "retry incorrect only"
        # without adding a new attempt type.
        focus_ids_raw = ser.validated_data.get("focus_question_ids") or []
        focus_ids: set[int] = {int(x) for x in focus_ids_raw if isinstance(x, (int, str)) and str(x).isdigit()}

        # Reuse in-progress attempt if exists (and no focus filter requested —
        # focus mode always creates a fresh attempt).
        att = None
        if not focus_ids:
            att = (
                AssessmentAttempt.objects.select_for_update()
                .filter(homework=hw, student=request.user, status=AssessmentAttempt.STATUS_IN_PROGRESS)
                .order_by("-started_at", "-id")
                .first()
            )
        if not att:
            # Freeze WHICH questions this attempt covers, from the set's current live
            # active order. A NEW attempt (first take OR retry) therefore always picks
            # up the teacher's latest questions; an in-progress attempt is reused above
            # so content never shifts mid-attempt. question_order is the sole pin —
            # content itself is served/graded/reviewed live from AssessmentQuestion.
            qids = _frozen_question_ids(hw.assessment_set_id)

            # Apply focus filter: only include explicitly requested question IDs
            # (validated against the full set so students can't inject arbitrary IDs).
            if focus_ids:
                qids = [qid for qid in qids if qid in focus_ids]
                if not qids:
                    return Response(
                        {"detail": "None of the requested focus questions belong to this assignment."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            # Question order is the canonical builder order (order, id) — identical
            # for every student on this assignment. Do NOT shuffle: order must be
            # deterministic and the same for everyone (mirrors the printed exam).
            att = AssessmentAttempt.objects.create(
                homework=hw,
                student=request.user,
                last_activity_at=timezone.now(),
                grading_status=AssessmentAttempt.GRADING_PENDING,
                question_order=qids,
            )
            _audit_attempt(
                att,
                actor=request.user,
                event_type=AssessmentAttemptAuditEvent.EVENT_STARTED,
                payload={
                    "question_count": len(qids),
                    "retry_mode": bool(focus_ids),
                },
            )
        else:
            update_fields: list[str] = []
            if not att.last_activity_at:
                att.last_activity_at = timezone.now()
                update_fields.append("last_activity_at")
            # Repair a legacy/edge attempt with an empty question_order. Without a
            # frozen list it runs on the fully-live path and its question count TRACKS
            # the mutable set (a teacher adding questions mid-attempt grew 27 → 29).
            # Freeze it now to the current live content so it is stable from here on.
            if not att.question_order:
                att.question_order = _frozen_question_ids(hw.assessment_set_id)
                update_fields.append("question_order")
            if update_fields:
                att.save(update_fields=update_fields)

        att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
        return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)


class AttemptBundleView(APIView):
    """
    Student-facing attempt bootstrap: return attempt + sanitized question list
    (no correct answers), in the canonical builder order — identical for every
    student on the assignment.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Attempt bundle (attempt + set + questions)",
        responses={
            200: AttemptBundleResponseSerializer,
            403: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    def get(self, request, attempt_id: int):
        att = AssessmentAttempt.objects.select_related(
            "homework__classroom", "homework__assessment_set"
        ).filter(pk=attempt_id, student=request.user).first()
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

        hw = att.homework
        if not hw.classroom.memberships.filter(user=request.user, role=ClassroomMembership.ROLE_STUDENT).exists():
            return Response({"detail": "Only students can view this attempt."}, status=status.HTTP_403_FORBIDDEN)

        aset = hw.assessment_set
        order_ids = [int(x) for x in (att.question_order or []) if isinstance(x, (int, str)) and str(x).isdigit()]

        # Deliver LIVE question content (no version snapshot) so a teacher's builder
        # edits show up immediately — like the pastpaper runner. The frozen
        # ``question_order`` pins only WHICH questions this attempt covers; their
        # prompt/choices/images are always read live. Runner-safe serializers omit
        # correct_answer/explanation so the worked solution never leaks mid-attempt.
        base_questions = list(
            AssessmentQuestion.objects.filter(assessment_set=aset, is_active=True).order_by("order", "id")
        )
        q_by_id = {q.id: q for q in base_questions}
        questions = [q_by_id[qid] for qid in order_ids if qid in q_by_id] if order_ids else base_questions

        att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
        return Response(
            {
                "attempt": AttemptSerializer(att).data,
                # Runner-safe serializers: neither set.questions nor the top-level
                # questions expose explanation/correct_answer during the attempt.
                "set": AssessmentSetRunnerSerializer(aset).data,
                "questions": AssessmentQuestionRunnerSerializer(questions, many=True).data,
                "assignment_id": hw.assignment_id,
                # Pedagogical context: classroom name, assignment title, due date.
                "meta": _build_hw_meta(hw),
            }
        )


class SaveAnswerView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen]
    throttle_classes = [AssessmentAnswerPerAttemptThrottle]

    @extend_schema(
        tags=["assessments"],
        summary="Save answer for one question",
        request=SaveAnswerSerializer,
        responses={
            200: SaveAnswerStoredSerializer,
            400: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
            409: SaveAnswerStaleWriteSerializer,
            410: ApiAssessmentDetailSerializer,
        },
    )
    @transaction.atomic
    def post(self, request):
        ser = SaveAnswerSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        client_seq = int(data.get("client_seq") or 0)

        att = AssessmentAttempt.objects.select_for_update(of=("self",)).select_related("homework").filter(
            pk=data["attempt_id"], student=request.user
        ).first()
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if att.status != AssessmentAttempt.STATUS_IN_PROGRESS:
            return Response({"detail": f"Attempt is locked ({att.lock_reason()})."}, status=status.HTTP_400_BAD_REQUEST)
        # Max lifetime gate (server-side). Measured on *elapsed* (active) time —
        # paused windows (save-and-exit) don't burn the lifetime, so a student can
        # pause overnight and still resume the next day.
        max_life = int(getattr(dj_settings, "ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS", 6 * 60 * 60) or 0)
        if max_life > 0 and att.started_at and att.elapsed_seconds(timezone.now()) > max_life:
            now = timezone.now()
            att.status = AssessmentAttempt.STATUS_ABANDONED
            att.abandoned_at = now
            att.last_activity_at = now
            att.save(update_fields=["status", "abandoned_at", "last_activity_at"])
            _audit_attempt(att, actor=request.user, event_type=AssessmentAttemptAuditEvent.EVENT_TIMEOUT_ABANDONED, payload={"reason": "max_lifetime"})
            return Response({"detail": "Attempt expired."}, status=status.HTTP_410_GONE)

        q = AssessmentQuestion.objects.filter(pk=data["question_id"], assessment_set=att.homework.assessment_set).first()
        if not q:
            return Response({"detail": "Question not found for this attempt."}, status=status.HTTP_404_NOT_FOUND)

        ans = data.get("answer", None)
        now = timezone.now()
        answered_at = now

        # Ensure the question is part of the attempt's question_order (defense-in-depth).
        order_ids = set((att.question_order or []) or [])
        if order_ids and q.id not in order_ids:
            return Response({"detail": "Question is not part of this attempt."}, status=status.HTTP_400_BAD_REQUEST)

        row, created = AssessmentAnswer.objects.select_for_update().get_or_create(
            attempt=att,
            question=q,
            defaults={
                "answer": ans,
                "answered_at": answered_at,
                "first_seen_at": now,
                "last_seen_at": now,
                "time_spent_seconds": 0,
                "client_seq": client_seq,
            },
        )
        if not created:
            # Optimistic concurrency: reject stale/out-of-order writes (multi-tab, mobile retries).
            if client_seq and int(getattr(row, "client_seq", 0) or 0) >= client_seq:
                return Response(
                    {
                        "detail": "Stale answer update rejected.",
                        "code": "stale_write",
                        "server_client_seq": int(getattr(row, "client_seq", 0) or 0),
                        "answer_id": row.pk,
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            row.answer = ans
            row.answered_at = answered_at
            if row.first_seen_at is None:
                row.first_seen_at = now
            row.last_seen_at = now
            row.client_seq = max(int(getattr(row, "client_seq", 0) or 0), int(client_seq or 0))
            # Compute time from server timestamps. Cap per-question time to avoid runaway.
            cap = int((q.grading_config or {}).get("max_seconds") or 15 * 60)
            cap = max(10, min(2 * 60 * 60, cap))
            delta = int((row.last_seen_at - row.first_seen_at).total_seconds()) if row.last_seen_at and row.first_seen_at else 0
            row.time_spent_seconds = max(0, min(cap, delta))
            row.save(
                update_fields=[
                    "answer",
                    "answered_at",
                    "first_seen_at",
                    "last_seen_at",
                    "time_spent_seconds",
                    "client_seq",
                    "updated_at",
                ]
            )

        update_fields = ["last_activity_at", "active_time_seconds"]

        # A save is unambiguous activity: if the attempt was paused (e.g. the
        # runner resumed and immediately flushed a queued answer), bank the pause
        # window and clear the flag so state can't get stuck "paused".
        if att.paused_at is not None:
            att.paused_seconds = int(att.paused_seconds or 0) + max(
                0, int((now - att.paused_at).total_seconds())
            )
            att.paused_at = None
            update_fields += ["paused_seconds", "paused_at"]

        # Persist the last-viewed question position for resume-in-place.
        raw_idx = ser.validated_data.get("current_index")
        if raw_idx is not None:
            att.current_question_index = int(raw_idx)
            update_fields.append("current_question_index")

        # Active time accumulation: count time between server-observed events, ignore idle gaps.
        idle_threshold = int(getattr(dj_settings, "ASSESSMENT_ACTIVE_IDLE_THRESHOLD_SECONDS", 90) or 90)
        slice_cap = int(getattr(dj_settings, "ASSESSMENT_ACTIVE_SLICE_CAP_SECONDS", 45) or 45)
        idle_threshold = max(10, min(15 * 60, idle_threshold))
        slice_cap = max(1, min(idle_threshold, slice_cap))
        prev = att.last_activity_at or att.started_at
        delta = int((now - prev).total_seconds()) if prev else 0
        add = 0
        if 0 < delta <= idle_threshold:
            add = min(slice_cap, delta)
        att.active_time_seconds = int(att.active_time_seconds or 0) + int(add)
        att.last_activity_at = now
        att.save(update_fields=update_fields)
        _audit_attempt(
            att,
            actor=request.user,
            event_type=AssessmentAttemptAuditEvent.EVENT_ANSWER_SAVED,
            payload={"question_id": q.id, "answer_present": ans is not None},
        )
        return Response({"answer_id": row.pk}, status=status.HTTP_200_OK)


class SubmitAttemptView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Submit attempt for grading",
        request=SubmitAttemptSerializer,
        responses={
            200: SubmitAttemptCompleteResponseSerializer,
            202: SubmitAttemptQueuedResponseSerializer,
            400: SubmitAttemptBadRequestSerializer,
            404: ApiAssessmentDetailSerializer,
            409: SubmitAssessmentVersionConflictSerializer,
            410: ApiAssessmentDetailSerializer,
        },
    )
    @transaction.atomic
    def post(self, request):
        ser = SubmitAttemptSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        attempt_id = int(ser.validated_data["attempt_id"])

        att = (
            AssessmentAttempt.objects.select_for_update(of=("self",))
            .select_related("homework", "homework__assessment_set", "homework__assignment", "homework__classroom")
            .filter(pk=attempt_id, student=request.user)
            .first()
        )
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if att.status in (AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED):
            res = AssessmentResult.objects.filter(attempt=att).first()
            return Response(
                {"attempt": AttemptSerializer(att).data, "result": ResultSerializer(res).data if res else None}
            )
        if att.status == AssessmentAttempt.STATUS_ABANDONED:
            return Response({"detail": "Attempt is abandoned."}, status=status.HTTP_400_BAD_REQUEST)
        # Max lifetime gate.
        max_life = int(getattr(dj_settings, "ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS", 6 * 60 * 60) or 0)
        if max_life > 0 and att.started_at and (timezone.now() - att.started_at).total_seconds() > max_life:
            return Response({"detail": "Attempt expired."}, status=status.HTTP_410_GONE)

        aset = att.homework.assessment_set
        base_questions = list(
            AssessmentQuestion.objects.filter(assessment_set=aset, is_active=True).order_by("order", "id")
        )
        q_by_id = {q.id: q for q in base_questions}
        # Mid-attempt teacher edits to the SET MEMBERSHIP are IGNORED: the attempt was
        # frozen to a fixed question list at start (att.question_order), so a submit is
        # ALWAYS accepted and graded against that frozen list — never blocked with a
        # "restart" just because the live set changed. Content is read live from the
        # AssessmentQuestion rows for the pinned ids. A brand-new attempt with the
        # latest questions is what the student gets on retry instead.
        order_ids = [int(x) for x in (att.question_order or []) if isinstance(x, (int, str)) and str(x).isdigit()]
        questions = [q_by_id[qid] for qid in order_ids if qid in q_by_id] if order_ids else base_questions

        answers = {
            a.question_id: a
            for a in AssessmentAnswer.objects.filter(attempt=att, question_id__in=q_by_id.keys())
        }

        # Completeness: optionally require an answer row for every question (grading itself is deferred).
        missing = [q.id for q in questions if q.id not in answers]
        enforce = str(getattr(dj_settings, "ASSESSMENT_ENFORCE_COMPLETENESS", "False")).lower() in ("1", "true", "yes")
        if enforce and missing:
            return Response(
                {"detail": "Please answer all questions before submitting.", "missing_question_ids": missing[:50]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        total_answer_time = sum(
            int(getattr(answers.get(q.id), "time_spent_seconds", 0) or 0) for q in questions
        )

        now = timezone.now()
        prev_activity_for_slice = att.last_activity_at or att.started_at
        att.status = AssessmentAttempt.STATUS_SUBMITTED
        att.submitted_at = now
        # A submit ends any in-flight pause (student is active here). Bank it so
        # the paused gap is excluded from total time and never lingers as "paused".
        if att.paused_at is not None:
            att.paused_seconds = int(att.paused_seconds or 0) + max(
                0, int((now - att.paused_at).total_seconds())
            )
            att.paused_at = None
        # Harden total time: derive primarily from the server attempt span, minus
        # paused windows (save-and-exit), not per-answer time.
        span = att.elapsed_seconds(now) if att.started_at else 0
        span_cap = 6 * 60 * 60  # 6h safety cap
        span = max(0, min(span_cap, span))
        att.total_time_seconds = max(span, min(span_cap, total_answer_time))
        # Active time: final slice uses activity *before* we stamp submitted_at / last_activity_at.
        prev = prev_activity_for_slice
        if prev and prev < now:
            idle_threshold = int(getattr(dj_settings, "ASSESSMENT_ACTIVE_IDLE_THRESHOLD_SECONDS", 90) or 90)
            slice_cap = int(getattr(dj_settings, "ASSESSMENT_ACTIVE_SLICE_CAP_SECONDS", 45) or 45)
            idle_threshold = max(10, min(15 * 60, idle_threshold))
            slice_cap = max(1, min(idle_threshold, slice_cap))
            delta = int((now - prev).total_seconds())
            if 0 < delta <= idle_threshold:
                att.active_time_seconds = int(att.active_time_seconds or 0) + int(min(slice_cap, delta))
        att.last_activity_at = now

        # Per-question time spent (sent by the student runner). Validate to a
        # clean {str(qid): int seconds} dict so the result page can render it.
        raw_qt = request.data.get("question_times") or {}
        if isinstance(raw_qt, dict):
            cleaned_qt: dict[str, int] = {}
            for k, v in raw_qt.items():
                try:
                    qid = int(k)
                    secs = max(0, min(span_cap, int(v)))
                    cleaned_qt[str(qid)] = secs
                except (TypeError, ValueError):
                    continue
            att.question_times = cleaned_qt

        broker = str(getattr(dj_settings, "CELERY_BROKER_URL", "") or "").strip()
        eager = bool(getattr(dj_settings, "CELERY_TASK_ALWAYS_EAGER", False))
        use_async = bool(broker) or eager

        submit_update_fields = [
            "status",
            "submitted_at",
            "total_time_seconds",
            "last_activity_at",
            "active_time_seconds",
            "question_times",
            "paused_at",
            "paused_seconds",
        ]
        if use_async:
            att.grading_status = AssessmentAttempt.GRADING_PENDING
            att.grading_error = ""
            submit_update_fields.extend(["grading_status", "grading_error"])

        att.save(update_fields=submit_update_fields)
        _audit_attempt(att, actor=request.user, event_type=AssessmentAttemptAuditEvent.EVENT_SUBMITTED, payload={"total_time_seconds": att.total_time_seconds})

        # Sync class Submission so the grading UI shows the student as "submitted"
        try:
            from classes.homework_auto_submit import sync_assessment_submission
            sync_assessment_submission(att)
        except Exception:
            logger.exception("sync_assessment_submission failed attempt_id=%s", att.pk)

        # Always grade synchronously so students see their results immediately
        # without waiting for the teacher or a background worker. Auto-gradeable
        # question types (multiple choice, numeric, boolean, short text with
        # tolerance) score in milliseconds. If sync grading fails, we fall back
        # to the async path as a safety net.
        try:
            res = grade_attempt(attempt_id=att.pk)
            att.refresh_from_db()
            return Response({
                "attempt": AttemptSerializer(att).data,
                "result": ResultSerializer(res).data if res else None,
            })
        except Exception:
            logger.exception("sync grade_attempt failed; falling back to async attempt_id=%s", att.pk)
            if use_async:
                transaction.on_commit(lambda pk=att.pk: grade_attempt_task.delay(pk))
            att.refresh_from_db()
            return Response(
                {"attempt": AttemptSerializer(att).data, "result": None, "grading": "pending"},
                status=status.HTTP_202_ACCEPTED,
            )


class AbandonAttemptView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen]

    @transaction.atomic
    def post(self, request):
        attempt_id = int((request.data or {}).get("attempt_id") or 0)
        if not attempt_id:
            return Response({"detail": "attempt_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        att = (
            AssessmentAttempt.objects.select_for_update()
            .filter(pk=attempt_id, student=request.user)
            .first()
        )
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if att.status != AssessmentAttempt.STATUS_IN_PROGRESS:
            return Response({"detail": f"Attempt cannot be abandoned from {att.status}."}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        att.status = AssessmentAttempt.STATUS_ABANDONED
        att.abandoned_at = now
        att.last_activity_at = now
        att.save(update_fields=["status", "abandoned_at", "last_activity_at"])
        _audit_attempt(att, actor=request.user, event_type=AssessmentAttemptAuditEvent.EVENT_ABANDONED, payload={})
        return Response({"attempt": AttemptSerializer(att).data}, status=status.HTTP_200_OK)


def _parse_index(raw) -> int | None:
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    return v if v >= 0 else None


class PauseAttemptView(APIView):
    """Freeze an in-progress attempt (save-and-exit / auto-pause on tab-leave).

    Stamps ``paused_at`` so the elapsed time-on-task counter freezes; the attempt
    stays IN_PROGRESS and fully resumable. Idempotent — pausing an already-paused
    attempt keeps the original pause start. Optionally records the last-viewed
    question index so resume lands in place. Answers are autosaved separately;
    this endpoint only manages pause state + cursor."""

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Pause attempt (save and exit / auto-pause)",
        responses={200: AttemptSerializer, 404: ApiAssessmentDetailSerializer},
    )
    @transaction.atomic
    def post(self, request):
        attempt_id = int((request.data or {}).get("attempt_id") or 0)
        if not attempt_id:
            return Response({"detail": "attempt_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        att = (
            AssessmentAttempt.objects.select_for_update()
            .filter(pk=attempt_id, student=request.user)
            .first()
        )
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        # Only a live attempt can be paused; for any terminal state just echo it
        # back so the client can no-op gracefully (keepalive pauses may race a submit).
        if att.status != AssessmentAttempt.STATUS_IN_PROGRESS:
            att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
            return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)

        now = timezone.now()
        fields: list[str] = []
        if att.paused_at is None:
            att.paused_at = now
            fields.append("paused_at")
        idx = _parse_index((request.data or {}).get("current_index"))
        if idx is not None:
            att.current_question_index = idx
            fields.append("current_question_index")
        if fields:
            att.save(update_fields=fields)
            _audit_attempt(
                att, actor=request.user,
                event_type=AssessmentAttemptAuditEvent.EVENT_PAUSED,
                payload={"current_index": att.current_question_index},
            )
        att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
        return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)


class ResumeAttemptView(APIView):
    """Un-freeze a paused attempt. Banks the pause window into ``paused_seconds``
    and clears ``paused_at`` so the elapsed counter continues from where it froze
    (no jump). Idempotent for a running attempt."""

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Resume a paused attempt",
        responses={200: AttemptSerializer, 404: ApiAssessmentDetailSerializer},
    )
    @transaction.atomic
    def post(self, request):
        attempt_id = int((request.data or {}).get("attempt_id") or 0)
        if not attempt_id:
            return Response({"detail": "attempt_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        att = (
            AssessmentAttempt.objects.select_for_update()
            .filter(pk=attempt_id, student=request.user)
            .first()
        )
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if att.status == AssessmentAttempt.STATUS_ABANDONED and att.submitted_at is None:
            # Resurrect a reaped attempt. An inactivity-abandon destroys nothing —
            # the answers are still rows — but without this path the returning
            # student's every save 400s "locked (abandoned)" while the runner
            # keeps accepting picks, which is exactly how answered questions end
            # up graded Omitted. Guards: only a timeout/self-abandon (never a
            # submitted attempt), only within the resurrect window, and only if
            # the active-time lifetime (the same gate the save path enforces)
            # is not exhausted.
            now = timezone.now()
            window_s = int(getattr(dj_settings, "ASSESSMENT_ATTEMPT_RESURRECT_WINDOW_SECONDS", 48 * 3600) or 0)
            max_life = int(getattr(dj_settings, "ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS", 6 * 60 * 60) or 0)
            gap = max(0, int((now - att.abandoned_at).total_seconds())) if att.abandoned_at else 0
            recent = window_s <= 0 or gap <= window_s
            # Bank the dead gap as pause (in memory first) so it is neither billed
            # as active time nor counted against the lifetime gate.
            att.paused_seconds = int(att.paused_seconds or 0) + gap
            within_life = not (max_life > 0 and att.started_at and att.elapsed_seconds(now) > max_life)
            if recent and within_life:
                att.status = AssessmentAttempt.STATUS_IN_PROGRESS
                att.abandoned_at = None
                att.paused_at = None
                att.last_activity_at = now
                att.save(update_fields=["status", "abandoned_at", "paused_at", "paused_seconds", "last_activity_at"])
                _audit_attempt(
                    att, actor=request.user,
                    event_type=AssessmentAttemptAuditEvent.EVENT_RESUMED,
                    payload={"from": "abandoned", "gap_seconds": gap},
                )
                att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
                return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)
            att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
            return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)
        if att.status != AssessmentAttempt.STATUS_IN_PROGRESS:
            att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
            return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)

        now = timezone.now()
        if att.paused_at is not None:
            att.paused_seconds = int(att.paused_seconds or 0) + max(
                0, int((now - att.paused_at).total_seconds())
            )
            att.paused_at = None
            # Reset the activity clock so the paused gap isn't billed as active time.
            att.last_activity_at = now
            att.save(update_fields=["paused_seconds", "paused_at", "last_activity_at"])
            _audit_attempt(
                att, actor=request.user,
                event_type=AssessmentAttemptAuditEvent.EVENT_RESUMED,
                payload={"paused_seconds": att.paused_seconds},
            )
        att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
        return Response(AttemptSerializer(att).data, status=status.HTTP_200_OK)
