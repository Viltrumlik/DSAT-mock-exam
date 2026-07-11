from __future__ import annotations

from django.conf import settings
from django.db import models


class QuestionErrorReport(models.Model):
    """
    A student-submitted "this question has an error" report.

    The platform has TWO independent question tables with independent id spaces:
    - ``exams.Question``            (pastpaper / practice / mock / midterm)
    - ``assessments.AssessmentQuestion``

    So a report stores ``system`` + ``question_id`` (no hard FK), and denormalizes a
    stable human-readable snapshot at write time (resolved server-side from the
    Question -> Module -> container chain) so the report stays meaningful even if the
    question is later edited or deleted.
    """

    SYSTEM_EXAM = "exam"
    SYSTEM_ASSESSMENT = "assessment"
    SYSTEM_CHOICES = [
        (SYSTEM_EXAM, "Exam (pastpaper / practice / mock / midterm)"),
        (SYSTEM_ASSESSMENT, "Assessment"),
    ]

    RESOURCE_PASTPAPER = "pastpaper"
    RESOURCE_PRACTICE_TEST = "practice_test"
    RESOURCE_ASSESSMENT = "assessment"
    RESOURCE_MOCK = "mock"
    RESOURCE_MIDTERM = "midterm"
    RESOURCE_UNKNOWN = "unknown"
    RESOURCE_CHOICES = [
        (RESOURCE_PASTPAPER, "Pastpaper"),
        (RESOURCE_PRACTICE_TEST, "Practice test"),
        (RESOURCE_ASSESSMENT, "Assessment"),
        (RESOURCE_MOCK, "Mock exam"),
        (RESOURCE_MIDTERM, "Midterm"),
        (RESOURCE_UNKNOWN, "Unknown"),
    ]

    CATEGORY_WRONG_ANSWER = "wrong_answer"
    CATEGORY_ANSWER_KEY = "answer_key"
    CATEGORY_TYPO_UNCLEAR = "typo_unclear"
    CATEGORY_IMAGE_FIGURE = "image_figure"
    CATEGORY_OTHER = "other"
    CATEGORY_CHOICES = [
        (CATEGORY_WRONG_ANSWER, "Wrong / no correct answer"),
        (CATEGORY_ANSWER_KEY, "Answer key looks wrong"),
        (CATEGORY_TYPO_UNCLEAR, "Typo / unclear wording"),
        (CATEGORY_IMAGE_FIGURE, "Image / figure problem"),
        (CATEGORY_OTHER, "Other"),
    ]

    STATUS_NEW = "NEW"
    STATUS_REVIEWING = "REVIEWING"
    STATUS_FIXED = "FIXED"
    STATUS_REJECTED = "REJECTED"
    STATUS_DUPLICATE = "DUPLICATE"
    STATUS_CHOICES = [
        (STATUS_NEW, "New"),
        (STATUS_REVIEWING, "Reviewing"),
        (STATUS_FIXED, "Fixed"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_DUPLICATE, "Duplicate"),
    ]

    # What the student reported (raw target + free text).
    system = models.CharField(max_length=16, choices=SYSTEM_CHOICES, db_index=True)
    question_id = models.BigIntegerField(db_index=True)
    attempt_id = models.BigIntegerField(null=True, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default=CATEGORY_OTHER, db_index=True)
    message = models.TextField(max_length=2000, blank=True, default="")
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="question_error_reports",
    )

    # Server-derived resource identity + stable snapshot (filled at create time).
    resource_type = models.CharField(
        max_length=20, choices=RESOURCE_CHOICES, default=RESOURCE_UNKNOWN, db_index=True
    )
    resource_id = models.BigIntegerField(null=True, blank=True)
    resource_title = models.CharField(max_length=255, blank=True, default="")
    question_order = models.PositiveIntegerField(null=True, blank=True, help_text="1-based number.")
    question_excerpt = models.CharField(max_length=280, blank=True, default="")
    qb_id = models.CharField(max_length=32, blank=True, default="", db_index=True)

    # Triage workflow.
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_NEW, db_index=True)
    resolution_note = models.TextField(blank=True, default="")
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    # Telegram identity that resolved it via the bot's inline "Fixed" button
    # (the tapper may not map to a Django user), e.g. "@admin".
    resolved_by_label = models.CharField(max_length=128, blank=True, default="")
    # Every posted copy [{ "chat_id": "...", "message_id": 123 }, ...] so a "Fixed"
    # tap can update the status on ALL copies (staff group + each subscriber) at once.
    telegram_messages = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "question_error_reports"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["system", "question_id"]),
            models.Index(fields=["status", "-created_at"]),
        ]

    def __str__(self) -> str:
        num = f"Q{self.question_order}" if self.question_order else f"qid{self.question_id}"
        return f"Report #{self.pk} [{self.resource_type} {num}] {self.status}"


class TelegramReportSubscriber(models.Model):
    """A Telegram chat that pressed /start on the report bot; each active row is DM'd new reports."""

    chat_id = models.CharField(max_length=64, unique=True)
    username = models.CharField(max_length=255, blank=True, default="")
    first_name = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    linked_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "question_report_telegram_subscribers"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        state = "active" if self.is_active else "inactive"
        return f"{self.username or self.chat_id} ({state})"
