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
        return "MATHEMATICS" if self.subject == "MATH" else "ENGLISH"

    @property
    def subject_glyph(self) -> str:
        return "Σ" if self.subject == "MATH" else "A"  # Σ for Math

    @property
    def date_display(self) -> str:
        return self.issued_at.strftime("%B %d, %Y") if self.issued_at else ""

    @property
    def period_display(self) -> str:
        """The 'June 2026'-style round this certificate is for."""
        return self.issued_at.strftime("%B %Y") if self.issued_at else ""

    @property
    def tier_info(self) -> dict:
        """Tier-dependent wording for this score — the ONE source every renderer reads.

        The certificate is drawn by four independent renderers (reportlab, Chromium+HTML,
        and the React page, plus the two HTML templates they share). Each used to carry
        its own hard-coded "for outstanding performance" sentence, so a wording change had
        to land in seven files or the PDF and the on-screen card would disagree. They now
        all read this property, directly or through the API payload.
        """
        from midterms.outcomes import citation_for

        return citation_for(
            self.score,
            self.scoring_scale,
            period=self.period_display,
            subject=self.subject_label.title(),
        )


class PastpaperCertificate(models.Model):
    """One student's certificate for one completed pastpaper.

    Separate from ``MidtermCertificate`` rather than a third flavor on it, because almost
    nothing they hold is the same. A midterm certificate freezes a class rank against a
    cohort at a moment a teacher chose; a pastpaper is sat whenever the student likes, has no
    cohort, and is scored on the 200–800 SAT section scale rather than a midterm's 0–100 or
    0–800. Bolting a `PASTPAPER` flavor onto a model with a `midterm` FK, a `rank`, a
    `cohort_size` and three uniqueness constraints keyed on midterms would leave every one of
    them nullable-and-meaningless.

    **Issued automatically, on completion.** Nobody approves a pastpaper — the student sat it,
    they get their certificate. That is the whole difference in lifecycle, and it is why there
    is no `issued_by` here: the school issued it, not a person.

    Like its neighbour, this is a frozen snapshot and no PDF is stored. The error report
    printed alongside it is *not* frozen — it is re-derived from the attempt at download time
    (see ``pastpaper_report``), because an answer key correction has to reach a student who
    downloads their certificate afterwards.
    """

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pastpaper_certificates"
    )
    attempt = models.ForeignKey(
        "exams.TestAttempt", on_delete=models.CASCADE, related_name="certificates"
    )

    # Frozen at issue.
    student_name = models.CharField(max_length=200)
    paper_title = models.CharField(max_length=200)
    collection_name = models.CharField(max_length=200, blank=True, default="")
    subject = models.CharField(max_length=32, blank=True)
    score = models.IntegerField()

    # The report's headline numbers, frozen so the certificate face never disagrees with
    # itself between two downloads. The detail behind them is re-derived; these are what is
    # printed in large type.
    questions_total = models.PositiveIntegerField(default=0)
    questions_correct = models.PositiveIntegerField(default=0)

    code = models.CharField(max_length=32, unique=True, default=_new_code, db_index=True)
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pastpaper_certificates"
        ordering = ["-issued_at", "-id"]
        constraints = [
            # One certificate per attempt. A student who re-sits the same paper gets a second
            # attempt and therefore a second certificate, which is correct — they earned it
            # twice.
            models.UniqueConstraint(fields=["attempt"], name="uniq_pastpaper_cert_per_attempt"),
        ]
        indexes = [models.Index(fields=["student", "-issued_at"])]

    def __str__(self) -> str:
        return f"Pastpaper cert {self.code} student={self.student_id} score={self.score}"

    #: A pastpaper section is scored on the SAT scale, which starts at 200 rather than 0.
    SCORE_FLOOR = 200
    SCORE_CEILING = 800

    @property
    def number(self) -> str:
        year = self.issued_at.year if self.issued_at else 0
        return f"PP-{year}-{(self.pk or 0):04d}"

    @property
    def subject_label(self) -> str:
        return "MATHEMATICS" if (self.subject or "").upper().startswith("MATH") else "ENGLISH"

    @property
    def accuracy(self) -> float:
        if not self.questions_total:
            return 0.0
        return round(100.0 * self.questions_correct / self.questions_total, 1)

    @property
    def date_display(self) -> str:
        return self.issued_at.strftime("%B %d, %Y") if self.issued_at else ""

    @property
    def tier_info(self) -> dict:
        """Tier wording — the ONE source the PDF, the API and the React page all read.

        Borrows the midterm tier floors so the same performance is never praised differently
        by the two certificates, with pastpaper-specific sentences: the midterm citations name
        a midterm, which is simply false here.
        """
        from .pastpaper_certificate import tier_info_for

        return tier_info_for(self.score, paper=self.paper_title)
