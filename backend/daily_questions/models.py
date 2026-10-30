"""Question of the Day (owner, 2026-10-30).

Every centre student gets one question a day per subject they study, at the level of the
class they study it in: English Junior + Math Senior is one Junior English question and one
Senior Math question. The questions for a month are the 30 that last month's assessments
found hardest at that level — one pool per (month, subject, level), built once and kept.

Three tables, each with one job:

- ``DailyQuestionPool`` — WHICH month and cohort a list is for, and where the list came from.
  ``source`` is the seam for the journal variant the owner described for later: a level whose
  journal names its own assessments will build its pool from those instead of from last
  month's results. Nothing else in the app reads ``source``, so adding a second value is a
  change to the builder alone.
- ``DailyQuestionPoolItem`` — the list itself, ranked, with the figures it was ranked on, so
  "why is this question here?" is answerable from the row without re-running anything.
- ``DailyQuestionAssignment`` — the question one student got on one day, and what they
  answered. It is written the first time the student opens the card that day, so a reload
  never re-rolls the question.

The answers here are deliberately NOT ``assessments.AssessmentAnswer`` rows. Next month's
pool is ranked from assessment answers alone; a student's second look at a question they
already missed must not move it down the list.

The questions are the live ``AssessmentQuestion`` rows, not copies: a fix to a question in
the builder reaches the card the same minute.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from assessments.models import AssessmentSet


class DailyQuestionPool(models.Model):
    #: Ranked from the previous calendar month's assessment answers at this level.
    SOURCE_PREVIOUS_MONTH = "previous_month"
    SOURCE_CHOICES = [
        (SOURCE_PREVIOUS_MONTH, "Previous month's hardest questions"),
    ]

    #: The first day of the month this list is served in.
    month = models.DateField()
    subject = models.CharField(max_length=16, choices=AssessmentSet.SUBJECT_CHOICES)
    level = models.CharField(max_length=16, choices=AssessmentSet.LEVEL_CHOICES)
    source = models.CharField(
        max_length=32, choices=SOURCE_CHOICES, default=SOURCE_PREVIOUS_MONTH
    )
    #: The answers the ranking read: submitted on or after ``stats_from`` and before
    #: ``stats_until``, both Tashkent dates.
    stats_from = models.DateField()
    stats_until = models.DateField()
    built_at = models.DateTimeField(auto_now_add=True)
    rebuilt_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "daily_question_pools"
        ordering = ["-month", "subject", "level"]
        constraints = [
            # One list per cohort per month. Two requests racing to build the month's first
            # pool both compute it; this is what makes the second one lose cleanly.
            models.UniqueConstraint(
                fields=["month", "subject", "level"], name="uniq_daily_question_pool"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.month:%Y-%m} {self.subject} {self.level}"


class DailyQuestionPoolItem(models.Model):
    pool = models.ForeignKey(DailyQuestionPool, on_delete=models.CASCADE, related_name="items")
    # PROTECT, like ``AssessmentAnswer.question``: every question here was answered in an
    # assessment, so it cannot be deleted anyway, and a list that silently shrank would
    # change what students are dealt mid-month.
    question = models.ForeignKey(
        "assessments.AssessmentQuestion", on_delete=models.PROTECT, related_name="+"
    )
    #: 1 = the hardest question of the month at this level.
    rank = models.PositiveSmallIntegerField()
    answers_count = models.PositiveIntegerField()
    correct_count = models.PositiveIntegerField()

    class Meta:
        db_table = "daily_question_pool_items"
        ordering = ["pool", "rank"]
        constraints = [
            models.UniqueConstraint(fields=["pool", "rank"], name="uniq_daily_question_pool_rank"),
            models.UniqueConstraint(
                fields=["pool", "question"], name="uniq_daily_question_pool_question"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.pool} #{self.rank} q{self.question_id}"

    @property
    def correct_percent(self) -> int:
        if not self.answers_count:
            return 0
        return round(100 * self.correct_count / self.answers_count)


class DailyQuestionAssignment(models.Model):
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="daily_questions"
    )
    #: The Tashkent date this question is for. It can be answered on that date only.
    date = models.DateField()
    subject = models.CharField(max_length=16, choices=AssessmentSet.SUBJECT_CHOICES)
    #: The level the student was dealt at — kept, because their class can change later.
    level = models.CharField(max_length=16, choices=AssessmentSet.LEVEL_CHOICES)
    #: The class the level was read from; the reward counts toward that class's board.
    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    pool = models.ForeignKey(DailyQuestionPool, on_delete=models.PROTECT, related_name="assignments")
    question = models.ForeignKey(
        "assessments.AssessmentQuestion", on_delete=models.PROTECT, related_name="+"
    )
    answer = models.JSONField(null=True, blank=True, default=None)
    is_correct = models.BooleanField(null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "daily_question_assignments"
        ordering = ["-date", "subject"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "date", "subject"], name="uniq_daily_question_per_day"
            ),
        ]
        indexes = [
            # "Which of this month's questions has this student already had?"
            models.Index(fields=["student", "subject", "date"], name="daily_q_student_month_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.student_id} {self.date} {self.subject} q{self.question_id}"

    @property
    def is_answered(self) -> bool:
        return self.answered_at is not None
