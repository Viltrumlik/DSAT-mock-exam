"""Teacher-facing endpoint for the per-question item analysis.

Thin by design: every counting decision lives in ``assessments.item_analysis``, which has no
DRF in it and can be exercised without a request. What is left here is the three things a view
is actually for — who may ask, what they asked for, and turning a bad ask into a clear error
rather than an empty page.

The scoping is deliberately NOT the block in ``views_review.TeacherSubmissionQueueView``; see
``item_analysis.teacher_classroom_ids`` for what that one gets wrong and why.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from classes.models import Assignment, Classroom
from users.permissions import IsAuthenticatedAndNotFrozen

from .item_analysis import (
    DEFAULT_THRESHOLD,
    MAX_THRESHOLD,
    MIN_THRESHOLD,
    UnknownAssessmentSet,
    build_homework_item_analysis,
    build_item_analysis,
    parse_threshold,
    teacher_classroom_ids,
)


def _int_param(params, name: str) -> int | None:
    """One integer query parameter, or ``None`` when absent. Raises ``ValueError`` on junk."""
    raw = params.get(name)
    if raw is None or not str(raw).strip():
        return None
    return int(str(raw).strip())


class TeacherItemAnalysisView(APIView):
    """Per-question item analysis for one classroom's assessments.

    ``GET /api/assessments/teacher/item-analysis/?classroom=<id>[&set=<id>][&threshold=25]``
    ``GET /api/assessments/teacher/item-analysis/?assignment=<id>[&threshold=25]``

    Answers the owner's rule: which questions did a quarter or more of the answering students
    get wrong? Those come back first under ``needs_analysis``, ranked worst first, each row
    carrying the prompt excerpt, its set and its position in that set — so the list is
    actionable on its own without a second request per question.

    The two forms are alternatives, never combined. ``classroom`` (optionally narrowed by
    ``set``) is the standalone analysis page, which looks across a whole class. ``assignment``
    is the same report *inside one homework*: it resolves the classroom itself — a teacher who
    opened a homework has its id, not the classroom's — narrows to the assessments that
    homework carries, and withholds every number until the homework's deadline has passed.

    Visible to the classroom's teaching team (owner FK, plus any non-removed staff membership)
    and to global-scope staff, who see every classroom.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Per-question item analysis for a classroom",
        parameters=[
            OpenApiParameter(
                name="classroom",
                type=int,
                required=False,
                description="Classroom id. Required unless 'assignment' is given.",
            ),
            OpenApiParameter(
                name="set",
                type=int,
                required=False,
                description="Limit to one assessment set assigned to that classroom.",
            ),
            OpenApiParameter(
                name="assignment",
                type=int,
                required=False,
                description=(
                    "Homework (classes.Assignment) id — the in-homework form. Resolves the "
                    "classroom itself and narrows to the assessments this homework carries. "
                    "Mutually exclusive with 'set'. Until the homework's deadline has passed "
                    "the response is a 200 carrying only the 'homework' block with "
                    "locked=true."
                ),
            ),
            OpenApiParameter(
                name="threshold",
                type=float,
                required=False,
                description=(
                    f"Error-rate percentage at or above which a question is flagged "
                    f"(default {DEFAULT_THRESHOLD:g}, clamped to "
                    f"{MIN_THRESHOLD:g}–{MAX_THRESHOLD:g})."
                ),
            ),
        ],
        responses={200: None},  # freeform shape — no dedicated serializer yet
    )
    def get(self, request):
        params = request.query_params
        try:
            classroom_id = _int_param(params, "classroom")
            assessment_set_id = _int_param(params, "set")
            assignment_id = _int_param(params, "assignment")
        except ValueError:
            return Response(
                {"detail": "'classroom', 'set' and 'assignment' must be numeric ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            threshold = parse_threshold(params.get("threshold"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "'threshold' must be a number between 1 and 100."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if assignment_id is not None:
            return self._homework(
                request,
                assignment_id=assignment_id,
                assessment_set_id=assessment_set_id,
                classroom_id=classroom_id,
                threshold=threshold,
            )

        if classroom_id is None:
            return Response(
                {"detail": "Query parameter 'classroom' is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        classroom = get_object_or_404(Classroom, pk=classroom_id)
        scope = teacher_classroom_ids(request.user)
        if scope is not None and classroom.id not in scope:
            return Response(
                {"detail": "You do not teach this classroom."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            payload = build_item_analysis(
                classroom=classroom,
                assessment_set_id=assessment_set_id,
                threshold=threshold,
            )
        except UnknownAssessmentSet as exc:
            # A 404 rather than an empty analysis: "this set is not in this class" and
            # "nobody in this class got anything wrong" must never look the same on screen.
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        return Response(payload)

    # ── the in-homework form ─────────────────────────────────────────────────
    def _homework(self, request, *, assignment_id, assessment_set_id, classroom_id, threshold):
        """``?assignment=<id>`` — the analysis as it appears inside one homework.

        Out of scope is a **404, not a 403**, unlike the ``classroom=`` form above. The two
        are asking different questions. A teacher reaching the standalone page already knows
        the classroom exists — they picked it off their own list — so "you do not teach this
        one" is the honest answer. A homework id is a bare integer that anybody can guess at,
        and answering 403 to some ids and 404 to others turns this endpoint into a way of
        enumerating which homework ids exist school-wide. ``exams/views_item_analysis.py``
        already makes exactly this call for classrooms; this matches it.
        """
        if assessment_set_id is not None:
            return Response(
                {
                    "detail": (
                        "Pass either 'assignment' or 'set', not both — a homework already "
                        "says which assessments it carries."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment = (
            Assignment.objects.select_related("classroom").filter(pk=assignment_id).first()
        )
        if assignment is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        scope = teacher_classroom_ids(request.user)
        if scope is not None and assignment.classroom_id not in scope:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if classroom_id is not None and classroom_id != assignment.classroom_id:
            # Not ignored: a caller that sent both and disagrees with us is confused about
            # which class it is looking at, and silently answering about the other one is how
            # a teacher ends up reading another class's numbers.
            return Response(
                {"detail": "'classroom' does not match the homework's classroom."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            build_homework_item_analysis(assignment=assignment, threshold=threshold)
        )
