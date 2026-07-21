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

    # Difficulty tier. Lowercase codes shared VERBATIM with assessments.AssessmentSet.level,
    # classes.Classroom.level and exams.MockExam.midterm_level (the builder authors it there
    # and sync mirrors it here). Subject-dependent: Reading & Writing has no Foundation.
    LEVEL_FOUNDATION = "foundation"
    LEVEL_JUNIOR = "junior"
    LEVEL_MIDDLE = "middle"
    LEVEL_SENIOR = "senior"
    LEVEL_CHOICES = [
        (LEVEL_FOUNDATION, "Foundation"),
        (LEVEL_JUNIOR, "Junior"),
        (LEVEL_MIDDLE, "Middle"),
        (LEVEL_SENIOR, "Senior"),
    ]
    ALLOWED_LEVELS_BY_SUBJECT = {
        READING_WRITING: (LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
        MATH: (LEVEL_FOUNDATION, LEVEL_JUNIOR, LEVEL_MIDDLE, LEVEL_SENIOR),
    }
    # Levels that unlock the Desmos calculator (Math only) — mirrors the assessment rule
    # (StudentAttemptRunnerContainer: math + middle/senior). See `calculator_enabled`.
    CALCULATOR_LEVELS = (LEVEL_MIDDLE, LEVEL_SENIOR)

    # Structural invariants — a midterm never offers these. Kept as class attributes
    # (not fields/toggles) so they cannot be authored on. The calculator is NOT one of
    # them: it is level-dependent — see the `calculator_enabled` property.
    REFERENCE_SHEET_ENABLED = False
    PAUSE_ENABLED = False

    # ── flavour ──────────────────────────────────────────────────────────────
    # Mirrors ``exams.MockExam.midterm_type`` verbatim (the builder authors it there).
    # PRE_MIDTERM is deliberately exempt from the pass/fail machinery: it is a diagnostic,
    # so it issues no MidtermOutcome and can never gate a retake.
    TYPE_PRE_MIDTERM = "PRE_MIDTERM"
    TYPE_MIDTERM = "MIDTERM"
    TYPE_RETAKE = "RETAKE"
    MIDTERM_TYPE_CHOICES = [
        (TYPE_PRE_MIDTERM, "Pre-midterm"),
        (TYPE_MIDTERM, "Midterm"),
        (TYPE_RETAKE, "Retake midterm"),
    ]
    # Types that produce a pass/fail verdict. Pre-midterms are scored but never judged.
    GRADED_TYPES = (TYPE_MIDTERM, TYPE_RETAKE)

    title = models.CharField(max_length=255, db_index=True)
    subject = models.CharField(max_length=20, choices=SUBJECT_CHOICES, default=READING_WRITING, db_index=True)
    level = models.CharField(
        max_length=16,
        choices=LEVEL_CHOICES,
        blank=True,
        default="",
        db_index=True,
        help_text="Blank = untagged (no calculator). Foundation applies to Math only.",
    )
    scoring_scale = models.CharField(max_length=16, choices=SCALE_CHOICES, default=SCALE_100)
    midterm_type = models.CharField(
        max_length=16,
        choices=MIDTERM_TYPE_CHOICES,
        default=TYPE_MIDTERM,
        db_index=True,
        help_text="Pre-midterm / midterm / retake. Pre-midterms are never pass/fail graded.",
    )
    pass_mark = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text=(
            "Score a student must reach to PASS, on this midterm's own scale "
            "(0-100 or 200-800). Blank = the 50%-of-questions default for the scale."
        ),
    )
    # A RETAKE points at the midterm it is the second chance for. Access to the retake is
    # granted only to students who FAILED that parent (see access.retake_eligible_students).
    retake_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="retakes",
        help_text="For a RETAKE: the midterm whose failers may sit this.",
    )
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

    def display_question_count(self) -> int:
        """Questions a student actually gets: for a versioned midterm the versions are
        equal-length parallel forms, so use the first version's count; otherwise the flat
        module count. Version-aware so multi-version midterms don't read as empty (their
        flat ``question_module`` is intentionally unused)."""
        v = self.versions.order_by("version_number").first()
        if v is not None:
            return v.questions().count()
        return self.questions().count()

    def has_questions(self) -> bool:
        """True when the midterm has at least one question to serve (version-aware)."""
        return self.display_question_count() > 0

    @classmethod
    def allowed_levels_for_subject(cls, subject: str) -> tuple[str, ...]:
        """Levels valid for a subject (Foundation is Math-only). Mirrors
        assessments.AssessmentSet.allowed_levels_for_subject."""
        return cls.ALLOWED_LEVELS_BY_SUBJECT.get(subject, ())

    @property
    def calculator_enabled(self) -> bool:
        """Whether the runner may offer Desmos — the single source of truth.

        Math midterms at middle/senior level only; every other midterm (R&W, or an
        untagged/junior/foundation Math midterm) has no calculator. Computed here — not
        re-derived client-side — because `subject` is UPPERCASE here while the assessment
        rule compares lowercase, and one authority avoids the two drifting.
        """
        return self.subject == self.MATH and self.level in self.CALCULATOR_LEVELS

    @property
    def score_ceiling(self) -> int:
        return 800 if self.scoring_scale == self.SCALE_800 else 100

    # ── pass/fail ────────────────────────────────────────────────────────────
    @property
    def is_graded(self) -> bool:
        """Whether sitting this midterm produces a pass/fail verdict.

        False for pre-midterms, which are diagnostics: they are scored and certificated
        like any other midterm but never judged, so they can neither be failed nor unlock
        a retake.
        """
        return self.midterm_type in self.GRADED_TYPES

    @property
    def effective_pass_mark(self) -> int:
        """The pass mark on this midterm's own scale, falling back to the scale default."""
        from .outcomes import effective_pass_mark

        return effective_pass_mark(self)

    def is_passing_score(self, score) -> bool:
        from .outcomes import is_passing

        return is_passing(score, self)

    def delete(self, *args, **kwargs):
        # PROTECT stops the owned Module being deleted out from under a live midterm; on
        # midterm deletion we remove the Midterm first, then its module (cascading Questions).
        mod = self.question_module
        result = super().delete(*args, **kwargs)
        if mod is not None:
            mod.delete()
        return result


