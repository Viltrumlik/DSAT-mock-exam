"""Survey answering rules.

Validation lives here rather than in a serializer because the shape of a valid answer depends
on the question's type, and the same rules are needed by both the submit endpoint and any
future import path.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse


def normalize_answer(question: SurveyQuestion, raw):
    """Coerce and validate one answer, or raise ``ValidationError``.

    Returns the value to store. An unanswered optional question stores ``None`` rather than an
    empty string, so "skipped" and "answered with nothing" stay distinguishable in the results.
    """
    qt = question.question_type
    blank = raw is None or (isinstance(raw, str) and not raw.strip()) or (
        isinstance(raw, list) and not raw
    )

    if blank:
        if question.is_required:
            raise ValidationError(f"“{question.prompt}” is required.")
        return None

    if qt in (SurveyQuestion.TYPE_SHORT_TEXT, SurveyQuestion.TYPE_LONG_TEXT):
        return str(raw).strip()

    if qt == SurveyQuestion.TYPE_DATE:
        from django.utils.dateparse import parse_date

        if parse_date(str(raw)) is None:
            raise ValidationError(f"“{question.prompt}” needs a date (YYYY-MM-DD).")
        return str(raw)

    if qt == SurveyQuestion.TYPE_SCALE:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            raise ValidationError(f"“{question.prompt}” needs a number.")
        if not (question.scale_min <= value <= question.scale_max):
            raise ValidationError(
                f"“{question.prompt}” must be between {question.scale_min} and {question.scale_max}."
            )
        return value

    options = list(question.options or [])
    if qt == SurveyQuestion.TYPE_SINGLE_CHOICE:
        if str(raw) not in options:
            raise ValidationError(f"“{question.prompt}” has no such option.")
        return str(raw)

    if qt == SurveyQuestion.TYPE_MULTI_CHOICE:
        picked = [str(x) for x in (raw if isinstance(raw, list) else [raw])]
        unknown = [x for x in picked if x not in options]
        if unknown:
            raise ValidationError(f"“{question.prompt}” has no option {unknown[0]!r}.")
        # Deduplicated but order-preserving: a client that sends the same box twice is a bug,
        # not a reason to reject the whole submission.
        return list(dict.fromkeys(picked))

    raise ValidationError(f"Unsupported question type {qt!r}.")


@transaction.atomic
def submit_response(survey: Survey, student, answers: dict) -> SurveyResponse:
    """Record a student's completed survey. ``answers`` is ``{question_id: value}``.

    Submitting is one shot, matching the single-response rule: there is no draft-then-submit
    dance, and a second attempt is refused rather than silently overwriting the first — the
    40 points are already banked against that response.
    """
    if not survey.is_open():
        raise ValidationError("That survey is not open.")

    existing = SurveyResponse.objects.select_for_update().filter(
        survey=survey, student=student
    ).first()
    if existing is not None and existing.status == SurveyResponse.STATUS_SUBMITTED:
        raise ValidationError("You have already completed that survey.")

    questions = list(survey.questions.all())
    if not questions:
        raise ValidationError("That survey has no questions yet.")

    # Validate EVERYTHING before writing anything: a half-saved response would leave the
    # student looking at a form they cannot resubmit.
    normalized: list[tuple[SurveyQuestion, object]] = []
    for question in questions:
        normalized.append((question, normalize_answer(question, answers.get(str(question.id), answers.get(question.id)))))

    response = existing or SurveyResponse(survey=survey, student=student)
    response.status = SurveyResponse.STATUS_SUBMITTED
    response.submitted_at = timezone.now()
    response.save()

    for question, value in normalized:
        SurveyAnswer.objects.update_or_create(
            response=response, question=question, defaults={"value": value}
        )
    return response


def open_surveys_for(student):
    """Published, in-window surveys the student has not already completed."""
    now = timezone.now()
    done = SurveyResponse.objects.filter(
        student=student, status=SurveyResponse.STATUS_SUBMITTED
    ).values_list("survey_id", flat=True)
    return (
        Survey.objects.filter(status=Survey.STATUS_PUBLISHED)
        .exclude(id__in=done)
        .exclude(opens_at__gt=now)
        .exclude(closes_at__lt=now)
        .order_by("-created_at", "-id")
    )
