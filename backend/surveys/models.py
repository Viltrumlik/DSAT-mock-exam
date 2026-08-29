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
    # A picture for the whole form — a poster for the thing being asked about. Plain
    # ImageField + multipart, the shop/stories pattern, NOT the presigned R2 path: that one
    # exists for lesson videos measured in gigabytes, and a survey banner is a photo.
    image = models.ImageField(upload_to="survey_images/", null=True, blank=True)
    #: Whether a respondent may hide their name from the results.
    #:
    #: Opt-in per survey, and then the STUDENT chooses — "with my name" or "anonymously".
    #: Two different questions get asked in a school and they want different answers: a
    #: lesson-preference poll is fine signed, and "how is your teacher doing" is not.
    #:
    #: **This hides the name from the results; it does not unlink the row.** ``student``
    #: stays populated, because ``unique(survey, student)`` is the entire one-response rule
    #: and the 40-point award hangs off that row. What ``is_anonymous`` buys is that no
    #: reading surface — the replies list, the export — will ever print who said it. Saying
    #: more than that to a student would be a promise the schema does not keep.
    allow_anonymous = models.BooleanField(default=False)
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
    TYPE_RATING = "RATING"
    TYPE_DATE = "DATE"
    TYPE_CHOICES = [
        (TYPE_SHORT_TEXT, "Short answer"),
        (TYPE_LONG_TEXT, "Paragraph"),
        (TYPE_SINGLE_CHOICE, "Multiple choice"),
        (TYPE_MULTI_CHOICE, "Checkboxes"),
        (TYPE_SCALE, "Linear scale"),
        (TYPE_RATING, "Recommendation slider"),
        (TYPE_DATE, "Date"),
    ]
    #: Types whose answer is chosen from ``options``.
    CHOICE_TYPES = (TYPE_SINGLE_CHOICE, TYPE_MULTI_CHOICE)
    #: Types whose answer is a number inside ``scale_min``..``scale_max``.
    #:
    #: ``RATING`` is a second numeric type rather than a flag on ``SCALE`` because the two
    #: are different controls, not different settings: SCALE is a short row of tappable
    #: numbers (1–5 by default) and RATING is a dragged slider with a written sentence at
    #: each end (0–10 by default). Eleven 40px buttons in a row is what SCALE would have to
    #: become, and it wraps into an unreadable grid on a phone.
    NUMERIC_TYPES = (TYPE_SCALE, TYPE_RATING)

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="questions")
    order = models.PositiveIntegerField(default=0, db_index=True)
    prompt = models.CharField(max_length=500)
    help_text = models.CharField(max_length=300, blank=True)
    question_type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    is_required = models.BooleanField(default=False)
    # A picture for one question — the thing being asked about, shown above the control.
    image = models.ImageField(upload_to="survey_images/", null=True, blank=True)
    # For choice types: ["Yes", "No", …]. A plain list of strings rather than {id,text}
    # objects — a survey answer is the text the respondent picked, and an id layer would only
    # create a way for the stored answer and the displayed option to drift apart.
    options = models.JSONField(default=list, blank=True)
    #: Which of ``options`` open the follow-up box when picked, e.g. ["I have a suggestion"].
    #:
    #: A parallel list of option TEXT, not a rewrite of ``options`` into objects. The stored
    #: answer IS the option text (see ``services.normalize_answer``), so turning options into
    #: {id, text} would invalidate every response already recorded — and the note above
    #: argues against the id layer on its own merits. A stale entry here (an option since
    #: renamed) simply never matches, which is the harmless failure.
    follow_up_options = models.JSONField(default=list, blank=True)
    scale_min = models.PositiveSmallIntegerField(default=1)
    scale_max = models.PositiveSmallIntegerField(default=5)
    #: The sentences written under each end of a RATING slider. Editable, because the
    #: school asks about more than recommending: "Not at all confident"/"Completely
    #: confident" is the same control asking a different question.
    scale_low_label = models.CharField(max_length=80, blank=True, default="")
    scale_high_label = models.CharField(max_length=80, blank=True, default="")
    #: The score at or above which the author considers the answer satisfactory.
    #:
    #: NULL means "never ask a follow-up". Set to 8 on a 0–10 slider and any score of 7 or
    #: less opens the follow-up box. Strictly below, not at: a threshold of 8 means 8 is
    #: fine, which is what an author setting "satisfactory = 8" means by it.
    follow_up_threshold = models.PositiveSmallIntegerField(null=True, blank=True)
    #: What the empty follow-up box says before the student types — a real HTML placeholder,
    #: so it clears itself the moment they start writing.
    follow_up_placeholder = models.CharField(max_length=200, blank=True, default="")
    #: Whether the revealed follow-up must be filled in. Off by default: the school asked for
    #: the box to be offered, not demanded, and a required box turns a low score into a
    #: wall the student can only get past by raising the score.
    follow_up_required = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "survey_questions"
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["survey", "order"])]

    def __str__(self) -> str:
        return f"{self.survey_id} #{self.order} {self.question_type}"

    # ── follow-up rules ───────────────────────────────────────────────────
    #
    # One question, one place. Both the submit path and the results reader ask "should this
    # answer have carried a comment?", and a second copy of the rule is how a survey ends up
    # refusing text the form offered.

    def wants_follow_up_for_score(self, score) -> bool:
        """Does a numeric answer of ``score`` open the follow-up box?"""
        if self.follow_up_threshold is None or score is None:
            return False
        return int(score) < int(self.follow_up_threshold)

    def wants_follow_up_for_choice(self, picked) -> bool:
        """Does this choice — or any of these choices — open the follow-up box?"""
        triggers = {str(o) for o in (self.follow_up_options or [])}
        if not triggers:
            return False
        if isinstance(picked, (list, tuple)):
            return any(str(p) in triggers for p in picked)
        return str(picked) in triggers

    def wants_follow_up(self, value) -> bool:
        """Whether ``value`` — already normalised — opens the follow-up box."""
        if self.question_type in self.NUMERIC_TYPES:
            return self.wants_follow_up_for_score(value)
        if self.question_type in self.CHOICE_TYPES:
            return self.wants_follow_up_for_choice(value)
        return False


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
    #: The respondent asked for their name to be kept off the results.
    #:
    #: Only ever true on a survey whose ``allow_anonymous`` is on — enforced in
    #: ``services.submit_response`` rather than trusted from the client, because a request
    #: body is not a permission. See ``Survey.allow_anonymous`` for what this does and does
    #: not promise: the row still knows who wrote it, and no reading surface prints it.
    is_anonymous = models.BooleanField(default=False)
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
    """One answer. ``value`` is JSON because the question types answer in three shapes:
    a string, a list of strings (checkboxes), or a number (scale/slider)."""

    response = models.ForeignKey(
        SurveyResponse, on_delete=models.CASCADE, related_name="answers"
    )
    question = models.ForeignKey(
        SurveyQuestion, on_delete=models.CASCADE, related_name="answers"
    )
    value = models.JSONField(default=None, null=True, blank=True)
    #: What the student wrote in the follow-up box, when the question opened one.
    #:
    #: Its own column rather than a composite ``{"score": 6, "comment": "…"}`` inside
    #: ``value``. ``uniq_survey_answer_per_question`` rules out a second row, so it had to
    #: live on this one — and widening ``value`` would change the shape every already-stored
    #: answer is read back in, and would make the results reader print "[object Object]"
    #: for every scale question written before today. A column changes nothing that exists.
    follow_up = models.TextField(blank=True, default="")
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