class MidtermVersion(models.Model):
    """One of a midterm's parallel question sets (up to 4).

    Each version is a full copy of the midterm with its OWN questions (hung off its own
    ``exams.Module``, mirrored from a legacy PracticeTest by sync). Students are randomly
    distributed across versions; the assigned version is pinned on the attempt so the
    runner + scorer serve that version's questions. A midterm with NO versions is a plain
    single-set midterm (uses ``Midterm.question_module`` as before).
    """

    midterm = models.ForeignKey(Midterm, on_delete=models.CASCADE, related_name="versions", db_index=True)
    version_number = models.PositiveSmallIntegerField()  # 1..4
    label = models.CharField(max_length=64, blank=True, default="")
    question_module = models.OneToOneField(
        "exams.Module", on_delete=models.PROTECT, null=True, blank=True, related_name="midterm_version"
    )
    # Idempotency anchor: the legacy exams.PracticeTest this version mirrors.
    legacy_practice_test_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "midterms_version"
        ordering = ["version_number"]
        constraints = [
            models.UniqueConstraint(fields=["midterm", "version_number"], name="uniq_midterm_version_number"),
        ]

    def __str__(self):
        return f"MidtermVersion #{self.pk} (midterm={self.midterm_id} v{self.version_number})"

    def questions(self):
        from exams.models import Question

        if not self.question_module_id:
            return Question.objects.none()
        return Question.objects.filter(module_id=self.question_module_id).order_by("order", "id")

    def delete(self, *args, **kwargs):
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
    # The assigned version's question set, if this midterm has versions (else None → the
    # midterm's own question_module). Pinned at attempt creation; never exposed to students.
    version = models.ForeignKey(
        "MidtermVersion", on_delete=models.SET_NULL, null=True, blank=True, related_name="attempts", db_index=True
    )
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

    # ── proctoring: off-screen offences ──────────────────────────────────────
    # Counted SERVER-side because a client-only tally is reset by a refresh or a new tab,
    # which is exactly what a student trying to game the rule would do. The browser reports
    # each offence; the server decides what it costs (see views.report_offscreen).
    offscreen_violations = models.PositiveSmallIntegerField(
        default=0, help_text="Times the student left the exam window during this attempt."
    )
    # Set when the attempt was ended by the system rather than by the clock, so the result
    # page and the admin report can say WHY a paper was cut short.
    TERMINATION_OFFSCREEN = "OFFSCREEN"
    TERMINATION_CHOICES = [(TERMINATION_OFFSCREEN, "Left the exam window")]
    terminated_reason = models.CharField(
        max_length=24, choices=TERMINATION_CHOICES, blank=True, default="", db_index=True
    )

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

    # ── question source (version-aware) ───────────────────────────────────────
    @property
    def effective_module(self):
        """The exams.Module whose questions this attempt is graded/served from —
        the assigned version's module when set, else the midterm's own module."""
        if self.version_id and self.version.question_module_id:
            return self.version.question_module
        return self.midterm.question_module

    def effective_questions(self):
        """Ordered question set for this attempt (version-aware)."""
        if self.version_id:
            return self.version.questions()
        return self.midterm.questions()

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
        # Freeze what the score was made of, then record the verdict. Both are derived
        # data: a failure here must not un-complete a scored attempt, so neither is
        # allowed to raise (the attempt row is already correct without them).
        try:
            MidtermQuestionResult.freeze_for(self)
        except Exception:  # pragma: no cover - defensive
            logger.exception("midterm per-question freeze failed for attempt %s", self.pk)
        try:
            MidtermOutcome.record_for(self)
        except Exception:  # pragma: no cover - defensive
            logger.exception("midterm outcome record failed for attempt %s", self.pk)
        return True


