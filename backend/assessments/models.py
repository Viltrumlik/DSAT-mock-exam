from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class AssessmentSet(models.Model):
    SUBJECT_MATH = "math"
    SUBJECT_ENGLISH = "english"
    SUBJECT_CHOICES = [
        (SUBJECT_MATH, "Math"),
        (SUBJECT_ENGLISH, "English"),
    ]

    # Provenance of the questions in this set. English and Math share SQB + External
    # but otherwise draw from different question banks; see ALLOWED_SOURCES_BY_SUBJECT.
    SOURCE_SQB = "SQB"
    SOURCE_SATOPLAM = "SATOPLAM"
    SOURCE_MATHBOOK = "MATHBOOK"
    SOURCE_PREP_PROS = "PREP_PROS"
    SOURCE_HARD_QUESTIONS = "HARD_QUESTIONS"
    SOURCE_EXTERNAL = "EXTERNAL"
    SOURCE_CHOICES = [
        (SOURCE_SQB, "SQB"),
        (SOURCE_SATOPLAM, "SAToplam"),
        (SOURCE_MATHBOOK, "Mathbook"),
        (SOURCE_PREP_PROS, "Prep Pros"),
        (SOURCE_HARD_QUESTIONS, "Hard questions"),
        (SOURCE_EXTERNAL, "External source"),
    ]
    # Foundation Math homework topics (2026-10-28, the folders of the school's
    # "Foundation_Homework_Answers" pack). Math-only, and only for a set that is for the
    # Foundation cohort (primary or second level) — see ``source_problem``.
    FOUNDATION_SOURCE_CHOICES = [
        ("FOUNDATION_S01", "S01 Positive and Negative Numbers"),
        ("FOUNDATION_S02", "S02 Order of Operations and the Number Line"),
        ("FOUNDATION_S03", "S03 Common Fractions"),
        ("FOUNDATION_S04", "S04 Decimals"),
        ("FOUNDATION_S06", "S06 Ratio and Proportion"),
        ("FOUNDATION_S07", "S07 Percent"),
        ("FOUNDATION_S08", "S08 Linear Equations in One Variable"),
        ("FOUNDATION_S09", "S09 Equations with Absolute Value"),
        ("FOUNDATION_S13", "S13 Powers and Their Properties"),
        ("FOUNDATION_S14", "S14 Monomials Sum and Difference of Polynomials"),
        ("FOUNDATION_S15", "S15 Multiplying Monomials and Polynomials"),
        ("FOUNDATION_S16", "S16 Special Products"),
        ("FOUNDATION_S18", "S18 The Coordinate Plane and Distance"),
        ("FOUNDATION_S19", "S19 Triangles"),
        ("FOUNDATION_S20", "S20 Squares and Rectangles"),
        ("FOUNDATION_S21", "S21 Circles"),
    ]
    FOUNDATION_SOURCES = tuple(code for code, _ in FOUNDATION_SOURCE_CHOICES)
    SOURCE_CHOICES = SOURCE_CHOICES + FOUNDATION_SOURCE_CHOICES
    ALLOWED_SOURCES_BY_SUBJECT = {
        SUBJECT_ENGLISH: (SOURCE_SQB, SOURCE_SATOPLAM, SOURCE_EXTERNAL),
        SUBJECT_MATH: (
            SOURCE_SQB,
            SOURCE_MATHBOOK,
            SOURCE_PREP_PROS,
            SOURCE_HARD_QUESTIONS,
            SOURCE_EXTERNAL,
            *FOUNDATION_SOURCES,
        ),
    }

    # Difficulty tier. Subject-dependent: English has no Foundation. The codes are
    # lowercase and shared verbatim with classes.Classroom.level so a classroom's
    # level can be compared/filtered directly against a set's level.
    LEVEL_FOUNDATION = "foundation"
    LEVEL_JUNIOR = "junior"
    LEVEL_MIDDLE = "middle"
    LEVEL_SENIOR = "senior"
    LEVEL_CHOICES = [
        (LEVEL_FOUNDATION, "Foundation"),
        (LEVEL_JUNIOR, "Junior"),
        (LEVEL_MIDDLE, "Middle"),
        (LEVEL_SENIOR, "Senior"),
    ]
    ALLOWED_LEVELS_BY_SUBJECT = {
        SUBJECT_ENGLISH: (LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
        SUBJECT_MATH: (LEVEL_FOUNDATION, LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
    }

    # Authored-content review lifecycle — ORTHOGONAL to is_active (visibility/archive).
    #   draft        = "incomplete", still being built (tugallanmagan)
    #   needs_review = "unchecked", submitted for a reviewer to check (tekshirilmagan)
    #   approved     = reviewed & approved (aproved) — only this state is safe to assign.
    # Only admin/super_admin move a set to `approved` (see access.services.can_approve_assessment);
    # the transition also publishes an immutable version. Mutated only through the dedicated
    # status endpoint (AdminAssessmentSetStatusView) so every change is audited; editing an
    # approved set resets it to needs_review.
    STATUS_DRAFT = "draft"
    STATUS_NEEDS_REVIEW = "needs_review"
    STATUS_APPROVED = "approved"
    REVIEW_STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_NEEDS_REVIEW, "Needs review"),
        (STATUS_APPROVED, "Approved"),
    ]

    subject = models.CharField(max_length=16, choices=SUBJECT_CHOICES, db_index=True)
    # Blank = legacy/None; new sets require a source valid for their subject (enforced
    # in the admin write serializer). Editable later from set metadata.
    source = models.CharField(
        max_length=32, choices=SOURCE_CHOICES, blank=True, default="", db_index=True
    )
    # Blank = legacy/untagged (shows in every classroom regardless of level). New sets
    # pick a level valid for their subject; enforced in the admin write serializer.
    level = models.CharField(
        max_length=16, choices=LEVEL_CHOICES, blank=True, default="", db_index=True
    )
    # OPTIONAL second level (2026-10-11, the school's request): one set can be shown to
    # two cohorts at once — e.g. a Junior set that also suits Middle. Blank = the set
    # belongs to its primary ``level`` only (every set before this date). It never stands
    # alone: a secondary needs a primary, must fit the subject (English has no Foundation)
    # and must differ from the primary. The rules live in ONE place,
    # ``secondary_level_problem``, which both the API write serializer and ``clean()`` call.
    # ``clean()`` covers the Django admin change form, which never goes through the
    # serializer. Below both, the CHECK constraint in Meta refuses the two structural
    # breaks (no primary; same as the primary) from ANY writer: shell scripts,
    # ``.update()``, a future import. Such a row is not harmless. The builder's metadata
    # save re-sends both levels, so every later save of that set, even a title-only
    # edit, would be a 400 on ``secondary_level`` that the editor cannot clear (its
    # second-level select is disabled with no primary, and never lists the primary).
    #
    # Every level filter on sets must accept EITHER level — use ``level_q`` rather than
    # ``filter(level=...)``, or the set silently vanishes from its second cohort.
    #
    # Deliberately NO db_index: on Postgres an indexed CharField also gets a ``_like``
    # varchar_pattern_ops index, and that pair is the double-create trap a migration hit
    # before. The filters this column serves always also hit the indexed ``level`` /
    # ``subject`` / ``is_active`` columns, and the table is small.
    #
    # ``db_default=""`` is DEPLOY SAFETY, not style: a plain ``default`` lives only in
    # Python, and Django's AddField drops the column's DB default again right after
    # back-filling. Our zero-downtime deploys run the migration while the OLD code is
    # still serving, and old code INSERTs sets without naming this column — without a
    # DB-side default that is NULL into a NOT NULL column, and creating a set fails until
    # the new code is live. ``db_default`` keeps ``DEFAULT ''`` on the column for good.
    secondary_level = models.CharField(
        max_length=16, choices=LEVEL_CHOICES, blank=True, default="", db_default=""
    )
    category = models.CharField(max_length=255, db_index=True, blank=True, default="")
    title = models.CharField(max_length=200, db_index=True)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    review_status = models.CharField(
        max_length=24,
        choices=REVIEW_STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assessment_sets_created",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "assessment_sets"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["subject", "category", "is_active"]),
        ]
        constraints = [
            # The second level never stands alone and never repeats the primary
            # (2026-10-11, the school's request). Only the subject-INDEPENDENT rules
            # live here. "Fits the subject" depends on ALLOWED_LEVELS_BY_SUBJECT, a Python
            # table that would drift from a copy frozen into SQL, so that rule is checked
            # by ``secondary_level_problem`` alone. Every row before this date has
            # ``secondary_level = ''``, so adding the constraint fails no existing row.
            models.CheckConstraint(
                condition=models.Q(secondary_level="")
                | (~models.Q(level="") & ~models.Q(secondary_level=models.F("level"))),
                name="assessment_sets_secondary_level_valid",
                violation_error_message=(
                    "A second level needs a primary level, and must differ from it."
                ),
            ),
        ]

    def __str__(self) -> str:
        return f"{self.subject}:{self.title}"

    @classmethod
    def secondary_level_problem(
        cls, subject: str | None, level: str | None, secondary: str | None
    ) -> str | None:
        """Why this second level is not allowed on a set, or None when it is.

        This is the ONE statement of the second-level rules (2026-10-11, the school's
        request). ``AssessmentSetAdminWriteSerializer.validate`` (the API: create, the
        builder's PATCH, CSV create) and ``clean()`` (the Django admin change form) both
        call it with the EFFECTIVE values, so the two paths cannot drift apart.

        The values are effective, not just the ones a request sent. Take a stored Junior
        + Middle set whose primary is moved to Middle, or cleared. The stored second
        level is then out of line, and that is refused rather than silently dropped. The
        set is still shown to that cohort, so the author should see it.
        """
        if not secondary:
            return None
        if not level:
            return (
                "A second level needs a primary level. Choose the primary "
                "level first, or clear the second level."
            )
        if secondary not in cls.allowed_levels_for_subject(subject or ""):
            # English has no Foundation; a subject change can also strand a stored one.
            return f"'{secondary}' is not a valid level for {subject} sets."
        if secondary == level:
            return "The second level must differ from the primary level."
        return None

    def clean(self) -> None:
        # The Django admin's change form is a plain ModelForm: it never sees the API
        # serializer, only ``full_clean()`` → here. Without this, staff could save there
        # exactly the pair the API refuses. The error is keyed on the field, so the admin
        # shows it beside the second-level select. Nothing else in the codebase calls
        # ``full_clean()`` on a set.
        super().clean()
        problem = self.secondary_level_problem(
            self.subject, self.level or "", self.secondary_level or ""
        )
        if problem:
            raise ValidationError({"secondary_level": problem})
        # Same reason for the source: a Foundation homework topic needs a Foundation level.
        problem = self.source_problem(
            self.subject, self.source or "", self.level or "", self.secondary_level or ""
        )
        if problem:
            raise ValidationError({"source": problem})

    @classmethod
    def allowed_sources_for_subject(cls, subject: str) -> tuple[str, ...]:
        """Source keys valid for the given subject (empty for unknown subjects)."""
        return cls.ALLOWED_SOURCES_BY_SUBJECT.get(subject, ())

    @classmethod
    def source_problem(cls, subject: str, source: str, level: str, secondary: str) -> str:
        """Why ``source`` doesn't fit this set ("" when it does). Blank source is fine."""
        if not source:
            return ""
        if source not in cls.allowed_sources_for_subject(subject):
            return f"'{source}' is not a valid source for {subject} sets."
        if source in cls.FOUNDATION_SOURCES and cls.LEVEL_FOUNDATION not in (level, secondary):
            return "Foundation homework sources are only for Foundation-level sets."
        return ""

    @classmethod
    def allowed_levels_for_subject(cls, subject: str) -> tuple[str, ...]:
        """Level keys valid for the given subject (empty for unknown subjects)."""
        return cls.ALLOWED_LEVELS_BY_SUBJECT.get(subject, ())

    @property
    def levels(self) -> tuple[str, ...]:
        """The cohorts this set is for: primary first, then the optional secondary.

        Empty for a legacy/untagged set (blank ``level``) — which, by the long-standing
        rule, shows in every UNTAGGED classroom and is hidden from a leveled one.
        """
        return tuple(lv for lv in (self.level, self.secondary_level) if lv)

    @classmethod
    def level_q(cls, level: str) -> models.Q:
        """Queryset filter: sets visible to cohort ``level`` — primary OR secondary.

        The one way to level-scope a set queryset (classroom picker, journal picker,
        journal write guard). ``filter(level=...)`` alone drops every set whose SECOND
        level is the one being asked for.
        """
        return models.Q(level=level) | models.Q(secondary_level=level)

    def effective_level_for(self, cohort_level: str | None) -> str:
        """The level a given cohort sits this set AT.

        A Middle classroom doing a Junior+Middle set sits it as Middle, so it gets what
        Middle gets (Desmos — the runners decide the calculator from this). A cohort that
        is not one of the set's levels (untagged classroom, or a set re-tagged after it
        was assigned) falls back to the primary level — exactly what the runner got
        before a second level existed.
        """
        if cohort_level and cohort_level in self.levels:
            return cohort_level
        return self.level or ""


