"""Midterm data models + single-module attempt engine.

A midterm is a strictly-timed, single-module, no-calculator, no-pause, no-retake exam
scored on a 100 or 800 scale. It reuses ``exams.Question`` (content + grading + dense
ordering + rendering) hung off ONE ``exams.Module`` (``module_order=1``) owned by the
Midterm; nothing else is shared with the mock/pastpaper code paths.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import models
from django.utils import timezone

from .engine_db_guard import TransitionConflict, conditional_midterm_attempt_update
from .scoring import SCALE_100, SCALE_800
from .state_machine import (
    STATE_ABANDONED,
    STATE_ACTIVE,
    STATE_CHOICES,
    STATE_COMPLETED,
    STATE_NOT_STARTED,
    STATE_SCORING,
    TransitionNotAllowed,
    assert_primary_transition_allowed,
)

logger = logging.getLogger(__name__)


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Midterm(TimestampedModel):
    """A single-module timed exam definition (staff-authored)."""

    READING_WRITING = "READING_WRITING"
    MATH = "MATH"
    SUBJECT_CHOICES = [
        (READING_WRITING, "Reading & Writing"),
        (MATH, "Math"),
    ]

    # String values IDENTICAL to exams.MockExam.SCALE_* so re-homed certificate
    # score_ceiling logic (which stored the string) keeps printing the right ceiling.
    SCALE_100 = SCALE_100
    SCALE_800 = SCALE_800
    SCALE_CHOICES = [
        (SCALE_100, "100-point (percentage)"),
        (SCALE_800, "800-point (SAT scaled)"),
    ]

    # Structural invariants — a midterm never offers these. Kept as class attributes
    # (not fields/toggles) so they cannot be authored on; serializers may echo them.
    CALCULATOR_ENABLED = False
    REFERENCE_SHEET_ENABLED = False
    PAUSE_ENABLED = False

    title = models.CharField(max_length=255, db_index=True)
    subject = models.CharField(max_length=20, choices=SUBJECT_CHOICES, default=READING_WRITING, db_index=True)
    scoring_scale = models.CharField(max_length=16, choices=SCALE_CHOICES, default=SCALE_100)
    duration_minutes = models.PositiveIntegerField(default=60, help_text="Single-module strict timer.")
    question_limit = models.PositiveSmallIntegerField(default=30, help_text="Authoring cap on question count.")

    # The single question container: one exams.Module (module_order=1) with
    # practice_test=NULL. Questions are exams.Question rows on this module, so the
    # entire dense-ordering / reorder / unique(module,order) machinery is reused.
    question_module = models.OneToOneField(
        "exams.Module",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="midterm",
        help_text="Owned exams.Module holding this midterm's questions.",
    )

    is_published = models.BooleanField(default=False, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Idempotency anchor for the post-deploy migration of legacy MockExam(kind=MIDTERM).
    legacy_mock_exam_id = models.BigIntegerField(null=True, blank=True, unique=True, db_index=True)

    class Meta:
        db_table = "midterms_midterm"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Midterm #{self.pk}: {self.title}"

    @property
    def module(self):
        return self.question_module

    def questions(self):
        """Ordered queryset of this midterm's exams.Question rows (empty if unprovisioned)."""
        from exams.models import Question

        if not self.question_module_id:
            return Question.objects.none()
        return Question.objects.filter(module_id=self.question_module_id).order_by("order", "id")

    @property
    def score_ceiling(self) -> int:
        return 800 if self.scoring_scale == self.SCALE_800 else 100

    def delete(self, *args, **kwargs):
        # PROTECT stops the owned Module being deleted out from under a live midterm; on
        # midterm deletion we remove the Midterm first, then its module (cascading Questions).
        mod = self.question_module
        result = super().delete(*args, **kwargs)
        if mod is not None:
            mod.delete()
        return result