class MidtermQuestionResult(models.Model):
    """One frozen per-question verdict for a completed attempt.

    Exists because correctness used to be derived at READ time against the *live*
    ``exams.Question`` rows, and midterm content is live-synced from the builder
    (``midterms.sync`` refreshes mirrored questions in place and trims removed ones). So a
    report rebuilt a month later could silently disagree with the score the student was
    given — or lose questions entirely. Freezing at scoring time makes a past result a
    historical fact.

    ``skill_name``/``domain_name`` are denormalized copies, not just the FK: retiring or
    renaming a taxonomy row must not rewrite last term's error report.
    """

    attempt = models.ForeignKey(
        MidtermAttempt, on_delete=models.CASCADE, related_name="question_results", db_index=True
    )
    # Deliberately a plain integer, NOT a FK: builder edits delete mirrored questions, and
    # a CASCADE would erase the history this table exists to preserve.
    question_id = models.BigIntegerField(db_index=True)
    order = models.PositiveIntegerField(default=0)
    is_correct = models.BooleanField(default=False, db_index=True)
    answered = models.BooleanField(default=False, help_text="False = omitted (counts as wrong).")

    skill = models.ForeignKey(
        "questionbank.BankSkill", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    skill_name = models.CharField(max_length=255, blank=True, default="")
    domain_name = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "midterms_question_result"
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["attempt", "question_id"], name="uniq_midterm_qresult_per_attempt"
            ),
        ]
        indexes = [models.Index(fields=["attempt", "is_correct"])]

    def __str__(self):
        return f"MidtermQuestionResult(attempt={self.attempt_id}, q={self.question_id}, correct={self.is_correct})"

    @classmethod
    def freeze_for(cls, attempt) -> int:
        """Write (or rewrite) the per-question rows for a just-completed ``attempt``.

        Grades through ``exams.Question.check_answer`` — the same single grading atom the
        scorer uses — so the frozen rows can never disagree with the frozen score. Returns
        the number of rows written. Idempotent: re-running replaces the set.
        """
        answers = attempt.answers or {}
        rows = []
        for i, q in enumerate(attempt.effective_questions()):
            raw = answers.get(str(q.id))
            skill = getattr(q, "skill", None)
            rows.append(
                cls(
                    attempt_id=attempt.pk,
                    question_id=int(q.id),
                    order=i,
                    is_correct=bool(q.check_answer(raw)),
                    answered=raw not in (None, ""),
                    skill=skill,
                    skill_name=(getattr(skill, "name", "") or ""),
                    domain_name=(getattr(getattr(skill, "domain", None), "name", "") or ""),
                )
            )
        cls.objects.filter(attempt_id=attempt.pk).delete()
        cls.objects.bulk_create(rows, batch_size=200)
        return len(rows)


