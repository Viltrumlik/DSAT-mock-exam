"""Per-classroom midterm schedule + results-release state.

One row per ``(classroom, mock_exam)`` is the single source of truth for the teacher's
per-midterm control panel:

- **Access window** — ``starts_at`` gates when students may begin (a countdown shows until
  then), ``deadline`` gates when starting closes. ``ignore_start`` is the teacher's
  "open now" override that bypasses the start countdown.
- **Results release** — ``results_released`` hides each student's score until the teacher
  issues certificates (issuing flips this true). Before release, students only see that
  they submitted.

Enforcement is deliberately conditional on a schedule *existing*: a midterm with no
``MidtermSchedule`` behaves exactly as before (visible, startable, score shown on submit),
so legacy/unscheduled midterms are unaffected.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class MidtermSchedule(models.Model):
    """Access window + results-release control for one midterm in one classroom."""

    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.CASCADE, related_name="midterm_schedules"
    )
    # Legacy exams midterm (nullable — new schedules use ``midterm`` below). Backfilled by
    # the data migration; kept so in-flight legacy schedules keep working during the cutover.
    mock_exam = models.ForeignKey(
        "exams.MockExam", on_delete=models.CASCADE, null=True, blank=True, related_name="midterm_schedules"
    )
    midterm = models.ForeignKey(
        "midterms.Midterm", on_delete=models.CASCADE, null=True, blank=True, related_name="schedules"
    )

    # Access window (both optional). ignore_start overrides the start countdown.
    starts_at = models.DateTimeField(null=True, blank=True)
    deadline = models.DateTimeField(null=True, blank=True)
    ignore_start = models.BooleanField(
        default=False, help_text="Teacher override: open immediately, ignoring starts_at."
    )

    # Access code — a 6-digit numeric code a student must enter to begin. Blank =
    # no code required (backwards compatible). The teacher generates/rotates it
    # from the control panel via the "Start midterm" action.
    access_code = models.CharField(max_length=6, blank=True, default="", db_index=True)
    access_code_set_at = models.DateTimeField(null=True, blank=True)

    # Results release (issuing certificates flips this true).
    results_released = models.BooleanField(default=False, db_index=True)
    results_released_at = models.DateTimeField(null=True, blank=True)
    released_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "classroom_midterm_schedules"
        constraints = [
            models.UniqueConstraint(
                fields=["classroom", "mock_exam"], name="uniq_midterm_schedule_per_classroom"
            ),
            models.UniqueConstraint(
                fields=["classroom", "midterm"], name="uniq_midterm_schedule_per_classroom_v2"
            ),
        ]
        indexes = [
            models.Index(fields=["mock_exam", "classroom"]),
            models.Index(fields=["midterm", "classroom"]),
        ]

    def __str__(self) -> str:
        ref = self.midterm_id or self.mock_exam_id
        return f"Schedule classroom={self.classroom_id} midterm={ref}"

    # ── Window helpers ────────────────────────────────────────────────────────
    def is_before_start(self, now=None) -> bool:
        """True when the start countdown is still running (student cannot begin yet)."""
        if self.ignore_start or self.starts_at is None:
            return False
        return self.starts_at > (now or timezone.now())

    def is_past_deadline(self, now=None) -> bool:
        if self.deadline is None:
            return False
        return self.deadline <= (now or timezone.now())

    def is_open(self, now=None) -> bool:
        """True when a student may start the midterm right now."""
        now = now or timezone.now()
        if self.is_past_deadline(now):
            return False
        if self.ignore_start:
            return True
        return self.starts_at is None or self.starts_at <= now

    # ── Access code ───────────────────────────────────────────────────────────
    def requires_code(self) -> bool:
        """True when students must enter an access code to begin this midterm."""
        return bool(self.access_code)

    def code_matches(self, code) -> bool:
        return bool(self.access_code) and str(code or "").strip() == self.access_code

    def generate_access_code(self, now=None) -> str:
        """Set (or rotate) a random 6-digit numeric access code and return it."""
        import secrets

        self.access_code = f"{secrets.randbelow(1_000_000):06d}"
        self.access_code_set_at = now or timezone.now()
        return self.access_code

    @property
    def available_at(self):
        """The instant a student can begin, for rendering a countdown.

        ``None`` means it is open now (no future start gate).
        """
        if self.ignore_start or self.starts_at is None:
            return None
        return self.starts_at
