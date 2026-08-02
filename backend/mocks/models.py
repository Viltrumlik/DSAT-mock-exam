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


class MockSession(TimestampedModel):
    """One invigilated sitting of a Mock: a code, an approved room, and a single Start.

    A mock is visible to every student the moment it is published, but seeing it is not the
    same as being allowed to sit it. A session is the sitting itself:

        admin creates it for a day and hands out the 6-digit code
        -> student types the code and REQUESTS a place
        -> teacher approves the request
        -> teacher presses Start and the paper opens for the whole room at once

    Separate from the practice path on purpose. A solo attempt (``MockAttempt.session`` is
    NULL) stays exactly as it was — open, unproctored, sat whenever the student likes — so
    adding invigilation did not take practice away.
    """

    STATUS_OPEN = "OPEN"          # accepting join requests
    STATUS_STARTED = "STARTED"    # the paper is open for the approved room
    STATUS_ENDED = "ENDED"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open for requests"),
        (STATUS_STARTED, "Started"),
        (STATUS_ENDED, "Ended"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    mock = models.ForeignKey(Mock, on_delete=models.CASCADE, related_name="sessions", db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    # "A session for one day": the code is only good on this date, so yesterday's code
    # cannot walk into today's sitting.
    session_date = models.DateField(db_index=True)

    access_code = models.CharField(max_length=6, blank=True, default="", db_index=True)
    access_code_set_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True)
    # The admin owns the session; the teaching team runs it (approve + Start).
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    classroom = models.ForeignKey(
        "classes.Classroom", on_delete=models.SET_NULL, null=True, blank=True, related_name="mock_sessions",
        help_text="Which room runs it. Blank = any teacher on the platform may run it.",
    )

    started_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "mocks_session"
        ordering = ["-session_date", "-created_at"]
        indexes = [
            models.Index(fields=["access_code", "session_date"]),
            models.Index(fields=["status", "session_date"]),
        ]

    def __str__(self):
        return f"MockSession #{self.pk} ({self.mock_id}, {self.session_date}, {self.status})"

    @property
    def display_title(self) -> str:
        return self.title or (self.mock.title if self.mock_id else "Mock session")

    def generate_access_code(self, now=None) -> str:
        """Set (or rotate) the 6-digit code. Does NOT save — the caller does."""
        import secrets

        self.access_code = f"{secrets.randbelow(1_000_000):06d}"
        self.access_code_set_at = now or timezone.now()
        return self.access_code

    def code_matches(self, code) -> bool:
        return bool(self.access_code) and str(code or "").strip() == self.access_code

    def accepts_requests(self, today=None) -> bool:
        """Whether a student may still ask for a place.

        Requests close when the room starts — a latecomer joining a running sitting would
        get a clock that had already been running without them.
        """
        today = today or timezone.localdate()
        return self.status == self.STATUS_OPEN and self.session_date == today

    @property
    def is_running(self) -> bool:
        return self.status == self.STATUS_STARTED


class MockSessionParticipant(TimestampedModel):
    """One student's place in a session: requested, decided, and (once started) their paper.

    The approval queue is the first of its kind in this codebase — classroom join codes let
    a student in instantly and resource grants have no pending state — so the shape is
    deliberately plain: one row per (session, student), a status, and who decided it.
    """

    STATUS_PENDING = "PENDING"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Waiting for approval"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    session = models.ForeignKey(MockSession, on_delete=models.CASCADE, related_name="participants")
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mock_session_places"
    )
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)

    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Written when the room starts. One paper per place.
    attempt = models.ForeignKey(
        "mocks.MockAttempt", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "mocks_session_participant"
        ordering = ["requested_at"]
        constraints = [
            models.UniqueConstraint(fields=["session", "student"], name="uniq_mock_session_place"),
        ]
        indexes = [models.Index(fields=["session", "status"])]

    def __str__(self):
        return f"MockSessionParticipant(session={self.session_id}, student={self.student_id}, {self.status})"


class MockAttempt(TimestampedModel):
    """One student's run through a full mock — 4 modules + break, one object."""

    STATE_CHOICES = STATE_CHOICES

    mock = models.ForeignKey(Mock, on_delete=models.CASCADE, related_name="attempts", db_index=True)
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mock_attempts", db_index=True
    )
    # NULL = solo practice, sat whenever the student likes and not invigilated. Set = an
    # invigilated sitting, which is what turns the off-screen rule on (``is_proctored``).
    session = models.ForeignKey(
        MockSession, on_delete=models.CASCADE, null=True, blank=True, related_name="attempts", db_index=True
    )
    # {str(module_id): {str(question_id): answer}} across all 4 modules.
    module_answers = models.JSONField(default=dict, blank=True)
    flagged = models.JSONField(default=dict, blank=True)
    # First-seen anchor per active phase (incl BREAK), written `or now`, never rewound.
    phase_started_at = models.JSONField(default=dict, blank=True)
    current_state = models.CharField(max_length=24, choices=STATE_CHOICES, default=STATE_NOT_STARTED, db_index=True)
    version_number = models.PositiveIntegerField(default=0, db_index=True)
    is_completed = models.BooleanField(default=False, db_index=True)

    # ── proctoring (mirrors midterms.MidtermAttempt) ──────────────────────────
    # The count lives HERE and not in the browser: a client-side tally is cleared by a
    # refresh or a new tab, which is exactly what a student gaming the rule would do.
    offscreen_violations = models.PositiveSmallIntegerField(default=0)
    terminated_reason = models.CharField(max_length=32, blank=True, default="")

    english_score = models.IntegerField(null=True, blank=True)
    math_score = models.IntegerField(null=True, blank=True)
    total_score = models.IntegerField(null=True, blank=True)  # combined /1600

    scoring_started_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "mocks_attempt"
        constraints = [
            # SOLO practice: one live attempt per (student, mock). Scoped to session IS NULL
            # because the old unqualified constraint was keyed to the MOCK rather than the
            # sitting — so a student's stranded practice attempt would silently re-open as a
            # "resume" when they walked into an invigilated session of the same mock.
            models.UniqueConstraint(
                fields=["student", "mock"],
                condition=(
                    models.Q(is_completed=False)
                    & models.Q(session__isnull=True)
                    & ~models.Q(current_state=STATE_ABANDONED)
                ),
                name="uniq_active_solo_mock_attempt",
            ),
            # A session seats a student exactly once, running or finished — re-entering a
            # sitting must reopen the SAME paper, never a fresh one.
            models.UniqueConstraint(
                fields=["student", "session"],
                condition=models.Q(session__isnull=False),
                name="uniq_mock_attempt_per_session",
            ),
        ]
        indexes = [
            models.Index(fields=["mock", "student"]),
            models.Index(fields=["current_state"]),
            models.Index(fields=["session", "current_state"]),
        ]

    def __str__(self):
        return f"MockAttempt #{self.pk} (mock={self.mock_id}, student={self.student_id}, {self.current_state})"

    @property
    def is_proctored(self) -> bool:
        """Whether this sitting is invigilated — fullscreen enforced, off-screen policed.

        Being in a session IS the invigilation: someone created it, approved this student
        into it and pressed Start. Solo practice is not policed, so a student revising on
        their own can look up a formula without forfeiting a paper nobody is watching.
        """
        return self.session_id is not None

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

    # ── transitions (caller holds a select_for_update lock) ────────────────────
    def start_attempt(self, *, at=None) -> bool:
        """NOT_STARTED -> ENGLISH_M1. Idempotent once already past NOT_STARTED.

        ``at`` pins the clock's zero. A session start passes ONE timestamp for the whole
        room, so thirty students get thirty identical deadlines rather than deadlines
        smeared across however long the loop took to write thirty rows.
        """
        if self.current_state != STATE_NOT_STARTED:
            return False
        v0 = int(self.version_number or 0)
        ts = at or timezone.now()
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

    def submit_final(self) -> bool:
        """End the WHOLE sitting now, from wherever it is — the forfeit edge.

        The linear chain has no way out of English module 1: a student caught by the
        off-screen rule on question 3 would otherwise have to be walked through three more
        modules and a break to reach a score. This jumps straight to SCORING, keeping every
        answer already banked. Whatever was never reached grades as omitted, which is the
        honest reading of a paper that was taken in early — the same thing
        ``MidtermAttempt.submit_final`` does, and the same thing the reaper's drain
        produces for an abandoned sitting.

        Deliberately bypasses ``assert_transition_allowed``: this is not a step along the
        chain, it is the chain being cut, and every legal edge is still enforced everywhere
        else. Idempotent — returns False once the paper is already in.
        """
        state = self.current_state
        if state in (STATE_SCORING, STATE_COMPLETED, STATE_ABANDONED):
            return False
        v0 = int(self.version_number or 0)
        ts = timezone.now()
        n = conditional_mock_attempt_update(
            pk=int(self.pk), expect_state=state, expect_version=v0,
            updates={
                "current_state": STATE_SCORING, "scoring_started_at": ts, "submitted_at": ts,
                "version_number": v0 + 1, "updated_at": ts,
            },
        )
        if n == 0:
            self.refresh_from_db()
            return False
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