class AssessmentQuestion(models.Model):
    TYPE_MULTIPLE_CHOICE = "multiple_choice"
    TYPE_SHORT_TEXT = "short_text"
    TYPE_NUMERIC = "numeric"
    TYPE_BOOLEAN = "boolean"
    TYPE_CHOICES = [
        (TYPE_MULTIPLE_CHOICE, "Multiple choice"),
        (TYPE_SHORT_TEXT, "Short text"),
        (TYPE_NUMERIC, "Numeric"),
        (TYPE_BOOLEAN, "True/False"),
    ]

    assessment_set = models.ForeignKey(
        AssessmentSet,
        on_delete=models.CASCADE,
        related_name="questions",
    )
    order = models.PositiveIntegerField(default=0, db_index=True)
    prompt = models.TextField()
    question_prompt = models.TextField(blank=True, default="")  # Stimulus / passage excerpt
    question_type = models.CharField(max_length=32, choices=TYPE_CHOICES, db_index=True)

    # For multiple choice: [{ "id": "A", "text": "..." }, ...]
    choices = models.JSONField(blank=True, default=list)

    # Correct answer can be a string/number/bool, or list of acceptable strings.
    correct_answer = models.JSONField(blank=True, default=None, null=True)
    grading_config = models.JSONField(blank=True, default=dict)  # e.g. tolerance for numeric

    points = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True, db_index=True)
    # Optional image for the question stem
    question_image = models.ImageField(upload_to="assessment_questions/", blank=True, null=True)
    # Optional images for answer choices (A–D, fixed like pastpaper)
    option_a_image = models.ImageField(upload_to="assessment_questions/", blank=True, null=True)
    option_b_image = models.ImageField(upload_to="assessment_questions/", blank=True, null=True)
    option_c_image = models.ImageField(upload_to="assessment_questions/", blank=True, null=True)
    option_d_image = models.ImageField(upload_to="assessment_questions/", blank=True, null=True)
    # Solution explanation shown to students after grading
    explanation = models.TextField(blank=True, default="")

    # Question Bank link (additive/nullable). Records which bank question this row
    # was sourced from; a later bank edit propagates back onto this row (live single
    # source of truth). NULL = not linked to the bank.
    bank_question = models.ForeignKey(
        "questionbank.BankQuestion", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="assessment_questions", db_index=True,
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "assessment_questions"
        ordering = ["assessment_set_id", "order", "id"]
        constraints = [
            # Dense, unique 0..n-1 ordering per set (mirrors exams' UNIQUE(module,
            # order)). Enforced by domain/question_ordering.py, which assigns order
            # under a set row-lock via a two-phase temp band. Prevents the duplicate
            # `order` values that scrambled question delivery in the Boundaries sets.
            models.UniqueConstraint(
                fields=["assessment_set", "order"],
                name="uniq_assessment_question_order_per_set",
            ),
        ]


class HomeworkAssignment(models.Model):
    """
    Teacher assigns an AssessmentSet as homework.

    Integrates with existing class homework feed via a linked `classes.Assignment` row.

    Content is served LIVE from the set's AssessmentQuestion rows at attempt time;
    an in-progress attempt pins WHICH questions via its ``question_order`` list.
    """

    classroom = models.ForeignKey(
        "classes.Classroom",
        on_delete=models.CASCADE,
        related_name="assessment_homework",
    )
    assessment_set = models.ForeignKey(
        AssessmentSet,
        on_delete=models.PROTECT,
        related_name="homework_assignments",
    )
    # A homework (Assignment) can bundle MANY assessments, so this is a FK, not
    # a OneToOne. Reverse accessor: ``assignment.assessment_homeworks`` (queryset).
    assignment = models.ForeignKey(
        "classes.Assignment",
        on_delete=models.CASCADE,
        related_name="assessment_homeworks",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assessment_homework_assigned",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "assessment_homework_assignments"
        ordering = ["-created_at", "-id"]
        constraints = [
            # NOTE: the former uniq_assessment_hw_class_assignment (one homework per
            # assignment) was dropped so an assignment can carry multiple assessments.
            # One assessment set is still assigned at most once per classroom.
            models.UniqueConstraint(
                fields=["classroom", "assessment_set"],
                name="uniq_assessment_hw_classroom_set",
            ),
        ]


class AssessmentHomeworkAuditEvent(models.Model):
    EVENT_ASSIGNED = "assigned"

    EVENT_CHOICES = [
        (EVENT_ASSIGNED, "Assigned"),
    ]

    classroom = models.ForeignKey(
        "classes.Classroom",
        on_delete=models.CASCADE,
        related_name="assessment_homework_audit_events",
    )
    assessment_set = models.ForeignKey(
        AssessmentSet,
        on_delete=models.PROTECT,
        related_name="homework_audit_events",
    )
    homework = models.ForeignKey(
        HomeworkAssignment,
        on_delete=models.CASCADE,
        related_name="audit_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assessment_homework_audit_events",
    )
    event_type = models.CharField(max_length=40, choices=EVENT_CHOICES, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "assessment_homework_audit_events"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["classroom", "created_at"]),
            models.Index(fields=["assessment_set", "created_at"]),
            models.Index(fields=["event_type", "created_at"]),
        ]


class SecurityAlert(models.Model):
    """
    Durable record of security/ops alerts for post-incident analysis and webhook replay.
    """

    SOURCE_HOMEWORK_ABUSE = "homework_abuse"
    SOURCE_HOMEWORK_ABUSE_DB = "homework_abuse_db"
    SOURCE_SLO = "slo"
    SOURCE_CHOICES = [
        (SOURCE_HOMEWORK_ABUSE, "Homework abuse"),
        (SOURCE_HOMEWORK_ABUSE_DB, "Homework abuse (DB)"),
        (SOURCE_SLO, "SLO"),
    ]

    alert_type = models.CharField(max_length=80, db_index=True)
    source = models.CharField(max_length=40, db_index=True, choices=SOURCE_CHOICES, default=SOURCE_HOMEWORK_ABUSE)
    fingerprint = models.CharField(max_length=512, db_index=True, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    mitigation = models.JSONField(null=True, blank=True)
    webhook_delivered = models.BooleanField(default=False)
    email_delivered = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "assessment_security_alerts"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["alert_type", "created_at"]),
            models.Index(fields=["source", "created_at"]),
        ]


