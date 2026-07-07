"""Midterm certificate model — teacher-issued, student-downloadable PDF records.

A certificate freezes a student's standing on one interactive midterm
(``exams.MockExam`` kind=MIDTERM) within one classroom: their score, their class rank
and the cohort size at issue time. The teacher triggers issuance from the classroom
midterm panel once every assigned student has finished; issuing certificates also
releases the results (see [[MidtermSchedule]]) so students can finally see their score.

Snapshots are intentional — scores/ranks elsewhere may later be recomputed, but a
printed certificate must stay stable. PDFs are rendered on demand from these fields
(see ``classes/certificate_pdf.py``); nothing is stored on disk.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


def _new_code() -> str:
    return uuid.uuid4().hex


class MidtermCertificate(models.Model):
    """One student's certificate for one midterm within one classroom."""

    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.CASCADE, related_name="midterm_certificates"
    )
    mock_exam = models.ForeignKey(
        "exams.MockExam", on_delete=models.CASCADE, related_name="midterm_certificates"
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="midterm_certificates"
    )
    # The completed attempt the certificate was computed from (kept for traceability).
    attempt = models.ForeignKey(
        "exams.TestAttempt", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Frozen snapshot at issue time — the certificate prints from these, not live data.
    student_name = models.CharField(max_length=200)
    midterm_title = models.CharField(max_length=200)
    subject = models.CharField(max_length=32, blank=True)
    score = models.IntegerField()
    scoring_scale = models.CharField(max_length=16, blank=True)
    rank = models.PositiveIntegerField()
    cohort_size = models.PositiveIntegerField()

    code = models.CharField(max_length=32, unique=True, default=_new_code, db_index=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "classroom_midterm_certificates"
        constraints = [
            models.UniqueConstraint(
                fields=["classroom", "mock_exam", "student"],
                name="uniq_midterm_certificate_per_student",
            )
        ]
        indexes = [
            models.Index(fields=["mock_exam", "student"]),
            models.Index(fields=["classroom", "mock_exam"]),
        ]
        ordering = ["rank"]

    def __str__(self) -> str:
        return f"Cert #{self.rank}/{self.cohort_size} student={self.student_id} midterm={self.mock_exam_id}"

    @property
    def score_ceiling(self) -> int:
        # SCALE_800 midterms print out of 800; everything else is the 0–100 scale.
        from exams.models import MockExam

        return 800 if self.scoring_scale == MockExam.SCALE_800 else 100

    def score_display(self) -> str:
        return f"{self.score} / {self.score_ceiling}"
