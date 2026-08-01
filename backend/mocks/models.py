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
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

from .engine_db_guard import TransitionConflict, conditional_mock_attempt_update
from .state_machine import (
    ACTIVE_MODULE,
    STATE_ABANDONED,
    STATE_BREAK,
    STATE_CHOICES,
    STATE_COMPLETED,
    STATE_ENGLISH_M2,
    STATE_MATH_M1,
    STATE_MATH_M2,
    STATE_NOT_STARTED,
    STATE_SCORING,
    assert_transition_allowed,
)
from .state_machine import STATE_ENGLISH_M1

# Which state a module submission advances to.
_NEXT_SUBMIT = {
    STATE_ENGLISH_M1: STATE_ENGLISH_M2,
    STATE_ENGLISH_M2: STATE_BREAK,
    STATE_MATH_M1: STATE_MATH_M2,
    STATE_MATH_M2: STATE_SCORING,
}
# States whose entry is timer-anchored in phase_started_at.
_ANCHORED_ON_ENTRY = {STATE_ENGLISH_M2, STATE_MATH_M2, STATE_BREAK}

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


@receiver(post_delete, sender=MockSection)
def _delete_section_modules(sender, instance, **kwargs):
    """A section OWNS its two ``exams.Module`` rows, so they die with it.

    This is a signal rather than a ``MockSection.delete()`` override because the override
    never ran on the path that matters: deleting a Mock cascades through Django's collector,
    which issues bulk deletes and skips model ``delete()`` entirely. Every deleted mock was
    therefore leaving four orphan Modules — and every Question on them — behind forever,
    unreachable from any UI. ``post_delete`` fires for cascades too, so both paths converge
    here. The rows are already gone by now, so the module FKs' PROTECT can't fire.
    """
    from exams.models import Module

    ids = [i for i in (instance.module1_id, instance.module2_id) if i is not None]
    if ids:
        Module.objects.filter(pk__in=ids).delete()


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
    # A mock offers NO pause button. But if the student's tab dies — power cut, dropped
    # connection, a misclick — the wall clock would keep burning a module they cannot see,
    # so leaving freezes it and returning starts it again. {state: seconds} banked per
    # phase, mirroring phase_started_at; ``pause_started_at`` is the open window (at most
    # one, since a student is only ever in one phase). The BREAK is deliberately NOT
    # pausable: it is time away from the screen by definition, and freezing it would let a
    # student stretch a 10-minute break into an afternoon.
    paused_seconds = models.JSONField(default=dict, blank=True)
    pause_started_at = models.DateTimeField(null=True, blank=True)

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

    # ── timing ────────────────────────────────────────────────────────────────
    def get_timing(self, *, now=None):
        from .timing import get_active_module_timing

        return get_active_module_timing(self, now=now)

    def get_break_timing(self, *, now=None):
        from .timing import get_break_timing

        return get_break_timing(self, now=now)

    # ── merge helpers (never blank persisted work) ─────────────────────────────
    def _merge_answers(self, module_id, incoming):
        ma = dict(self.module_answers or {})
        inner = dict(ma.get(str(module_id), {}))
        if incoming:
            for k, v in incoming.items():
                inner[str(k)] = v
        ma[str(module_id)] = inner
        return ma

    def _merge_flagged(self, module_id, incoming):
        fl = dict(self.flagged or {})
        if incoming is not None:
            fl[str(module_id)] = list(incoming)
        return fl

    # ── pause bookkeeping ─────────────────────────────────────────────────────
    def _bank_pause(self, state, now):
        """Close the open pause window into ``state``'s banked total.

        Every phase transition MUST call this for the phase it is LEAVING. A pause
        carried across a boundary is the bug that bit pastpapers: ``pause_started_at``
        stayed set through module 2's start, so module 2 opened already frozen and its
        timer never moved.
        """
        banked = dict(self.paused_seconds or {})
        if self.pause_started_at:
            spent = max(0, int((now - self.pause_started_at).total_seconds()))
            banked[state] = int(banked.get(state, 0) or 0) + spent
        return banked

    def pause(self) -> bool:
        """Freeze the active module's clock. Idempotent; never applies to the break."""
        state = self.current_state
        if state not in _NEXT_SUBMIT:
            return False  # not on a timed module (break / scoring / completed)
        if self.pause_started_at is not None:
            return False  # already frozen
        ts = timezone.now()
        n = MockAttempt.objects.filter(pk=self.pk, current_state=state, pause_started_at__isnull=True).update(
            pause_started_at=ts, updated_at=ts
        )
        if n == 0:
            self.refresh_from_db()
            return False
        self.pause_started_at = ts
        return True

    def resume_pause(self) -> bool:
        """Bank the open pause window and start the clock again. Idempotent."""
        if self.pause_started_at is None:
            return False
        ts = timezone.now()
        state = self.current_state
        banked = self._bank_pause(state, ts)
        n = MockAttempt.objects.filter(pk=self.pk, pause_started_at__isnull=False).update(
            paused_seconds=banked, pause_started_at=None, updated_at=ts
        )
        if n == 0:
            self.refresh_from_db()
            return False
        self.paused_seconds = banked
        self.pause_started_at = None
        return True

    # ── transitions (caller holds a select_for_update lock) ────────────────────
    def start_attempt(self) -> bool:
        """NOT_STARTED -> ENGLISH_M1. Idempotent once already past NOT_STARTED."""
        if self.current_state != STATE_NOT_STARTED:
            return False
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        anchor = dict(self.phase_started_at or {})
        anchor[STATE_ENGLISH_M1] = anchor.get(STATE_ENGLISH_M1) or ts.isoformat()
        n = conditional_mock_attempt_update(
            pk=int(self.pk), expect_state=STATE_NOT_STARTED, expect_version=v0,
            updates={"current_state": STATE_ENGLISH_M1, "phase_started_at": anchor, "version_number": v0 + 1, "updated_at": ts},
        )
        if n == 0:
            self.refresh_from_db()
            if self.current_state != STATE_NOT_STARTED:
                return False
            raise TransitionConflict(f"start lost CAS for mock attempt {self.pk}")
        self.refresh_from_db()
        return True

    def submit_module(self, *, answers=None, flagged=None) -> bool:
        """Advance the active module: E1->E2, E2->BREAK, M1->M2, M2->SCORING."""
        state = self.current_state
        to_state = _NEXT_SUBMIT.get(state)
        if to_state is None:
            return False  # not on a submittable module (break / scoring / completed) — idempotent
        active = self.mock.active_module(state)
        merged = self._merge_answers(active.id, answers) if active else dict(self.module_answers or {})
        merged_fl = self._merge_flagged(active.id, flagged) if active else dict(self.flagged or {})
        assert_transition_allowed(state, to_state)
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        anchor = dict(self.phase_started_at or {})
        if to_state in _ANCHORED_ON_ENTRY:
            anchor[to_state] = anchor.get(to_state) or ts.isoformat()
        updates = {
            "module_answers": merged, "flagged": merged_fl, "current_state": to_state,
            "phase_started_at": anchor, "version_number": v0 + 1, "updated_at": ts,
            # The module being left owns whatever pause was open; the next one starts
            # running. Carrying pause_started_at across the boundary would open module 2
            # already frozen.
            "paused_seconds": self._bank_pause(state, ts), "pause_started_at": None,
        }
        if to_state == STATE_SCORING:
            updates["scoring_started_at"] = ts
            updates["submitted_at"] = ts
        n = conditional_mock_attempt_update(pk=int(self.pk), expect_state=state, expect_version=v0, updates=updates)
        if n == 0:
            self.refresh_from_db()
            return False  # someone else advanced us — idempotent
        self.refresh_from_db()
        return True

    def end_break(self) -> bool:
        """BREAK -> MATH_M1 (student proceeds, or the break timer elapsed). Idempotent."""
        if self.current_state != STATE_BREAK:
            return False
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        anchor = dict(self.phase_started_at or {})
        anchor[STATE_MATH_M1] = anchor.get(STATE_MATH_M1) or ts.isoformat()
        n = conditional_mock_attempt_update(
            pk=int(self.pk), expect_state=STATE_BREAK, expect_version=v0,
            updates={
                "current_state": STATE_MATH_M1, "phase_started_at": anchor,
                "version_number": v0 + 1, "updated_at": ts,
                # Math starts running. The break is never pausable, so there should be no
                # open window here — clearing it is belt-and-braces against a stale one.
                "pause_started_at": None,
            },
        )
        if n == 0:
            self.refresh_from_db()
            return False
        self.refresh_from_db()
        return True

    def autosave(self, *, answers=None, flagged=None) -> bool:
        """Persist merged answers on the active module (no state change)."""
        state = self.current_state
        if state not in _NEXT_SUBMIT:
            return False
        active = self.mock.active_module(state)
        if active is None:
            return False
        merged = self._merge_answers(active.id, answers)
        merged_fl = self._merge_flagged(active.id, flagged)
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        n = MockAttempt.objects.filter(pk=self.pk, current_state=state, version_number=v0).update(
            module_answers=merged, flagged=merged_fl, version_number=v0 + 1, updated_at=ts
        )
        if n == 0:
            self.refresh_from_db()
            return False
        self.module_answers = merged
        self.flagged = merged_fl
        self.version_number = v0 + 1
        return True

    def complete(self) -> bool:
        """SCORING -> COMPLETED, freezing english/math/total scores. Idempotent."""
        if self.is_completed or self.current_state == STATE_COMPLETED:
            return False
        assert_transition_allowed(self.current_state, STATE_COMPLETED)
        result = self.grade()
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        n = conditional_mock_attempt_update(
            pk=int(self.pk), expect_state=STATE_SCORING, expect_version=v0,
            updates={
                "english_score": int(result["english_score"]), "math_score": int(result["math_score"]),
                "total_score": int(result["total_score"]), "current_state": STATE_COMPLETED,
                "is_completed": True, "completed_at": ts, "version_number": v0 + 1, "updated_at": ts,
                "pause_started_at": None,  # the paper is over; nothing left to freeze
            },
        )
        if n == 0:
            self.refresh_from_db()
            if self.current_state == STATE_COMPLETED:
                return False
            raise TransitionConflict(f"complete lost CAS for mock attempt {self.pk}")
        self.refresh_from_db()
        return True


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