# NOTE: module-level constants so constraints can reference them safely
# during class construction (Meta is evaluated before the class name exists).
ASSESSMENT_ATTEMPT_STATUS_IN_PROGRESS = "in_progress"
ASSESSMENT_ATTEMPT_STATUS_SUBMITTED = "submitted"
ASSESSMENT_ATTEMPT_STATUS_GRADED = "graded"
ASSESSMENT_ATTEMPT_STATUS_ABANDONED = "abandoned"


class AssessmentAttempt(models.Model):
    STATUS_IN_PROGRESS = ASSESSMENT_ATTEMPT_STATUS_IN_PROGRESS
    STATUS_SUBMITTED = ASSESSMENT_ATTEMPT_STATUS_SUBMITTED
    STATUS_GRADED = ASSESSMENT_ATTEMPT_STATUS_GRADED
    STATUS_ABANDONED = ASSESSMENT_ATTEMPT_STATUS_ABANDONED
    STATUS_CHOICES = [
        (STATUS_IN_PROGRESS, "In progress"),
        (STATUS_SUBMITTED, "Submitted"),
        (STATUS_GRADED, "Graded"),
        (STATUS_ABANDONED, "Abandoned"),
    ]

    homework = models.ForeignKey(
        HomeworkAssignment,
        on_delete=models.CASCADE,
        related_name="attempts",
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assessment_attempts",
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_IN_PROGRESS, db_index=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    submitted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    abandoned_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_activity_at = models.DateTimeField(null=True, blank=True, db_index=True)
    total_time_seconds = models.PositiveIntegerField(default=0)
    active_time_seconds = models.PositiveIntegerField(default=0)
    # ── Pause / resume (save-and-exit) ─────────────────────────────────────────
    # Assessments are untimed (count-up timer), so pause here freezes the elapsed
    # time-on-task counter and preserves position rather than a deadline. Mirrors
    # the pastpaper engine's derived-timer pattern: ``paused_at`` (null = running)
    # is the pause flag, ``paused_seconds`` banks completed pause windows. Elapsed
    # is derived: (now - started_at) - paused_seconds - in-flight-pause, so it
    # freezes while paused and never counts the paused gap.
    paused_at = models.DateTimeField(null=True, blank=True, db_index=True)
    paused_seconds = models.PositiveIntegerField(default=0)
    # Last-viewed question position (0-based index into question_order) so a
    # resumed attempt lands exactly where the student left off.
    current_question_index = models.PositiveIntegerField(default=0)
    # Per-question time spent, keyed by question_id (string). Recorded by the
    # student runner at submit so the result page can show a time breakdown.
    question_times = models.JSONField(blank=True, default=dict)
    # Async grading status
    GRADING_PENDING = "pending"
    GRADING_PROCESSING = "processing"
    GRADING_COMPLETED = "completed"
    GRADING_FAILED = "failed"
    GRADING_STATUS_CHOICES = [
        (GRADING_PENDING, "Pending"),
        (GRADING_PROCESSING, "Processing"),
        (GRADING_COMPLETED, "Completed"),
        (GRADING_FAILED, "Failed"),
    ]
    grading_status = models.CharField(
        max_length=24,
        choices=GRADING_STATUS_CHOICES,
        default=GRADING_PENDING,
        db_index=True,
    )
    grading_attempts = models.PositiveIntegerField(default=0)
    grading_error = models.TextField(blank=True, default="")
    grading_last_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Stable question shuffle per attempt (list of AssessmentQuestion ids).
    question_order = models.JSONField(blank=True, default=list)

    class Meta:
        db_table = "assessment_attempts"
        ordering = ["-started_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["homework", "student"],
                condition=models.Q(status=ASSESSMENT_ATTEMPT_STATUS_IN_PROGRESS),
                name="uniq_active_attempt_per_hw_student_in_progress",
            ),
        ]
        indexes = [
            models.Index(fields=["student", "homework", "status"]),
            models.Index(fields=["student", "status", "started_at"]),
        ]

    def lock_reason(self) -> str | None:
        if self.status in (self.STATUS_SUBMITTED, self.STATUS_GRADED):
            return "submitted"
        if self.status == self.STATUS_ABANDONED:
            return "abandoned"
        return None

    @property
    def is_paused(self) -> bool:
        return self.paused_at is not None

    def accumulated_pause_seconds(self, now=None) -> int:
        """Total paused time = banked windows + the currently in-flight one.

        While ``paused_at`` is set every extra wall-clock second is also counted
        here, so ``elapsed_seconds`` (which subtracts this) stays frozen.
        """
        now = now or timezone.now()
        base = int(self.paused_seconds or 0)
        if self.paused_at is not None:
            base += max(0, int((now - self.paused_at).total_seconds()))
        return base

    def elapsed_seconds(self, now=None) -> int:
        """Wall time since start, excluding paused windows. Freezes while paused."""
        now = now or timezone.now()
        if not self.started_at:
            return 0
        span = int((now - self.started_at).total_seconds())
        return max(0, span - self.accumulated_pause_seconds(now))


