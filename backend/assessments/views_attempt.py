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
    AssessmentSetSerializer,
    StartAttemptSerializer,
    SaveAnswerSerializer,
    SubmitAttemptSerializer,
    AttemptSerializer,
    ResultSerializer,
    AssessmentQuestionSerializer,
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
    _image_map_for,
    _build_hw_meta,
    _QUESTION_IMAGE_FIELDS,
)

logger = logging.getLogger(__name__)


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
        assignment_id = int(ser.validated_data["assignment_id"])

        hw = HomeworkAssignment.objects.select_related(
            "assignment", "classroom", "assessment_set", "set_version"
        ).filter(assignment_id=assignment_id).first()
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
            # Determine question IDs and version source:
            # - If hw has a pinned set_version, build the question list from the
            #   immutable snapshot — stable content regardless of live edits.
            # - Otherwise fall back to live DB query (pre-snapshot assignment).
            if hw.set_version_id:
                from .domain.snapshot_builder import questions_from_snapshot
                raw_qs = questions_from_snapshot(hw.set_version.snapshot_json)
                qids = [q["id"] for q in sorted(raw_qs, key=lambda q: (q.get("order", 0), q["id"]))]
            else:
                qids = list(
                    AssessmentQuestion.objects.filter(
                        assessment_set=hw.assessment_set,
                        is_active=True,
                    )
                    .order_by("order", "id")
                    .values_list("id", flat=True)
                )

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
                # Pin the snapshot version from the homework onto the attempt so
                # grading always uses the frozen content that was delivered.
                set_version=hw.set_version,
            )
            _audit_attempt(
                att,
                actor=request.user,
                event_type=AssessmentAttemptAuditEvent.EVENT_STARTED,
                payload={
                    "question_count": len(qids),
                    "snapshot_pinned": hw.set_version_id is not None,
                    "retry_mode": bool(focus_ids),
                },
            )
        else:
            if not att.last_activity_at:
                att.last_activity_at = timezone.now()
                att.save(update_fields=["last_activity_at"])

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
            "homework__classroom", "homework__assessment_set", "set_version"
        ).filter(pk=attempt_id, student=request.user).first()
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

        hw = att.homework
        if not hw.classroom.memberships.filter(user=request.user, role=ClassroomMembership.ROLE_STUDENT).exists():
            return Response({"detail": "Only students can view this attempt."}, status=status.HTTP_403_FORBIDDEN)

        aset = hw.assessment_set
        order_ids = [int(x) for x in (att.question_order or []) if isinstance(x, (int, str)) and str(x).isdigit()]

        # ── Snapshot path ─────────────────────────────────────────────────────
        # When the attempt was created from a pinned snapshot, serve questions
        # directly from snapshot_json — zero live question lookups. This
        # guarantees students always see the exact content that was locked at
        # publish time, even if the live set has been edited since.
        if att.set_version_id:
            from .domain.snapshot_builder import questions_from_snapshot

            raw_qs = questions_from_snapshot(att.set_version.snapshot_json)
            # Build a sanitized list (no correct_answer, no grading_config).
            raw_by_id = {q["id"]: q for q in raw_qs}
            sanitized = [
                {
                    "id": q["id"],
                    "order": q.get("order", 0),
                    "prompt": q.get("prompt", ""),
                    "question_type": q["question_type"],
                    "choices": q.get("choices") or [],
                    "points": q.get("points", 1),
                    # correct_answer and grading_config intentionally omitted
                }
                for q in (
                    [raw_by_id[qid] for qid in order_ids if qid in raw_by_id]
                    if order_ids else sorted(raw_qs, key=lambda q: (q.get("order", 0), q["id"]))
                )
            ]
            # Snapshots pin neither images nor the stimulus/passage text —
            # supplement both from the live rows so diagrams/figures and passages
            # render in the frozen runner (matches the live + review paths).
            # Text/choices/answers still come from the snapshot, preserving freeze.
            sanitized_ids = [s["id"] for s in sanitized]
            img_map = _image_map_for(sanitized_ids)
            prompt_map = dict(
                AssessmentQuestion.objects.filter(id__in=sanitized_ids).values_list(
                    "id", "question_prompt"
                )
            )
            for s in sanitized:
                s.update(img_map.get(s["id"], {f: None for f in _QUESTION_IMAGE_FIELDS}))
                s["question_prompt"] = prompt_map.get(s["id"], "")
            att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
            return Response(
                {
                    "attempt": AttemptSerializer(att).data,
                    "set": AssessmentSetSerializer(aset).data,
                    "questions": sanitized,
                    "snapshot_version": att.set_version_id,
                    # Outer classes.Assignment PK — used by student UI to navigate
                    # to /assessments/result/{assignment_id} after submit.
                    "assignment_id": hw.assignment_id,
                    # Pedagogical context block: classroom name, assignment title,
                    # due date, question count. Displayed in the runner header so
                    # students always know which class this assessment is for.
                    "meta": _build_hw_meta(hw),
                }
            )

        # ── Live path (pre-snapshot attempts) ─────────────────────────────────
        # Emit fallback telemetry — primary signal for sunset monitoring.
        try:
            from .domain.governance_events import emit_fallback_path_used
            emit_fallback_path_used(
                attempt_id=att.pk,
                set_id=aset.pk,
                context="bundle",
            )
        except Exception:
            pass  # never block delivery

        base_questions = list(
            AssessmentQuestion.objects.filter(assessment_set=aset, is_active=True).order_by("order", "id")
        )
        q_by_id = {q.id: q for q in base_questions}
        questions = [q_by_id[qid] for qid in order_ids if qid in q_by_id] if order_ids else base_questions

        att = AssessmentAttempt.objects.filter(pk=att.pk).prefetch_related("answers").first()
        return Response(
            {
                "attempt": AttemptSerializer(att).data,
                "set": AssessmentSetSerializer(aset).data,
                "questions": AssessmentQuestionSerializer(questions, many=True).data,
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
        # Max lifetime gate (server-side).
        max_life = int(getattr(dj_settings, "ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS", 6 * 60 * 60) or 0)
        if max_life > 0 and att.started_at and (timezone.now() - att.started_at).total_seconds() > max_life:
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
        att.save(update_fields=["last_activity_at", "active_time_seconds"])
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
        # Validate assessment version: if question snapshot doesn't match active questions, force restart.
        active_now = set(q_by_id.keys())
        snap = set(int(x) for x in (att.question_order or []) if str(x).isdigit())
        if snap and snap != active_now:
            return Response(
                {"detail": "This assessment was updated. Please restart the attempt."},
                status=status.HTTP_409_CONFLICT,
            )

        # Use the attempt's stored question_order when present; otherwise canonical order.
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
        # Harden total time: derive primarily from server attempt span, not per-answer time.
        span = int((now - att.started_at).total_seconds()) if att.started_at else 0
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
