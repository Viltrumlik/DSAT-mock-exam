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
    """One student's certificate for one midterm.

    Two flavors: CLASSROOM (class-ranked, issued on teacher publish) and STANDALONE
    (per-student grant, auto-issued on submit, instructor = grantor, NO rank). The legacy
    ``mock_exam``/``attempt`` FKs (exams system) stay for in-flight legacy certs and are
    backfilled onto ``midterm``/``midterm_attempt`` by the data migration; the ``code`` +
    PK are preserved so existing ``/certificate/<code>`` links keep resolving.
    """

    FLAVOR_CLASSROOM = "CLASSROOM"
    FLAVOR_STANDALONE = "STANDALONE"
    FLAVOR_CHOICES = [(FLAVOR_CLASSROOM, "Classroom"), (FLAVOR_STANDALONE, "Standalone")]

    flavor = models.CharField(max_length=16, choices=FLAVOR_CHOICES, default=FLAVOR_CLASSROOM, db_index=True)

    # Nullable: standalone certs have no classroom; new certs have no legacy MockExam.
    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.CASCADE, null=True, blank=True, related_name="midterm_certificates"
    )
    mock_exam = models.ForeignKey(
        "exams.MockExam", on_delete=models.CASCADE, null=True, blank=True, related_name="midterm_certificates"
    )
    # New separated midterm this certificate belongs to.
    midterm = models.ForeignKey(
        "midterms.Midterm", on_delete=models.CASCADE, null=True, blank=True, related_name="certificates"
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="midterm_certificates"
    )
    # The completed attempt the certificate was computed from (kept for traceability).
    attempt = models.ForeignKey(
        "exams.TestAttempt", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    midterm_attempt = models.ForeignKey(
        "midterms.MidtermAttempt", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Frozen snapshot at issue time — the certificate prints from these, not live data.
    student_name = models.CharField(max_length=200)
    midterm_title = models.CharField(max_length=200)
    subject = models.CharField(max_length=32, blank=True)
    score = models.IntegerField()
    scoring_scale = models.CharField(max_length=16, blank=True)
    # Nullable: standalone certificates carry no class rank / cohort.
    rank = models.PositiveIntegerField(null=True, blank=True)
    cohort_size = models.PositiveIntegerField(null=True, blank=True)

    code = models.CharField(max_length=32, unique=True, default=_new_code, db_index=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    # Snapshot of the issuing teacher's name at issue time (printed as INSTRUCTOR).
    issued_by_name = models.CharField(max_length=200, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "classroom_midterm_certificates"
        constraints = [
            # Legacy (exams MockExam) — retained so existing rows stay protected.
            models.UniqueConstraint(
                fields=["classroom", "mock_exam", "student"],
                name="uniq_midterm_certificate_per_student",
            ),
            # New CLASSROOM flavor: one class-ranked cert per (classroom, midterm, student).
            models.UniqueConstraint(
                fields=["classroom", "midterm", "student"],
                condition=models.Q(flavor="CLASSROOM"),
                name="uniq_midterm_cert_classroom",
            ),
            # New STANDALONE flavor: one cert per (midterm, student), no classroom.
            models.UniqueConstraint(
                fields=["midterm", "student"],
                condition=models.Q(flavor="STANDALONE"),
                name="uniq_midterm_cert_standalone",
            ),
        ]
        indexes = [
            models.Index(fields=["mock_exam", "student"]),
            models.Index(fields=["classroom", "mock_exam"]),
            models.Index(fields=["midterm", "student"]),
        ]
        # Nulls last so standalone certs (rank=None) sort after ranked ones.
        ordering = [models.F("rank").asc(nulls_last=True), "flavor"]

    def __str__(self) -> str:
        where = f"midterm={self.midterm_id}" if self.midterm_id else f"mock_exam={self.mock_exam_id}"
        rank = f"#{self.rank}/{self.cohort_size}" if self.rank is not None else "(standalone)"
        return f"Cert {rank} student={self.student_id} {where}"

    @property
    def score_ceiling(self) -> int:
        # SCALE_800 midterms print out of 800; everything else is the 0–100 scale.
        # Compare the stored string (identical across exams.MockExam + midterms.Midterm) so a
        # migrated cert prints its correct ceiling without importing the legacy exams model.
        return 800 if self.scoring_scale == "SCALE_800" else 100

    def score_display(self) -> str:
        return f"{self.score} / {self.score_ceiling}"

    @property
    def number(self) -> str:
        """Human certificate number, e.g. 'MS-2026-0417'."""
        year = self.issued_at.year if self.issued_at else 0
        return f"MS-{year}-{(self.pk or 0):04d}"

    @property
    def subject_label(self) -> str:
        return "MATHEMATICS" if self.subject == "MATH" else "READING & WRITING"

    @property
    def subject_glyph(self) -> str:
        return "Σ" if self.subject == "MATH" else "A"  # Σ for Math

    @property
    def date_display(self) -> str:
        return self.issued_at.strftime("%B %d, %Y") if self.issued_at else ""