class AssessmentAttemptAuditEvent(models.Model):
    EVENT_STARTED = "started"
    EVENT_ANSWER_SAVED = "answer_saved"
    EVENT_SUBMITTED = "submitted"
    EVENT_GRADED = "graded"
    EVENT_ABANDONED = "abandoned"
    EVENT_TIMEOUT_ABANDONED = "timeout_abandoned"
    EVENT_PAUSED = "paused"
    EVENT_RESUMED = "resumed"

    EVENT_CHOICES = [
        (EVENT_STARTED, "Started"),
        (EVENT_ANSWER_SAVED, "Answer saved"),
        (EVENT_SUBMITTED, "Submitted"),
        (EVENT_GRADED, "Graded"),
        (EVENT_ABANDONED, "Abandoned"),
        (EVENT_TIMEOUT_ABANDONED, "Timeout abandoned"),
        (EVENT_PAUSED, "Paused"),
        (EVENT_RESUMED, "Resumed"),
    ]

    attempt = models.ForeignKey(
        AssessmentAttempt,
        on_delete=models.CASCADE,
        related_name="audit_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assessment_audit_events",
    )
    event_type = models.CharField(max_length=40, choices=EVENT_CHOICES, db_index=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "assessment_attempt_audit_events"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["attempt", "created_at"]),
            models.Index(fields=["event_type", "created_at"]),
        ]