class MidtermAttempt(TimestampedModel):
    """One student's attempt at a midterm — own single-timer state machine."""

    STATE_NOT_STARTED = STATE_NOT_STARTED
    STATE_ACTIVE = STATE_ACTIVE
    STATE_SCORING = STATE_SCORING
    STATE_COMPLETED = STATE_COMPLETED
    STATE_ABANDONED = STATE_ABANDONED
    STATE_CHOICES = STATE_CHOICES

    midterm = models.ForeignKey(Midterm, on_delete=models.CASCADE, related_name="attempts", db_index=True)
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="midterm_attempts", db_index=True
    )
    # FLAT { str(question_id): answer } — single module, no module nesting.
    answers = models.JSONField(default=dict, blank=True)
    flagged = models.JSONField(default=list, blank=True)

    current_state = models.CharField(
        max_length=24, choices=STATE_CHOICES, default=STATE_NOT_STARTED, db_index=True
    )
    version_number = models.PositiveIntegerField(default=0, db_index=True)
    is_completed = models.BooleanField(default=False, db_index=True)
    score = models.IntegerField(null=True, blank=True)

    # Set once the student enters the correct classroom access code (if one is
    # required). start() refuses until this is set when the schedule has a code.
    code_verified_at = models.DateTimeField(null=True, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)  # single timer anchor, written `or now`, never rewound
    scoring_started_at = models.DateTimeField(null=True, blank=True, db_index=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # Idempotency anchor for the post-deploy migration of legacy exams.TestAttempt.
    legacy_test_attempt_id = models.BigIntegerField(null=True, blank=True, unique=True, db_index=True)

    class Meta:
        db_table = "midterms_attempt"
        constraints = [
            models.UniqueConstraint(
                fields=["student", "midterm"],
                condition=models.Q(is_completed=False) & ~models.Q(current_state=STATE_ABANDONED),
                name="uniq_active_midterm_attempt_per_student",
            ),
        ]
        indexes = [
            models.Index(fields=["midterm", "student"]),
            models.Index(fields=["current_state"]),
            models.Index(fields=["scoring_started_at"]),
        ]

    def __str__(self):
        return f"MidtermAttempt #{self.pk} (midterm={self.midterm_id}, student={self.student_id}, {self.current_state})"

    # ── merge helpers (answer-loss safety: never blank persisted work) ────────
    def _merge_answers(self, incoming) -> dict:
        base = dict(self.answers or {})
        if incoming:
            for k, v in incoming.items():
                base[str(k)] = v
        return base

    def _merge_flagged(self, incoming):
        # The client is authoritative for its full flag set; replace when provided.
        if incoming is None:
            return list(self.flagged or [])
        return list(incoming)

    # ── invariants + audit ───────────────────────────────────────────────────
    def _assert_invariants(self):
        if self.current_state == STATE_ACTIVE and not self.started_at:
            raise TransitionNotAllowed(f"midterm attempt {self.pk} ACTIVE without started_at anchor")
        if self.is_completed and self.current_state != STATE_COMPLETED:
            raise TransitionNotAllowed(f"midterm attempt {self.pk} is_completed but state={self.current_state}")

    def _log(self, event, *, from_state, detail=None):
        if not getattr(settings, "MIDTERM_ENGINE_AUDIT_DB", True):
            return
        try:
            MidtermAttemptEngineAudit.objects.create(
                attempt=self,
                event=str(event),
                from_state=str(from_state or ""),
                to_state=str(self.current_state or ""),
                version_number=int(self.version_number or 0),
                detail=detail or {},
            )
        except Exception:  # audit must never break a transition
            logger.exception("midterm engine audit write failed for attempt %s", self.pk)

    # ── timing ───────────────────────────────────────────────────────────────
    def get_timing(self, *, now=None):
        from .timing import get_midterm_timing

        return get_midterm_timing(self, now=now)

    def compute_is_expired(self, *, now=None) -> bool:
        timing = self.get_timing(now=now)
        return bool(timing and timing.is_expired)

    # ── transitions (each caller is expected to hold a select_for_update lock) ─
    def start_attempt(self) -> bool:
        """NOT_STARTED -> ACTIVE. Idempotent no-op once ACTIVE/SCORING/COMPLETED."""
        if self.current_state in (STATE_ACTIVE, STATE_SCORING, STATE_COMPLETED):
            return False
        if self.current_state != STATE_NOT_STARTED:
            raise TransitionNotAllowed(f"cannot start midterm attempt {self.pk} from {self.current_state}")
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        started = self.started_at or ts
        n = conditional_midterm_attempt_update(
            pk=int(self.pk),
            expect_state=STATE_NOT_STARTED,
            expect_version=v0,
            updates={
                "current_state": STATE_ACTIVE,
                "started_at": started,
                "version_number": v0 + 1,
                "updated_at": ts,
            },
        )
        if n == 0:
            self.refresh_from_db()
            if self.current_state in (STATE_ACTIVE, STATE_SCORING, STATE_COMPLETED):
                return False
            raise TransitionConflict(f"start lost CAS for midterm attempt {self.pk} (now {self.current_state})")
        self.refresh_from_db()
        self._assert_invariants()
        self._log("start", from_state=STATE_NOT_STARTED)
        return True

    def autosave(self, *, answers=None, flagged=None) -> bool:
        """Persist merged answers/flags while ACTIVE (no state change). Never blanks saved work."""
        if self.current_state != STATE_ACTIVE:
            return False
        merged = self._merge_answers(answers)
        merged_flags = self._merge_flagged(flagged)
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        from .models import MidtermAttempt as _MA  # local ref for the raw update

        n = _MA.objects.filter(pk=self.pk, current_state=STATE_ACTIVE, version_number=v0).update(
            answers=merged, flagged=merged_flags, version_number=v0 + 1, updated_at=ts
        )
        if n == 0:
            self.refresh_from_db()
            return False
        self.answers = merged
        self.flagged = merged_flags
        self.version_number = v0 + 1
        return True

    def submit(self, *, answers=None, flagged=None) -> bool:
        """ACTIVE -> SCORING, persisting merged answers. Idempotent once SCORING/COMPLETED."""
        if self.current_state in (STATE_SCORING, STATE_COMPLETED):
            return False
        assert_primary_transition_allowed(self.current_state, STATE_SCORING)
        merged = self._merge_answers(answers)
        merged_flags = self._merge_flagged(flagged)
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        n = conditional_midterm_attempt_update(
            pk=int(self.pk),
            expect_state=STATE_ACTIVE,
            expect_version=v0,
            updates={
                "answers": merged,
                "flagged": merged_flags,
                "current_state": STATE_SCORING,
                "scoring_started_at": ts,
                "submitted_at": ts,
                "version_number": v0 + 1,
                "updated_at": ts,
            },
        )
        if n == 0:
            self.refresh_from_db()
            if self.current_state in (STATE_SCORING, STATE_COMPLETED):
                return False
            raise TransitionConflict(f"submit lost CAS for midterm attempt {self.pk} (now {self.current_state})")
        self.refresh_from_db()
        self._assert_invariants()
        self._log("submit", from_state=STATE_ACTIVE)
        return True

    def complete(self) -> bool:
        """SCORING -> COMPLETED, computing + freezing the score. Idempotent once COMPLETED."""
        if self.is_completed or self.current_state == STATE_COMPLETED:
            return False
        assert_primary_transition_allowed(self.current_state, STATE_COMPLETED)
        from .scoring import score_midterm_attempt

        result = score_midterm_attempt(self)
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        n = conditional_midterm_attempt_update(
            pk=int(self.pk),
            expect_state=STATE_SCORING,
            expect_version=v0,
            updates={
                "score": int(result["score"]),
                "current_state": STATE_COMPLETED,
                "is_completed": True,
                "completed_at": ts,
                "version_number": v0 + 1,
                "updated_at": ts,
            },
        )
        if n == 0:
            self.refresh_from_db()
            if self.current_state == STATE_COMPLETED:
                return False
            raise TransitionConflict(f"complete lost CAS for midterm attempt {self.pk} (now {self.current_state})")
        self.refresh_from_db()
        self._assert_invariants()
        self._log("complete", from_state=STATE_SCORING, detail={"score": int(result["score"])})
        return True


class MidtermAttemptIdempotencyKey(models.Model):
    """Replay store for mutating midterm-attempt endpoints (mirrors exams.AttemptIdempotencyKey)."""

    attempt = models.ForeignKey(MidtermAttempt, on_delete=models.CASCADE, related_name="idempotency_keys")
    endpoint = models.CharField(max_length=64, db_index=True)
    key = models.CharField(max_length=128, db_index=True)
    response_status = models.PositiveSmallIntegerField(default=200)
    response_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        db_table = "midterms_attempt_idempotency_keys"
        constraints = [
            models.UniqueConstraint(fields=["attempt", "endpoint", "key"], name="uniq_midterm_attempt_endpoint_key"),
        ]


class MidtermAttemptEngineAudit(models.Model):
    """Append-only transition log (mirrors exams.AttemptEngineAudit)."""

    attempt = models.ForeignKey(MidtermAttempt, on_delete=models.CASCADE, related_name="engine_audit")
    event = models.CharField(max_length=64)
    from_state = models.CharField(max_length=24, blank=True)
    to_state = models.CharField(max_length=24, blank=True)
    version_number = models.PositiveIntegerField(default=0)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "midterms_attempt_engine_audit"
