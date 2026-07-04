from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from users.permissions import IsAuthenticatedAndNotFrozen
from classes.models import ClassroomMembership
from .models import (
    HomeworkAssignment,
    AssessmentAttempt,
    AssessmentResult,
)
from .serializers import (
    AttemptSerializer,
    ResultSerializer,
    ApiAssessmentDetailSerializer,
    MyAssessmentResultResponseSerializer,
)
from .helpers import _build_hw_meta


class MyAssessmentResultForAssignmentView(APIView):
    """
    Convenience endpoint for the homework page: given a class assignment id, return the
    student's latest attempt/result for that assessment homework.

    Response shape:
        attempt  — AssessmentAttempt data (or null if not yet started)
        result   — AssessmentResult data (or null if not yet graded)
        meta     — Human-readable context: assignment title, set name, due date, question count.
                   Always present. Frontend should use `meta` rather than `attempt.homework_id`
                   to display labels so students see real titles not internal IDs.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="My latest attempt and result for assignment",
        responses={
            200: MyAssessmentResultResponseSerializer,
            403: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    def get(self, request, assignment_id: int):
        # Back-compat: resolve by assignment (the FIRST attached assessment). For a
        # bundle with several assessments, the frontend uses the homework-keyed route.
        hw = HomeworkAssignment.objects.select_related(
            "assessment_set", "assignment", "classroom"
        ).filter(assignment_id=assignment_id).order_by("id").first()
        return _my_result_response(request, hw)


class MyAssessmentResultForHomeworkView(APIView):
    """Student's latest attempt/result for ONE assessment homework (unambiguous for
    bundles that hold several assessments)."""

    permission_classes = [IsAuthenticatedAndNotFrozen]

    @extend_schema(
        tags=["assessments"],
        summary="My latest attempt and result for a homework",
        responses={
            200: MyAssessmentResultResponseSerializer,
            403: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    def get(self, request, homework_id: int):
        hw = HomeworkAssignment.objects.select_related(
            "assessment_set", "assignment", "classroom"
        ).filter(pk=homework_id).first()
        return _my_result_response(request, hw)


def _my_result_response(request, hw):
    """Shared body: latest attempt + result + meta for the requesting student."""
    if not hw:
        return Response({"detail": "Assessment homework not found."}, status=status.HTTP_404_NOT_FOUND)
    membership = hw.classroom.memberships.filter(user=request.user).first()
    if not membership:
        return Response({"detail": "You are not a member of this classroom."}, status=status.HTTP_403_FORBIDDEN)
    # Admins see the assignment meta but have no student attempt
    if membership.role == ClassroomMembership.ROLE_ADMIN:
        return Response({"attempt": None, "result": None, "meta": _build_hw_meta(hw)})
    att = (
        AssessmentAttempt.objects.filter(homework=hw, student=request.user)
        .order_by("-started_at", "-id")
        .first()
    )
    if not att:
        return Response({"attempt": None, "result": None, "meta": _build_hw_meta(hw)})
    res = AssessmentResult.objects.filter(attempt=att).first()
    return Response({
        "attempt": AttemptSerializer(att).data,
        "result": ResultSerializer(res).data if res else None,
        "meta": _build_hw_meta(hw),
    })