class AssessmentAnswer(models.Model):
    attempt = models.ForeignKey(
        AssessmentAttempt,
        on_delete=models.CASCADE,
        related_name="answers",
    )
    question = models.ForeignKey(
        AssessmentQuestion,
        on_delete=models.PROTECT,
        related_name="answers",
    )
    answer = models.JSONField(blank=True, default=None, null=True)
    # Server-computed time based on first/last save timestamps (do not trust client).
    time_spent_seconds = models.PositiveIntegerField(default=0)
    first_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
    is_correct = models.BooleanField(null=True, blank=True, db_index=True)
    points_awarded = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Client-provided monotonic sequence for conflict detection (multi-tab / out-of-order protection).
    client_seq = models.BigIntegerField(default=0, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        db_table = "assessment_answers"
        constraints = [
            models.UniqueConstraint(fields=["attempt", "question"], name="uniq_answer_per_attempt_question"),
        ]


class AssessmentResult(models.Model):
    attempt = models.OneToOneField(
        AssessmentAttempt,
        on_delete=models.CASCADE,
        related_name="result",
    )
    score_points = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    max_points = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    correct_count = models.PositiveIntegerField(default=0)
    total_questions = models.PositiveIntegerField(default=0)
    graded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "assessment_results"
        ordering = ["-graded_at", "-id"]


class AssessmentAttemptFeedback(models.Model):
    """
    Lightweight instructional feedback written by a teacher on a student's
    assessment attempt.

    One feedback record per attempt — teachers may update it in place (this is
    not a discussion thread; it is a single instructional note per submission).

    Intentionally minimal:
    - No threading, no reactions, no mentions.
    - Read by students after submission via the pedagogical review bundle.
    - Written by teachers via the ops intervention panel.
    """

    attempt = models.OneToOneField(
        AssessmentAttempt,
        on_delete=models.CASCADE,
        related_name="teacher_feedback",
    )
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="assessment_feedbacks_given",
    )
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "assessment_attempt_feedback"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"Feedback on attempt #{self.attempt_id} by {self.teacher_id}"


