"""Surveys — a small Google-Forms-shaped form engine.

Its own app rather than a corner of ``classes``: a survey belongs to the school, not to a
classroom. It is sent to everyone, it has no teacher, and its results are read by
administration.

**Not built on the assessment stack**, though that is the closest-looking thing in the repo.
An ``AssessmentQuestion`` requires a `correct_answer`, carries `points`, and runs through a
grading path; a survey question has no right answer, and forcing one through that model would
mean a permanently-null correct answer and a grading service that must be taught to skip
itself. The two only look alike from a distance.

The whole earning rule is one line of schema: ``unique(survey, student)`` on the response.
A student can answer a survey once, so a survey can pay once.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class Survey(models.Model):
    STATUS_DRAFT = "DRAFT"
    STATUS_PUBLISHED = "PUBLISHED"
    STATUS_CLOSED = "CLOSED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_CLOSED, "Closed"),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    # Optional window. Null means "as soon as published" / "until closed by hand".
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="surveys_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "surveys"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return self.title

    def is_open(self, *, now=None) -> bool:
        """Whether a student may answer it right now.

        Points are earnable only from an open survey, which is why the window is checked here
        rather than left to the view: a draft previewed by its author must not mint 40 points.
        """
        from django.utils import timezone

        now = now or timezone.now()
        if self.status != self.STATUS_PUBLISHED:
            return False
        if self.opens_at and now < self.opens_at:
            return False
        if self.closes_at and now > self.closes_at:
            return False
        return True


class SurveyQuestion(models.Model):
    TYPE_SHORT_TEXT = "SHORT_TEXT"
    TYPE_LONG_TEXT = "LONG_TEXT"
    TYPE_SINGLE_CHOICE = "SINGLE_CHOICE"
    TYPE_MULTI_CHOICE = "MULTI_CHOICE"
    TYPE_SCALE = "SCALE"
    TYPE_DATE = "DATE"
    TYPE_CHOICES = [
        (TYPE_SHORT_TEXT, "Short answer"),
        (TYPE_LONG_TEXT, "Paragraph"),
        (TYPE_SINGLE_CHOICE, "Multiple choice"),
        (TYPE_MULTI_CHOICE, "Checkboxes"),
        (TYPE_SCALE, "Linear scale"),
        (TYPE_DATE, "Date"),
    ]
    #: Types whose answer is chosen from ``options``.
    CHOICE_TYPES = (TYPE_SINGLE_CHOICE, TYPE_MULTI_CHOICE)

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="questions")
    order = models.PositiveIntegerField(default=0, db_index=True)
    prompt = models.CharField(max_length=500)
    help_text = models.CharField(max_length=300, blank=True)
    question_type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    is_required = models.BooleanField(default=False)
    # For choice types: ["Yes", "No", …]. A plain list of strings rather than {id,text}
    # objects — a survey answer is the text the respondent picked, and an id layer would only
    # create a way for the stored answer and the displayed option to drift apart.
    options = models.JSONField(default=list, blank=True)
    scale_min = models.PositiveSmallIntegerField(default=1)
    scale_max = models.PositiveSmallIntegerField(default=5)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "survey_questions"
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["survey", "order"])]

    def __str__(self) -> str:
        return f"{self.survey_id} #{self.order} {self.question_type}"


class SurveyResponse(models.Model):
    """One student's answers to one survey.

    ``unique(survey, student)`` is the entire anti-farming story: a survey is worth 40 points
    and there is exactly one row per student per survey to hang that award on.
    """

    STATUS_IN_PROGRESS = "IN_PROGRESS"
    STATUS_SUBMITTED = "SUBMITTED"
    STATUS_CHOICES = [
        (STATUS_IN_PROGRESS, "In progress"),
        (STATUS_SUBMITTED, "Submitted"),
    ]

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="responses")
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="survey_responses"
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_IN_PROGRESS, db_index=True
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "survey_responses"
        ordering = ["-submitted_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "student"], name="uniq_survey_response_per_student"
            )
        ]
        indexes = [models.Index(fields=["survey", "status"])]

    def __str__(self) -> str:
        return f"{self.student_id} → survey {self.survey_id} ({self.status})"


class SurveyAnswer(models.Model):
    """One answer. ``value`` is JSON because the six question types answer in three shapes:
    a string, a list of strings (checkboxes), or a number (scale)."""

    response = models.ForeignKey(
        SurveyResponse, on_delete=models.CASCADE, related_name="answers"
    )
    question = models.ForeignKey(
        SurveyQuestion, on_delete=models.CASCADE, related_name="answers"
    )
    value = models.JSONField(default=None, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "survey_answers"
        constraints = [
            models.UniqueConstraint(
                fields=["response", "question"], name="uniq_survey_answer_per_question"
            )
        ]

    def __str__(self) -> str:
        return f"r{self.response_id} q{self.question_id}"
