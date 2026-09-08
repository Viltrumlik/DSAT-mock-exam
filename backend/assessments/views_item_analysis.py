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

from classes.models import Classroom
from users.permissions import IsAuthenticatedAndNotFrozen

from .item_analysis import (
    DEFAULT_THRESHOLD,
    MAX_THRESHOLD,
    MIN_THRESHOLD,
    UnknownAssessmentSet,
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

    Answers the owner's rule: which questions did a quarter or more of the answering students
    get wrong? Those come back first under ``needs_analysis``, ranked worst first, each row
    carrying the prompt excerpt, its set and its position in that set — so the list is
    actionable on its own without a second request per question.

    Visible to the classroom's teaching team (owner FK, plus any non-removed staff membership)
    and to global-scope staff, who see every classroom.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="Per-question item analysis for a classroom",
        parameters=[
            OpenApiParameter(
                name="classroom", type=int, required=True, description="Classroom id."
            ),
            OpenApiParameter(
                name="set",
                type=int,
                required=False,
                description="Limit to one assessment set assigned to that classroom.",
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
        except ValueError:
            return Response(
                {"detail": "'classroom' and 'set' must be numeric ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if classroom_id is None:
            return Response(
                {"detail": "Query parameter 'classroom' is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            threshold = parse_threshold(params.get("threshold"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "'threshold' must be a number between 1 and 100."},
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