class GovernanceEvent(models.Model):
    """
    Immutable, append-only audit event store for all governance actions.

    GOVERNANCE INVARIANTS:
      INV-GE01  Records are append-only. save() raises if called on an existing PK.
      INV-GE02  Records cannot be deleted — permanent audit trail.
      INV-GE03  All significant state transitions MUST emit a GovernanceEvent.
                Silent state changes are an audit violation.
      INV-GE04  actor_email is denormalized at write-time for audit stability
                — the email remains correct even if the user account is later
                modified or deleted.

    ENTITY REFERENCE (polymorphic — entity_type + entity_id):
      entity_type: Django model class name ("AssessmentSet", "AssessmentSetVersion",
                   "HomeworkAssignment", "AssessmentAttempt").
      entity_id:   Primary key of the entity.

    QUERYING:
      - Operator timeline for a set:
            GovernanceEvent.objects.filter(entity_type="AssessmentSet", entity_id=42)
      - All publish events:
            GovernanceEvent.objects.filter(event_type=GovernanceEvent.EVENT_PUBLISH)
      - Fallback usage (sunset monitoring):
            GovernanceEvent.objects.filter(event_type=GovernanceEvent.EVENT_FALLBACK_PATH_USED)
    """

    # ── Event taxonomy ─────────────────────────────────────────────────────────

    # Content lifecycle
    EVENT_PUBLISH = "publish"
    EVENT_PUBLISH_IDEMPOTENT = "publish_idempotent"      # Re-publish with identical content
    EVENT_PUBLISH_VALIDATION_FAILED = "publish_validation_failed"
    EVENT_SUPERSEDE = "supersede"                        # New version supersedes old
    EVENT_SET_DELETE = "set_delete"                      # An AssessmentSet was deleted (hard delete)

    # Review lifecycle (draft → needs_review → approved)
    EVENT_SUBMIT_FOR_REVIEW = "submit_for_review"        # draft → needs_review
    EVENT_APPROVE = "approve"                            # → approved (also publishes)
    EVENT_SEND_BACK = "send_back"                        # → draft / needs_review (re-open)

    # Assignment lifecycle
    EVENT_ASSIGNMENT_PIN = "assignment_pin"              # Version pinned to HomeworkAssignment

    # Attempt lifecycle
    EVENT_ATTEMPT_SNAPSHOT_PIN = "attempt_snapshot_pin" # Version pinned to AssessmentAttempt

    # Scoring
    EVENT_SCORING_START = "scoring_start"
    EVENT_SCORING_COMPLETE = "scoring_complete"
    EVENT_SCORING_RETRY = "scoring_retry"
    EVENT_SCORING_FAILURE = "scoring_failure"
    EVENT_SCORING_OVERRIDE = "scoring_override"

    # Integrity
    EVENT_INTEGRITY_FAILURE = "integrity_failure"
    EVENT_INTEGRITY_REPAIR = "integrity_repair"

    # Fallback telemetry — critical for sunset monitoring
    EVENT_FALLBACK_PATH_USED = "fallback_path_used"

    EVENT_CHOICES = [
        (EVENT_PUBLISH, "Published"),
        (EVENT_PUBLISH_IDEMPOTENT, "Publish (idempotent — identical content)"),
        (EVENT_PUBLISH_VALIDATION_FAILED, "Publish validation failed"),
        (EVENT_SUPERSEDE, "Superseded by new version"),
        (EVENT_SET_DELETE, "Assessment set deleted"),
        (EVENT_SUBMIT_FOR_REVIEW, "Submitted for review"),
        (EVENT_APPROVE, "Approved"),
        (EVENT_SEND_BACK, "Sent back for changes"),
        (EVENT_ASSIGNMENT_PIN, "Assignment version pinned"),
        (EVENT_ATTEMPT_SNAPSHOT_PIN, "Attempt snapshot pinned"),
        (EVENT_SCORING_START, "Scoring started"),
        (EVENT_SCORING_COMPLETE, "Scoring completed"),
        (EVENT_SCORING_RETRY, "Scoring retried"),
        (EVENT_SCORING_FAILURE, "Scoring failed"),
        (EVENT_SCORING_OVERRIDE, "Scoring overridden"),
        (EVENT_INTEGRITY_FAILURE, "Integrity failure detected"),
        (EVENT_INTEGRITY_REPAIR, "Integrity repair performed"),
        (EVENT_FALLBACK_PATH_USED, "Live-read fallback path used (pre-snapshot attempt)"),
    ]

    # ── Core fields ────────────────────────────────────────────────────────────

    event_type = models.CharField(max_length=64, choices=EVENT_CHOICES, db_index=True)

    # Polymorphic entity reference
    entity_type = models.CharField(max_length=64, db_index=True)
    entity_id = models.BigIntegerField(db_index=True)

    # Actor attribution (nullable = system/Celery action)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="governance_events",
    )
    # Denormalized email — stable audit record independent of user lifecycle
    actor_email = models.CharField(max_length=254, blank=True, default="", db_index=True)

    # Arbitrary structured payload for operator debugging
    payload = models.JSONField(default=dict, blank=True)

    # Request trace ID linking related events across tables and log lines
    correlation_id = models.CharField(max_length=128, blank=True, default="", db_index=True)

    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "governance_events"
        ordering = ["-occurred_at", "-id"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id", "occurred_at"], name="gov_ev_entity_timeline_idx"),
            models.Index(fields=["event_type", "occurred_at"], name="gov_ev_type_timeline_idx"),
            models.Index(fields=["actor_email", "occurred_at"], name="gov_ev_actor_timeline_idx"),
        ]

    # ── Immutability guards ────────────────────────────────────────────────────

    def save(self, *args, **kwargs) -> None:  # type: ignore[override]
        if self.pk is not None:
            raise ValueError(
                "GovernanceEvent records are immutable. "
                "They are a permanent audit trail and cannot be modified."
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):  # type: ignore[override]
        raise ValueError(
            "GovernanceEvent records are permanent audit records and cannot be deleted."
        )

    def __str__(self) -> str:
        return f"GovernanceEvent({self.event_type} {self.entity_type}#{self.entity_id} @{self.occurred_at})"