class MidtermOutcome(models.Model):
    """The pass/fail verdict for one student on one midterm — the retake gate.

    A separate table rather than a flag on the attempt because the verdict is a different
    fact from the attempt: it is what a *retake grant* and the *admin report* are keyed on,
    it must survive an attempt being re-scored, and it carries the pass mark that was in
    force at the time (changing a midterm's pass mark later must not silently re-judge
    students who already sat it).

    Never written for a PRE_MIDTERM — a diagnostic has no verdict to give.
    """

    midterm = models.ForeignKey(Midterm, on_delete=models.CASCADE, related_name="outcomes", db_index=True)
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="midterm_outcomes", db_index=True
    )
    attempt = models.ForeignKey(
        MidtermAttempt, on_delete=models.SET_NULL, null=True, blank=True, related_name="outcome_rows"
    )

    score = models.IntegerField(null=True, blank=True)
    # Frozen at verdict time — see the class docstring.
    pass_mark = models.PositiveSmallIntegerField()
    scoring_scale = models.CharField(max_length=16, blank=True, default="")
    passed = models.BooleanField(db_index=True)

    decided_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "midterms_outcome"
        ordering = ["-decided_at"]
        constraints = [
            models.UniqueConstraint(fields=["midterm", "student"], name="uniq_midterm_outcome_per_student"),
        ]
        indexes = [models.Index(fields=["midterm", "passed"])]

    def __str__(self):
        verdict = "PASS" if self.passed else "FAIL"
        return f"MidtermOutcome(midterm={self.midterm_id}, student={self.student_id}, {verdict})"

    @classmethod
    def record_for(cls, attempt):
        """Record (or refresh) the verdict for a completed ``attempt``.

        Returns the ``MidtermOutcome``, or ``None`` when the midterm is not graded
        (pre-midterm) or the attempt has no score yet.
        """
        midterm = attempt.midterm
        if not midterm.is_graded or attempt.score is None:
            return None
        mark = midterm.effective_pass_mark
        outcome, _created = cls.objects.update_or_create(
            midterm_id=midterm.pk,
            student_id=attempt.student_id,
            defaults={
                "attempt_id": attempt.pk,
                "score": int(attempt.score),
                "pass_mark": int(mark),
                "scoring_scale": midterm.scoring_scale,
                "passed": int(attempt.score) >= int(mark),
            },
        )
        return outcome


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


class MidtermVersionAssignment(models.Model):
    """Which version of a midterm a student was given (classroom flavor).

    Written by the teacher's random-assignment step and consumed at attempt creation to
    pin ``MidtermAttempt.version``. Students never see this — the version is invisible to
    them. Scoped per (midterm, classroom, student) so the same midterm can be assigned
    independently in different classrooms.
    """

    midterm = models.ForeignKey(Midterm, on_delete=models.CASCADE, related_name="version_assignments", db_index=True)
    classroom = models.ForeignKey("classes.Classroom", on_delete=models.CASCADE, related_name="+", db_index=True)
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+", db_index=True)
    version = models.ForeignKey(MidtermVersion, on_delete=models.CASCADE, related_name="assignments")
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "midterms_version_assignment"
        constraints = [
            models.UniqueConstraint(
                fields=["midterm", "classroom", "student"], name="uniq_midterm_version_assignment"
            ),
        ]
