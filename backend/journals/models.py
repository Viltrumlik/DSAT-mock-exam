"""Journal data model.

A **Journal** is the complete, pre-authored homework plan for ONE course Level
(subject + level). It holds a fixed set of **JournalLesson** rows: most are HOMEWORK
lessons carrying a homework template (identical shape to ``classes.Assignment``); every
12th lesson is a MIDTERM marker with no homework.

Templates reference **live** content (assessment sets, past papers) — nothing is version
-pinned here. Version-pinning happens later, at classroom-release time (future work); see
``journals.services.release_lesson_into_classroom``.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from . import structure


class Journal(models.Model):
    SUBJECT_ENGLISH = structure.SUBJECT_ENGLISH
    SUBJECT_MATH = structure.SUBJECT_MATH
    SUBJECT_CHOICES = [
        (SUBJECT_ENGLISH, "English"),
        (SUBJECT_MATH, "Math"),
    ]

    # subject → the two resource vocabularies (mirrors classes.Classroom):
    #   platform (READING_WRITING/MATH): PracticeTest.subject, MockExam.midterm_subject
    #   domain   (english/math):         AssessmentSet.subject
    _PLATFORM_SUBJECT = {SUBJECT_MATH: "MATH", SUBJECT_ENGLISH: "READING_WRITING"}
    _DOMAIN_SUBJECT = {SUBJECT_MATH: "math", SUBJECT_ENGLISH: "english"}

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
    LEVELS_BY_SUBJECT = {
        SUBJECT_ENGLISH: (LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
        SUBJECT_MATH: (LEVEL_FOUNDATION, LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
    }

    STATUS_DRAFT = "DRAFT"
    STATUS_PUBLISHED = "PUBLISHED"
    STATUS_ARCHIVED = "ARCHIVED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    subject = models.CharField(max_length=20, choices=SUBJECT_CHOICES, db_index=True)
    level = models.CharField(max_length=16, choices=LEVEL_CHOICES, db_index=True)
    title = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Optional custom name. Falls back to the derived '<Subject> <Level> Journal'.",
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    duration_months = models.PositiveSmallIntegerField(default=0)
    total_lessons = models.PositiveSmallIntegerField(default=0)
    version = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="journals_created"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journals_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "journals_journal"
        ordering = ["subject", "level"]
        constraints = [
            models.UniqueConstraint(
                fields=["subject", "level"], name="uniq_journal_subject_level"
            ),
        ]
        indexes = [
            models.Index(fields=["status"]),
        ]

    def __str__(self) -> str:
        return self.display_title

    @property
    def platform_subject(self) -> str | None:
        """READING_WRITING / MATH — for PracticeTest / MockExam filtering."""
        return self._PLATFORM_SUBJECT.get(self.subject)

    @property
    def domain_subject(self) -> str | None:
        """english / math — for AssessmentSet filtering."""
        return self._DOMAIN_SUBJECT.get(self.subject)

    @property
    def display_title(self) -> str:
        if self.title.strip():
            return self.title.strip()
        subject_label = dict(self.SUBJECT_CHOICES).get(self.subject, self.subject)
        level_label = dict(self.LEVEL_CHOICES).get(self.level, self.level)
        return f"{subject_label} {level_label} Journal"

    @classmethod
    def allowed_levels_for_subject(cls, subject: str) -> tuple[str, ...]:
        return cls.LEVELS_BY_SUBJECT.get(subject, ())


class JournalLesson(models.Model):
    """One lesson slot in a Journal — a homework template, or a midterm marker.

    Mirrors ``classes.Assignment`` (title/instructions/attachments/practice ids/scope),
    minus the ``classroom`` FK and absolute ``due_at``. Deadlines are **relative** here:
    ``due_after_days`` + ``deadline_time`` become an absolute due date only at release time.
    """

    TYPE_HOMEWORK = structure.LESSON_TYPE_HOMEWORK
    TYPE_MIDTERM = structure.LESSON_TYPE_MIDTERM
    TYPE_CHOICES = [
        (TYPE_HOMEWORK, "Homework"),
        (TYPE_MIDTERM, "Midterm"),
    ]

    STATUS_DRAFT = "DRAFT"
    STATUS_PUBLISHED = "PUBLISHED"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
    ]

    # Mirror classes.Assignment.PRACTICE_SCOPE_* verbatim.
    PRACTICE_SCOPE_BOTH = "BOTH"
    PRACTICE_SCOPE_ENGLISH = "ENGLISH"
    PRACTICE_SCOPE_MATH = "MATH"
    PRACTICE_SCOPE_CHOICES = [
        (PRACTICE_SCOPE_BOTH, "Both (English & Math)"),
        (PRACTICE_SCOPE_ENGLISH, "English (Reading & Writing) only"),
        (PRACTICE_SCOPE_MATH, "Math only"),
    ]

    CATEGORY_HOMEWORK = "HOMEWORK"

    journal = models.ForeignKey(
        Journal, on_delete=models.CASCADE, related_name="lessons"
    )
    lesson_number = models.PositiveSmallIntegerField(db_index=True)
    lesson_type = models.CharField(
        max_length=12, choices=TYPE_CHOICES, default=TYPE_HOMEWORK, db_index=True
    )
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    published_at = models.DateTimeField(null=True, blank=True)

    # --- Homework template fields (identical semantics to classes.Assignment) ---
    title = models.CharField(max_length=200, blank=True, default="")
    instructions = models.TextField(blank=True, default="")
    external_url = models.URLField(blank=True, default="")
    attachment_file = models.FileField(upload_to="journal_files/", null=True, blank=True)
    allow_file_upload = models.BooleanField(default=False)
    practice_scope = models.CharField(
        max_length=20, choices=PRACTICE_SCOPE_CHOICES, default=PRACTICE_SCOPE_BOTH
    )
    practice_test_ids = models.JSONField(null=True, blank=True)
    practice_test_pack_ids = models.JSONField(null=True, blank=True)
    category = models.CharField(max_length=20, default=CATEGORY_HOMEWORK)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)

    # NOTE: there is deliberately NO deadline field. Homework is due at the START of the
    # classroom's next lesson (computed at release time); if no next lesson can be
    # determined the homework simply has no deadline.

    # Midterm sessions: which midterm this session runs, and how many days before the
    # session the classroom should get access (config consumed by the future
    # classroom-release step — see services.release_lesson_into_classroom).
    #
    # Points at midterms.Midterm (NOT the legacy exams.MockExam): Midterm.level is a
    # strict superset — midterms/sync.py mirrors every legacy MockExam.midterm_level into
    # it, AND natively-authored midterms (legacy_mock_exam_id=NULL) only exist here. The
    # level picker would miss every native midterm if it filtered on MockExam.
    midterm_exam = models.ForeignKey(
        "midterms.Midterm",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_lessons",
    )
    midterm_access_days_before = models.PositiveSmallIntegerField(
        default=2,
        help_text="Grant the classroom access to the midterm this many days before the session.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_lesson"
        ordering = ["journal_id", "lesson_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["journal", "lesson_number"], name="uniq_lesson_number_per_journal"
            ),
        ]
        indexes = [
            models.Index(fields=["journal", "status"]),
            models.Index(fields=["journal", "lesson_type"]),
        ]

    def __str__(self) -> str:
        return f"{self.journal_id}·L{self.lesson_number} ({self.lesson_type})"

    @property
    def is_midterm(self) -> bool:
        return self.lesson_type == self.TYPE_MIDTERM

    def _assessment_count(self) -> int:
        cached = getattr(self, "_assess_count", None)
        return cached if cached is not None else self.assessments.count()

    def _extra_attachment_count(self) -> int:
        cached = getattr(self, "_attach_count", None)
        return cached if cached is not None else self.extra_attachments.count()

    @property
    def content_count(self) -> int:
        """Number of distinct openable/attached content pieces on this lesson."""
        n = self._assessment_count() + self._extra_attachment_count()
        n += len(self.practice_test_ids or [])
        n += len(self.practice_test_pack_ids or [])
        if self.attachment_file:
            n += 1
        return n

    @property
    def has_content(self) -> bool:
        return bool(
            self._assessment_count()
            or self._extra_attachment_count()
            or self.practice_test_ids
            or self.practice_test_pack_ids
            or self.attachment_file
            or self.allow_file_upload
            # An external link alone is a valid deliverable — parity with the
            # classroom assignment model, where external_url counts as content.
            or (self.external_url or "").strip()
        )

    def homework_validation_reasons(self) -> list[str]:
        """Why this session's HOMEWORK isn't publishable. Empty list = ready."""
        if self.is_midterm:
            return []
        reasons: list[str] = []
        if not (self.instructions or "").strip():
            reasons.append("Homework instructions are empty")
        if not self.has_content:
            reasons.append(
                "Homework has no content (add an assessment, past paper, file, link, or enable file upload)"
            )
        return reasons

    def classwork_validation_reasons(self) -> list[str]:
        """Why this session's CLASSWORK isn't publishable. Empty list = ready."""
        if self.is_midterm:
            return []
        cw = getattr(self, "classwork", None)
        if cw is None:
            return ["Classwork not set up"]
        return cw.validation_reasons()

    def validation_reasons(self) -> list[str]:
        """Why this session can't be published. Empty list = ready.

        A MIDTERM session only needs its midterm exam chosen; a HOMEWORK session needs
        both its homework brief and its in-class plan (classwork) filled in.
        """
        if self.is_midterm:
            return [] if self.midterm_exam_id else ["No midterm exam selected"]
        return self.homework_validation_reasons() + self.classwork_validation_reasons()

    @property
    def homework_ready(self) -> bool:
        return not self.homework_validation_reasons()

    @property
    def classwork_ready(self) -> bool:
        return not self.classwork_validation_reasons()

    @property
    def is_ready(self) -> bool:
        return not self.validation_reasons()


class JournalClasswork(models.Model):
    """The in-class plan for one session — the five timetable blocks.

    Mirrors the lesson timetable:
        Homework review · New topic · Break · Exercises · Revision
        20 min          · 20-30 min · 10min · 20 min    · 30 min   (all editable)

    Block content:
      * Homework review — NOT authored here; it is derived (the PREVIOUS session's
        homework), so the teacher can re-open and analyse what was set last lesson.
      * New topic       — authored exactly like a homework brief (title/instructions/
        resources/files/link).
      * Break           — nothing to author; shown in the timetable only.
      * Exercises       — in-class assessments / past papers students get access to
        during the lesson.
      * Revision        — re-opens the Exercises content for mistake review; optional notes.
    """

    BLOCK_NEW_TOPIC = "NEW_TOPIC"
    BLOCK_EXERCISES = "EXERCISES"
    BLOCK_CHOICES = [
        (BLOCK_NEW_TOPIC, "New topic"),
        (BLOCK_EXERCISES, "Exercises"),
    ]

    DEFAULT_HOMEWORK_REVIEW_MINUTES = 20
    DEFAULT_NEW_TOPIC_MINUTES = 30
    DEFAULT_BREAK_MINUTES = 10
    DEFAULT_EXERCISES_MINUTES = 20
    DEFAULT_REVISION_MINUTES = 30

    lesson = models.OneToOneField(
        JournalLesson, on_delete=models.CASCADE, related_name="classwork"
    )

    # Durations (minutes) — timetable defaults, all editable per session.
    homework_review_minutes = models.PositiveSmallIntegerField(
        default=DEFAULT_HOMEWORK_REVIEW_MINUTES
    )
    new_topic_minutes = models.PositiveSmallIntegerField(default=DEFAULT_NEW_TOPIC_MINUTES)
    break_minutes = models.PositiveSmallIntegerField(default=DEFAULT_BREAK_MINUTES)
    exercises_minutes = models.PositiveSmallIntegerField(default=DEFAULT_EXERCISES_MINUTES)
    revision_minutes = models.PositiveSmallIntegerField(default=DEFAULT_REVISION_MINUTES)

    # --- New topic (authored like a homework brief) ---
    new_topic_title = models.CharField(max_length=200, blank=True, default="")
    new_topic_instructions = models.TextField(blank=True, default="")
    new_topic_external_url = models.URLField(blank=True, default="")
    new_topic_attachment_file = models.FileField(
        upload_to="journal_files/", null=True, blank=True
    )
    new_topic_practice_test_ids = models.JSONField(null=True, blank=True)
    new_topic_practice_test_pack_ids = models.JSONField(null=True, blank=True)

    # --- Exercises (in-class practice) ---
    exercise_practice_test_ids = models.JSONField(null=True, blank=True)
    exercise_practice_test_pack_ids = models.JSONField(null=True, blank=True)

    # --- Revision ---
    revision_notes = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journals_classwork"

    def __str__(self) -> str:
        return f"classwork(lesson={self.lesson_id})"

    # ---- timetable -------------------------------------------------------
    @property
    def total_minutes(self) -> int:
        return (
            self.homework_review_minutes
            + self.new_topic_minutes
            + self.break_minutes
            + self.exercises_minutes
            + self.revision_minutes
        )

    def timetable(self) -> list[dict]:
        """Ordered blocks for the reminder table shown above the classwork."""
        return [
            {"key": "HOMEWORK_REVIEW", "label": "Homework", "minutes": self.homework_review_minutes},
            {"key": "NEW_TOPIC", "label": "New topic", "minutes": self.new_topic_minutes},
            {"key": "BREAK", "label": "Break", "minutes": self.break_minutes},
            {"key": "EXERCISES", "label": "Exercises", "minutes": self.exercises_minutes},
            {"key": "REVISION", "label": "Revision", "minutes": self.revision_minutes},
        ]

    # ---- content helpers -------------------------------------------------
    def _assessments_for(self, block: str):
        return [a for a in self.assessments.all() if a.block == block]

    @property
    def has_new_topic_content(self) -> bool:
        return bool(
            self._assessments_for(self.BLOCK_NEW_TOPIC)
            or self.new_topic_practice_test_ids
            or self.new_topic_practice_test_pack_ids
            or self.new_topic_attachment_file
            or (self.new_topic_external_url or "").strip()
        )

    @property
    def has_exercises(self) -> bool:
        return bool(
            self._assessments_for(self.BLOCK_EXERCISES)
            or self.exercise_practice_test_ids
            or self.exercise_practice_test_pack_ids
        )

    def validation_reasons(self) -> list[str]:
        """A session's in-class plan needs at least a new-topic brief."""
        reasons: list[str] = []
        if not (self.new_topic_title or "").strip():
            reasons.append("New topic title is empty")
        if not (self.new_topic_instructions or "").strip():
            reasons.append("New topic instructions are empty")
        return reasons

    @property
    def is_ready(self) -> bool:
        return not self.validation_reasons()


