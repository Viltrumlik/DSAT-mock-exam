from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from access.services import is_global_scope_staff
from users.permissions import IsAuthenticatedAndNotFrozen
from classes.models import (
    Classroom,
    ClassroomMembership,
)
from .models import (
    AssessmentQuestion,
    AssessmentAttempt,
    AssessmentAnswer,
    AssessmentResult,
    AssessmentAttemptFeedback,
)
from .serializers import (
    ResultSerializer,
    ApiAssessmentDetailSerializer,
)
from .helpers import (
    _img_url,
    _image_map_for,
    _serialize_feedback,
    _build_hw_meta,
    _QUESTION_IMAGE_FIELDS,
)


class AttemptPedagogicalReviewView(APIView):
    """
    Post-submission pedagogical review for a student's assessment attempt.

    Only accessible after the attempt has been submitted or graded — the
    instructional moment where students learn from their work.

    Returns questions WITH correct_answer, explanation, and the student's
    own answer + correctness, framed for learning (not SAT benchmarking).

    Response shape:
        meta      — classroom_name, assignment_title, set_title, set_category,
                    due_at, question_count
        result    — score_points, max_points, percent, correct_count, total_questions
                    (null when grading is still pending)
        questions — ordered list of:
                    { id, order, prompt, question_prompt, question_type,
                      choices, points, correct_answer, explanation,
                      student_answer, is_correct, points_awarded }
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Pedagogical review bundle (post-submission, with answers)",
        responses={
            200: None,  # freeform shape — no dedicated serializer yet
            403: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    def get(self, request, attempt_id: int):
        att = (
            AssessmentAttempt.objects.select_related(
                "homework__classroom",
                "homework__assessment_set",
                "homework__assignment",
                "set_version",
            )
            .prefetch_related("answers__question", "teacher_feedback__teacher")
            .filter(pk=attempt_id, student=request.user)
            .first()
        )
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

        # Students only — teacher/ops views go through admin endpoints.
        hw = att.homework
        if not hw.classroom.memberships.filter(
            user=request.user, role=ClassroomMembership.ROLE_STUDENT
        ).exists():
            return Response({"detail": "Only students can view this review."}, status=status.HTTP_403_FORBIDDEN)

        # Gate: review is only meaningful after submission.
        # in_progress and abandoned attempts are not reviewable here.
        if att.status not in (
            AssessmentAttempt.STATUS_SUBMITTED,
            AssessmentAttempt.STATUS_GRADED,
        ):
            return Response(
                {"detail": "Review is only available after submission."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Build answer lookup: {question_id: answer_row}
        answer_map: dict[int, AssessmentAnswer] = {a.question_id: a for a in att.answers.all()}

        order_ids = [
            int(x) for x in (att.question_order or []) if isinstance(x, (int, str)) and str(x).isdigit()
        ]

        result_obj = AssessmentResult.objects.filter(attempt=att).first()
        result_data = ResultSerializer(result_obj).data if result_obj else None

        # ── Snapshot path ─────────────────────────────────────────────────────
        # Snapshot stores choices + correct_answer but NOT explanation or
        # question_prompt (they weren't captured at publish time).  We must
        # supplement from the live DB for those two fields.
        if att.set_version_id:
            from .domain.snapshot_builder import questions_from_snapshot

            raw_qs = questions_from_snapshot(att.set_version.snapshot_json)
            raw_by_id = {q["id"]: q for q in raw_qs}

            # Bulk-fetch live supplement fields (explanation + question_prompt only)
            snap_ids = list(raw_by_id.keys())
            live_supplement = {
                q.id: q
                for q in AssessmentQuestion.objects.filter(id__in=snap_ids).only(
                    "id", "explanation", "question_prompt"
                )
            }
            # Snapshots don't pin images — supplement from live rows (freeze-safe).
            img_map = _image_map_for(snap_ids)

            ordered = (
                [raw_by_id[qid] for qid in order_ids if qid in raw_by_id]
                if order_ids
                else sorted(raw_qs, key=lambda q: (q.get("order", 0), q["id"]))
            )

            questions_out = []
            for q in ordered:
                qid = q["id"]
                live = live_supplement.get(qid)
                ans = answer_map.get(qid)
                questions_out.append(
                    {
                        "id": qid,
                        "order": q.get("order", 0),
                        "prompt": q.get("prompt", ""),
                        "question_prompt": live.question_prompt if live else "",
                        "question_type": q["question_type"],
                        "choices": q.get("choices") or [],
                        "points": q.get("points", 1),
                        "correct_answer": q.get("correct_answer"),
                        "explanation": live.explanation if live else "",
                        **img_map.get(qid, {f: None for f in _QUESTION_IMAGE_FIELDS}),
                        # Student performance fields
                        "student_answer": ans.answer if ans else None,
                        "is_correct": ans.is_correct if ans else None,
                        "points_awarded": float(ans.points_awarded) if ans and ans.points_awarded is not None else None,
                    }
                )

            fb = getattr(att, "teacher_feedback", None)
            return Response(
                {
                    "meta": _build_hw_meta(hw),
                    "result": result_data,
                    "questions": questions_out,
                    "snapshot_pinned": True,
                    "teacher_feedback": _serialize_feedback(fb),
                }
            )

        # ── Live path (pre-snapshot attempts) ─────────────────────────────────
        aset = hw.assessment_set
        base_questions = list(
            AssessmentQuestion.objects.filter(assessment_set=aset, is_active=True).order_by("order", "id")
        )
        q_by_id = {q.id: q for q in base_questions}
        ordered = [q_by_id[qid] for qid in order_ids if qid in q_by_id] if order_ids else base_questions

        questions_out = []
        for q in ordered:
            ans = answer_map.get(q.id)
            questions_out.append(
                {
                    "id": q.id,
                    "order": q.order,
                    "prompt": q.prompt,
                    "question_prompt": q.question_prompt,
                    "question_type": q.question_type,
                    "choices": q.choices if q.choices is not None else [],
                    "points": q.points,
                    "correct_answer": q.correct_answer,
                    "explanation": q.explanation,
                    **{f: _img_url(getattr(q, f)) for f in _QUESTION_IMAGE_FIELDS},
                    # Student performance fields
                    "student_answer": ans.answer if ans else None,
                    "is_correct": ans.is_correct if ans else None,
                    "points_awarded": float(ans.points_awarded) if ans and ans.points_awarded is not None else None,
                }
            )

        fb = getattr(att, "teacher_feedback", None)
        return Response(
            {
                "meta": _build_hw_meta(hw),
                "result": result_data,
                "questions": questions_out,
                "snapshot_pinned": False,
                "teacher_feedback": _serialize_feedback(fb),
            }
        )


class AttemptTeacherFeedbackView(APIView):
    """
    Instructional feedback from a teacher on a student's assessment attempt.

    GET  — returns existing feedback (or null body) for the attempt.
           Accessible by the attempt's student (post-submission) or the
           classroom teacher/admin.

    POST — upserts (creates or replaces) the feedback body.
           Only the classroom teacher or a staff admin may write.

    The record is intentionally one-per-attempt (not a thread) so teachers
    can refine their note without creating noise.  Students see the latest
    version in the pedagogical review page.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    # ── helpers ────────────────────────────────────────────────────────────────

    def _get_attempt_and_hw(self, attempt_id: int):
        return (
            AssessmentAttempt.objects.select_related(
                "homework__classroom",
                "homework__classroom__memberships",
                "student",
            )
            .filter(pk=attempt_id)
            .first()
        )

    def _is_teacher_or_admin(self, request, hw) -> bool:
        from classes.security import classroom_authz_for_user
        authz = classroom_authz_for_user(classroom=hw.classroom, user=request.user)
        return authz.is_teacher_owner or authz.is_class_admin or is_global_scope_staff(request.user)

    def _is_student_owner(self, request, att) -> bool:
        return att.student_id == request.user.pk

    # ── GET ────────────────────────────────────────────────────────────────────

    @extend_schema(tags=["assessments"], summary="Get teacher feedback for attempt")
    def get(self, request, attempt_id: int):
        att = self._get_attempt_and_hw(attempt_id)
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

        hw = att.homework
        if not (self._is_student_owner(request, att) or self._is_teacher_or_admin(request, hw)):
            return Response({"detail": "Not permitted."}, status=status.HTTP_403_FORBIDDEN)

        fb = AssessmentAttemptFeedback.objects.filter(attempt=att).first()
        return Response(
            {
                "attempt_id": att.pk,
                "feedback": {
                    "body": fb.body,
                    "updated_at": fb.updated_at.isoformat(),
                    "teacher_name": fb.teacher.get_full_name() if fb and fb.teacher else None,
                }
                if fb
                else None,
            }
        )

    # ── POST ───────────────────────────────────────────────────────────────────

    @extend_schema(tags=["assessments"], summary="Upsert teacher feedback for attempt")
    def post(self, request, attempt_id: int):
        att = self._get_attempt_and_hw(attempt_id)
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

        hw = att.homework
        if not self._is_teacher_or_admin(request, hw):
            return Response({"detail": "Only the classroom teacher can write feedback."}, status=status.HTTP_403_FORBIDDEN)

        body = (request.data.get("body") or "").strip()
        if not body:
            return Response({"detail": "Feedback body cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)
        if len(body) > 2000:
            return Response({"detail": "Feedback body must be 2000 characters or fewer."}, status=status.HTTP_400_BAD_REQUEST)

        fb, _ = AssessmentAttemptFeedback.objects.update_or_create(
            attempt=att,
            defaults={"teacher": request.user, "body": body},
        )
        return Response(
            {
                "attempt_id": att.pk,
                "feedback": {
                    "body": fb.body,
                    "updated_at": fb.updated_at.isoformat(),
                    "teacher_name": request.user.get_full_name() or request.user.email,
                },
            },
            status=status.HTTP_200_OK,
        )

    # ── DELETE ─────────────────────────────────────────────────────────────────

    @extend_schema(tags=["assessments"], summary="Delete teacher feedback for attempt")
    def delete(self, request, attempt_id: int):
        att = self._get_attempt_and_hw(attempt_id)
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

        hw = att.homework
        if not self._is_teacher_or_admin(request, hw):
            return Response({"detail": "Only the classroom teacher can delete feedback."}, status=status.HTTP_403_FORBIDDEN)

        AssessmentAttemptFeedback.objects.filter(attempt=att).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TeacherSubmissionQueueView(APIView):
    """
    Paginated list of submitted/graded attempts for all classrooms where the
    requesting user is the teacher owner or a class admin.

    Intended for the ops submission queue: teacher sees who has submitted,
    can jump to the pedagogical review, add feedback, or note missing work.

    Query params:
        classroom_id  — filter to a single classroom (optional)
        status        — "submitted" | "graded" | "all" (default: all terminal states)
        limit         — page size (default 50, max 200)
        offset        — pagination offset

    Response item shape:
        attempt_id, student_name, student_email, submitted_at, status,
        grading_status, result_percent, assignment_title, classroom_name,
        has_feedback
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(tags=["assessments"], summary="Teacher submission queue")
    def get(self, request):
        # Gather classrooms where this user is teacher or class admin
        from classes.models import ClassroomMembership

        teacher_classroom_ids = list(
            Classroom.objects.filter(
                teacher=request.user,
            ).values_list("id", flat=True)
        ) + list(
            ClassroomMembership.objects.filter(
                user=request.user,
                role=ClassroomMembership.ROLE_TEACHER,
            ).values_list("classroom_id", flat=True)
        )
        # Also allow ops/staff to see all
        if is_global_scope_staff(request.user):
            teacher_classroom_ids = None  # unrestricted

        # Filter params
        classroom_id = request.query_params.get("classroom_id")
        status_filter = request.query_params.get("status", "all")
        limit = min(int(request.query_params.get("limit", 50)), 200)
        offset = int(request.query_params.get("offset", 0))

        qs = (
            AssessmentAttempt.objects.select_related(
                "student",
                "homework__classroom",
                "homework__assignment",
                "result",
            )
            .prefetch_related("teacher_feedback")
        )

        if teacher_classroom_ids is not None:
            if not teacher_classroom_ids:
                return Response({"count": 0, "items": []})
            qs = qs.filter(homework__classroom_id__in=teacher_classroom_ids)

        if classroom_id:
            qs = qs.filter(homework__classroom_id=int(classroom_id))

        if status_filter == "submitted":
            qs = qs.filter(status=AssessmentAttempt.STATUS_SUBMITTED)
        elif status_filter == "graded":
            qs = qs.filter(status=AssessmentAttempt.STATUS_GRADED)
        else:
            qs = qs.filter(status__in=[AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED])

        qs = qs.order_by("-submitted_at", "-id")
        total = qs.count()
        page = list(qs[offset : offset + limit])

        items = []
        for att in page:
            hw = att.homework
            student = att.student
            res = getattr(att, "result", None)
            fb = getattr(att, "teacher_feedback", None)
            items.append(
                {
                    "attempt_id": att.pk,
                    "student_name": student.get_full_name() or student.email,
                    "student_email": student.email,
                    "submitted_at": att.submitted_at.isoformat() if att.submitted_at else None,
                    "status": att.status,
                    "grading_status": att.grading_status,
                    "result_percent": float(res.percent) if res else None,
                    "result_correct_count": res.correct_count if res else None,
                    "result_total_questions": res.total_questions if res else None,
                    "assignment_title": hw.assignment.title if hw and hw.assignment else None,
                    "classroom_name": hw.classroom.name if hw and hw.classroom else None,
                    "classroom_id": hw.classroom_id if hw else None,
                    "assignment_id": hw.assignment_id if hw else None,
                    "has_feedback": fb is not None,
                }
            )

        return Response({"count": total, "items": items})
