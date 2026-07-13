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

from datetime import time

from django.conf import settings
from django.db import models
from django.utils import timezone

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

    # --- Relative deadline (resolved to an absolute due date at release time) ---
    due_after_days = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Days after the lesson date the homework is due. Null = no deadline.",
    )
    deadline_time = models.TimeField(
        null=True, blank=True, default=time(23, 59), help_text="Time of day the homework is due."
    )

    # Reserved for future exam-linking of midterm lessons — unused for now.
    midterm_exam = models.ForeignKey(
        "exams.MockExam",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_lessons",
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
        )

    def validation_reasons(self) -> list[str]:
        """Why this lesson can't be published. Empty list = ready. Midterms are always ready."""
        if self.is_midterm:
            return []
        reasons: list[str] = []
        if not (self.instructions or "").strip():
            reasons.append("Instructions are empty")
        if not self.has_content:
            reasons.append(
                "No content attached (add an assessment, past paper, file, or enable file upload)"
            )
        return reasons

    @property
    def is_ready(self) -> bool:
        return not self.validation_reasons()


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