class JournalClassworkAssessment(models.Model):
    """Assessment set attached to a classwork block (new topic or exercises).

    Live reference, no version pin — same rationale as JournalLessonAssessment.
    """

    classwork = models.ForeignKey(
        JournalClasswork, on_delete=models.CASCADE, related_name="assessments"
    )
    assessment_set = models.ForeignKey(
        "assessments.AssessmentSet",
        on_delete=models.PROTECT,
        related_name="journal_classwork_links",
    )
    block = models.CharField(
        max_length=16,
        choices=JournalClasswork.BLOCK_CHOICES,
        default=JournalClasswork.BLOCK_NEW_TOPIC,
        db_index=True,
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_classwork_assessment_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_classwork_assessment"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["classwork", "assessment_set", "block"],
                name="uniq_classwork_assessment_block",
            ),
        ]

    def __str__(self) -> str:
        return f"classwork={self.classwork_id} set={self.assessment_set_id} block={self.block}"


class JournalClassworkAttachment(models.Model):
    """Extra file on a classwork block (new topic)."""

    classwork = models.ForeignKey(
        JournalClasswork, on_delete=models.CASCADE, related_name="extra_attachments"
    )
    file = models.FileField(upload_to="journal_files/")
    block = models.CharField(
        max_length=16,
        choices=JournalClasswork.BLOCK_CHOICES,
        default=JournalClasswork.BLOCK_NEW_TOPIC,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_classwork_attachment"
        ordering = ["id"]

    def __str__(self) -> str:
        return f"classwork={self.classwork_id} file={self.file.name}"


class JournalLessonAssessment(models.Model):
    """Assessment set attached to a lesson (mirrors assessments.HomeworkAssignment).

    Stores a **live** reference — NO ``set_version`` snapshot. A template must always
    reflect the current set content; the version is pinned later, when a classroom
    actually receives this homework.
    """

    lesson = models.ForeignKey(
        JournalLesson, on_delete=models.CASCADE, related_name="assessments"
    )
    assessment_set = models.ForeignKey(
        "assessments.AssessmentSet",
        on_delete=models.PROTECT,
        related_name="journal_lesson_links",
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_assessment_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_lesson_assessment"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["lesson", "assessment_set"], name="uniq_lesson_assessment"
            ),
        ]

    def __str__(self) -> str:
        return f"lesson={self.lesson_id} set={self.assessment_set_id}"


class JournalLessonAttachment(models.Model):
    """Extra teacher file on a lesson (mirrors classes.AssignmentExtraAttachment)."""

    lesson = models.ForeignKey(
        JournalLesson, on_delete=models.CASCADE, related_name="extra_attachments"
    )
    file = models.FileField(upload_to="journal_files/")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "journals_lesson_attachment"
        ordering = ["id"]

    def __str__(self) -> str:
        return f"lesson={self.lesson_id} file={self.file.name}"


class JournalAuditEvent(models.Model):
    """Append-only history for a journal (powers the 'History' action)."""

    journal = models.ForeignKey(
        Journal, on_delete=models.CASCADE, related_name="audit_events"
    )
    lesson = models.ForeignKey(
        JournalLesson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_audit_events",
    )
    event_type = models.CharField(max_length=40, db_index=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "journals_audit_event"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.journal_id}:{self.event_type}@{self.created_at:%Y-%m-%d}"
