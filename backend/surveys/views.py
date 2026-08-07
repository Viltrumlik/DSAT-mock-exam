"""Survey API.

Student:
  GET  /api/surveys/open/            surveys I may still answer
  GET  /api/surveys/<id>/            the form (published + in-window only)
  POST /api/surveys/<id>/respond/    { answers: { "<question_id>": value, … } }
Authoring (super_admin ONLY):
  GET/POST         /api/surveys/admin/
  GET/PATCH/DELETE /api/surveys/admin/<id>/
  POST/PATCH/DELETE /api/surveys/admin/<id>/questions/[<qid>/]
  GET              /api/surveys/admin/<id>/responses/

Authoring is restricted to super_admin by the school's explicit instruction. It is enforced
here, on every authoring endpoint, and not merely by hiding the ops page: the codebase has no
per-nav-item role gating, so the page gate alone would be decoration.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as acc_const
from access.services import normalized_role

from . import services
from .models import Survey, SurveyQuestion, SurveyResponse
from .serializers import (
    SurveyBriefSerializer,
    SurveyQuestionSerializer,
    SurveyResponseSerializer,
    SurveySerializer,
)


def _is_super_admin(user) -> bool:
    return bool(getattr(user, "is_superuser", False)) or (
        normalized_role(user) == acc_const.ROLE_SUPER_ADMIN
    )


class _AuthoringView(APIView):
    """Base for every authoring endpoint. super_admin only, checked on each request."""

    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        if _is_super_admin(request.user):
            return None
        return Response(
            {"detail": "Only a super admin can manage surveys."}, status=http.HTTP_403_FORBIDDEN
        )


# ── Student ───────────────────────────────────────────────────────────────────

class OpenSurveysView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        surveys = services.open_surveys_for(request.user)
        return Response({"surveys": SurveyBriefSerializer(surveys, many=True).data})


class SurveyDetailView(APIView):
    """The form itself. A draft is invisible even by direct id — otherwise its author could
    hand the link around and mint points from an unpublished survey."""

    permission_classes = [IsAuthenticated]

    def get(self, request, survey_id):
        survey = get_object_or_404(Survey, pk=survey_id)
        if not survey.is_open() and not _is_super_admin(request.user):
            return Response({"detail": "That survey is not open."}, status=http.HTTP_404_NOT_FOUND)
        already = SurveyResponse.objects.filter(
            survey=survey, student=request.user, status=SurveyResponse.STATUS_SUBMITTED
        ).exists()
        data = SurveySerializer(survey).data
        data["already_completed"] = already
        return Response(data)


class SurveyRespondView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, survey_id):
        survey = get_object_or_404(Survey, pk=survey_id)
        answers = request.data.get("answers")
        if not isinstance(answers, dict):
            return Response({"detail": "answers must be an object keyed by question id."}, status=400)
        try:
            response = services.submit_response(survey, request.user, answers)
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        return Response(
            {"detail": "Thanks — your answers are recorded.", "response_id": response.id},
            status=http.HTTP_201_CREATED,
        )


# ── Authoring (super_admin) ───────────────────────────────────────────────────

class SurveyAdminListView(_AuthoringView):
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        return Response({"surveys": SurveySerializer(Survey.objects.all(), many=True).data})

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = SurveySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        survey = serializer.save(created_by=request.user)
        return Response(SurveySerializer(survey).data, status=http.HTTP_201_CREATED)


class SurveyAdminDetailView(_AuthoringView):
    def get(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        return Response(SurveySerializer(get_object_or_404(Survey, pk=survey_id)).data)

    def patch(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        # Publishing an empty form would show students a survey with nothing to answer and no
        # way to earn from it.
        wants_publish = str(request.data.get("status") or "") == Survey.STATUS_PUBLISHED
        if wants_publish and not survey.questions.exists():
            return Response(
                {"detail": "Add at least one question before publishing."}, status=400
            )
        serializer = SurveySerializer(survey, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(SurveySerializer(serializer.save()).data)

    def delete(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        if survey.responses.filter(status=SurveyResponse.STATUS_SUBMITTED).exists():
            # Deleting would cascade the responses away, and with them the evidence behind
            # every 40-point award the survey paid.
            return Response(
                {"detail": "That survey has responses. Close it instead of deleting it."},
                status=400,
            )
        survey.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


class SurveyQuestionsView(_AuthoringView):
    def post(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        serializer = SurveyQuestionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = request.data.get("order")
        if order in (None, ""):
            last = survey.questions.order_by("-order").first()
            order = (last.order + 1) if last else 0
        question = serializer.save(survey=survey, order=int(order))
        return Response(SurveyQuestionSerializer(question).data, status=http.HTTP_201_CREATED)


class SurveyQuestionDetailView(_AuthoringView):
    def patch(self, request, survey_id, question_id):
        denied = self._guard(request)
        if denied:
            return denied
        question = get_object_or_404(SurveyQuestion, pk=question_id, survey_id=survey_id)
        serializer = SurveyQuestionSerializer(question, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(SurveyQuestionSerializer(serializer.save()).data)

    def delete(self, request, survey_id, question_id):
        denied = self._guard(request)
        if denied:
            return denied
        question = get_object_or_404(SurveyQuestion, pk=question_id, survey_id=survey_id)
        question.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


class SurveyResponsesView(_AuthoringView):
    def get(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        responses = (
            survey.responses.filter(status=SurveyResponse.STATUS_SUBMITTED)
            .select_related("student")
            .prefetch_related("answers__question")
        )
        return Response({
            "survey": SurveyBriefSerializer(survey).data,
            "responses": SurveyResponseSerializer(responses, many=True).data,
        })
