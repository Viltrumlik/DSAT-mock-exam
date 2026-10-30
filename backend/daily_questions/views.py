"""The student's card: today's questions, and one answer to each.

Plain ``APIView`` classes with the default ``permission_classes`` left alone — the default is
``IsAuthenticatedAndNotFrozen``, and naming our own would replace it (the frozen-learner gap
this codebase has closed view by view). ``daily.is_eligible`` decides the rest: role, freeze
exemption, the feature flag.

A public learner never reaches these: ``/api/daily-questions/`` is not on the host guard's
public allowlist, so the learning-center-only rule holds before the view runs.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status as http
from rest_framework.response import Response
from rest_framework.views import APIView

from . import daily
from .serializers import DailyQuestionSerializer, earned_by_assignment, reward_on_offer

_REFUSAL_STATUS = {
    "unavailable": http.HTTP_403_FORBIDDEN,
    "not_found": http.HTTP_404_NOT_FOUND,
    "blank": http.HTTP_400_BAD_REQUEST,
    "invalid": http.HTTP_400_BAD_REQUEST,
    "try_again": http.HTTP_503_SERVICE_UNAVAILABLE,
    "already_answered": http.HTTP_409_CONFLICT,
    "expired": http.HTTP_409_CONFLICT,
}


def _payload(request, assignments) -> dict:
    context = {"request": request, "earned": earned_by_assignment(assignments)}
    return {
        "date": timezone.localdate().isoformat(),
        "enabled": daily.is_enabled(),
        "reward": reward_on_offer(),
        "questions": DailyQuestionSerializer(assignments, many=True, context=context).data,
    }


class TodayView(APIView):
    def get(self, request):
        return Response(_payload(request, daily.todays_questions(request.user)))


class AnswerView(APIView):
    def post(self, request, assignment_id: int):
        if "answer" not in request.data:
            return Response(
                {"code": "blank", "detail": "Choose or type an answer first."},
                status=http.HTTP_400_BAD_REQUEST,
            )
        try:
            assignment = daily.answer(request.user, assignment_id, request.data.get("answer"))
        except daily.AnswerRefused as refused:
            return Response(
                {"code": refused.code, "detail": refused.message},
                status=_REFUSAL_STATUS.get(refused.code, http.HTTP_400_BAD_REQUEST),
            )
        context = {"request": request, "earned": earned_by_assignment([assignment])}
        return Response(DailyQuestionSerializer(assignment, context=context).data)
