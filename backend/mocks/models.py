"""Full-mock data models + attempt orchestrator.

A Mock is a 4-module SAT simulation: 2 English + 2 Math modules across two sections, with a
real server-authoritative break between them, scored on the combined 1600 scale. It reuses
``exams.Module``/``exams.Question`` content (each MockSection owns two Modules via OneToOne;
``Module.practice_test`` is already nullable) and the exam-runner visuals; nothing else is
shared with the pastpaper/legacy-mock code paths.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import models
from django.utils import timezone

from .state_machine import (
    ACTIVE_MODULE,
    STATE_ABANDONED,
    STATE_BREAK,
    STATE_CHOICES,
    STATE_COMPLETED,
    STATE_NOT_STARTED,
    STATE_SCORING,
)

logger = logging.getLogger(__name__)

READING_WRITING = "READING_WRITING"
MATH = "MATH"


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Mock(TimestampedModel):
    """A full 4-module SAT mock definition (staff-authored)."""

    title = models.CharField(max_length=255, db_index=True)
    is_published = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True)
    break_minutes = models.PositiveSmallIntegerField(default=10, help_text="Break between English and Math.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "mocks_mock"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Mock #{self.pk}: {self.title}"

    def english_section(self):
        return self.sections.filter(subject=READING_WRITING).first()

    def math_section(self):
        return self.sections.filter(subject=MATH).first()

    @staticmethod
    def _ordered(section):
        if section is None:
            return []
        return [m for m in (section.module1, section.module2) if m is not None]

    def english_modules(self):
        return self._ordered(self.english_section())

    def math_modules(self):
        return self._ordered(self.math_section())

    def active_module(self, state):
        """Resolve the exams.Module for an active state (ENGLISH_M1 etc.)."""
        spec = ACTIVE_MODULE.get(state)
        if not spec:
            return None
        subject, order = spec
        section = self.english_section() if subject == READING_WRITING else self.math_section()
        if section is None:
            return None
        return section.module1 if order == 1 else section.module2


class MockSection(TimestampedModel):
    """One subject half of a mock (English or Math) — owns two exams.Module rows."""

    SUBJECT_CHOICES = [(READING_WRITING, "Reading & Writing"), (MATH, "Math")]

    mock = models.ForeignKey(Mock, on_delete=models.CASCADE, related_name="sections")
    subject = models.CharField(max_length=20, choices=SUBJECT_CHOICES, db_index=True)
    module1 = models.OneToOneField("exams.Module", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    module2 = models.OneToOneField("exams.Module", on_delete=models.PROTECT, null=True, blank=True, related_name="+")

    class Meta:
        db_table = "mocks_section"
        constraints = [
            models.UniqueConstraint(fields=["mock", "subject"], name="uniq_mock_section_per_subject"),
        ]

    def __str__(self):
        return f"MockSection {self.subject} (mock={self.mock_id})"

    def modules(self):
        return [m for m in (self.module1, self.module2) if m is not None]

    def delete(self, *args, **kwargs):
        m1, m2 = self.module1, self.module2
        out = super().delete(*args, **kwargs)
        for m in (m1, m2):
            if m is not None:
                m.delete()
        return out


class MockAttempt(TimestampedModel):
    """One student's run through a full mock — 4 modules + break, one object."""

    STATE_CHOICES = STATE_CHOICES

    mock = models.ForeignKey(Mock, on_delete=models.CASCADE, related_name="attempts", db_index=True)
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mock_attempts", db_index=True
    )
    # {str(module_id): {str(question_id): answer}} across all 4 modules.
    module_answers = models.JSONField(default=dict, blank=True)
    flagged = models.JSONField(default=dict, blank=True)
    # First-seen anchor per active phase (incl BREAK), written `or now`, never rewound.
    phase_started_at = models.JSONField(default=dict, blank=True)

    current_state = models.CharField(max_length=24, choices=STATE_CHOICES, default=STATE_NOT_STARTED, db_index=True)
    version_number = models.PositiveIntegerField(default=0, db_index=True)
    is_completed = models.BooleanField(default=False, db_index=True)

    english_score = models.IntegerField(null=True, blank=True)
    math_score = models.IntegerField(null=True, blank=True)
    total_score = models.IntegerField(null=True, blank=True)  # combined /1600

    scoring_started_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "mocks_attempt"
        constraints = [
            models.UniqueConstraint(
                fields=["student", "mock"],
                condition=models.Q(is_completed=False) & ~models.Q(current_state=STATE_ABANDONED),
                name="uniq_active_mock_attempt_per_student",
            ),
        ]
        indexes = [models.Index(fields=["mock", "student"]), models.Index(fields=["current_state"])]

    def __str__(self):
        return f"MockAttempt #{self.pk} (mock={self.mock_id}, student={self.student_id}, {self.current_state})"

    def grade(self) -> dict:
        """Pure score computation (no DB write)."""
        from .scoring import score_mock_attempt

        return score_mock_attempt(self)


class MockAttemptIdempotencyKey(models.Model):
    """Replay store for mutating mock-attempt endpoints (mirrors exams.AttemptIdempotencyKey)."""

    attempt = models.ForeignKey(MockAttempt, on_delete=models.CASCADE, related_name="idempotency_keys")
    endpoint = models.CharField(max_length=64, db_index=True)
    key = models.CharField(max_length=128, db_index=True)
    response_status = models.PositiveSmallIntegerField(default=200)
    response_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = "mocks_attempt_idempotency_keys"
        constraints = [
            models.UniqueConstraint(fields=["attempt", "endpoint", "key"], name="uniq_mock_attempt_endpoint_key"),
        ]
