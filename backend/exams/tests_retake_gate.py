"""The legacy runner's retake gate.

A retake is a SECOND CHANCE, not a second sitting. ``midterms.access.retake_eligibility``
has always enforced that for the v2 runner, but the legacy ``exams`` runner started
attempts through ``_midterm_start_guard``, which knew nothing about it — so a student who
scored above the parent's pass mark could open the retake through the old surface.

These tests pin the legacy guard to the same verdict, including the two edges that decide
whether the fix is safe to deploy: a legacy exam with no ``midterms.Midterm`` mirror must
keep working exactly as before (fail OPEN), and an in-flight attempt must never be bricked.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from exams.models import MockExam, PracticeTest, TestAttempt
from exams.views import _midterm_start_guard
from midterms.models import Midterm, MidtermOutcome

User = get_user_model()


class LegacyRetakeGateTests(TestCase):
    """``_midterm_start_guard`` must consult the v2 verdict via the legacy→v2 mirror."""

    def setUp(self):
        self.student = User.objects.create_user("retake_gate_s@t.com", "secret123")

        # Legacy pair: the parent midterm and its retake, as the builder authors them.
        self.legacy_parent = MockExam.objects.create(
            title="March midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_MIDTERM, midterm_scoring_scale=MockExam.SCALE_100,
            midterm_pass_mark=60,
        )
        self.legacy_retake = MockExam.objects.create(
            title="March retake", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_RETAKE, midterm_scoring_scale=MockExam.SCALE_100,
            midterm_pass_mark=60, midterm_retake_of=self.legacy_parent,
        )
        self.retake_section = PracticeTest.objects.create(
            subject="MATH", label="M", title="retake sec", collection_name="MID",
            mock_exam=self.legacy_retake,
        )

        # The v2 mirrors those legacy rows were migrated into.
        self.parent = Midterm.objects.create(
            title="March midterm", subject=Midterm.MATH, midterm_type=Midterm.TYPE_MIDTERM,
            scoring_scale=Midterm.SCALE_100, pass_mark=60,
            legacy_mock_exam_id=self.legacy_parent.pk,
        )
        self.retake = Midterm.objects.create(
            title="March retake", subject=Midterm.MATH, midterm_type=Midterm.TYPE_RETAKE,
            scoring_scale=Midterm.SCALE_100, pass_mark=60, retake_of=self.parent,
            legacy_mock_exam_id=self.legacy_retake.pk,
        )

    def _record_outcome(self, *, score, passed):
        return MidtermOutcome.objects.create(
            midterm=self.parent, student=self.student, score=score, pass_mark=60,
            scoring_scale=Midterm.SCALE_100, passed=passed,
        )

    def test_passed_the_parent_cannot_start_the_legacy_retake(self):
        self._record_outcome(score=88, passed=True)
        resp = _midterm_start_guard(self.student, self.legacy_retake)
        self.assertIsNotNone(resp, "a student who passed the parent must be refused")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "retake_already_passed")

    def test_failed_the_parent_may_start_the_legacy_retake(self):
        self._record_outcome(score=41, passed=False)
        self.assertIsNone(_midterm_start_guard(self.student, self.legacy_retake))

    def test_never_sat_the_parent_cannot_start_the_legacy_retake(self):
        resp = _midterm_start_guard(self.student, self.legacy_retake)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "retake_no_result")

    def test_ordinary_midterm_is_untouched(self):
        self.assertIsNone(_midterm_start_guard(self.student, self.legacy_parent))

    def test_legacy_exam_with_no_mirror_fails_open(self):
        # A legacy midterm the v2 migration never covered has no verdicts to consult; the
        # gate must degrade to the old behaviour rather than lock the paper.
        orphan = MockExam.objects.create(
            title="Orphan retake", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_RETAKE, midterm_retake_of=self.legacy_parent,
        )
        self.assertFalse(Midterm.objects.filter(legacy_mock_exam_id=orphan.pk).exists())
        self.assertIsNone(_midterm_start_guard(self.student, orphan))

    def test_parentless_retake_fails_open(self):
        # An authoring mistake (RETAKE with no parent) must not lock a whole cohort out.
        self.retake.retake_of = None
        self.retake.save(update_fields=["retake_of"])
        self.assertIsNone(_midterm_start_guard(self.student, self.legacy_retake))

    def test_in_flight_attempt_still_resumes_after_the_parent_is_rescored(self):
        # The student was eligible when they started; a parent re-scored to PASS mid-sitting
        # must not brick them out of the paper they are already writing.
        self._record_outcome(score=88, passed=True)
        TestAttempt.objects.create(
            student=self.student, practice_test=self.retake_section, mock_exam=self.legacy_retake,
            is_completed=False, current_state="MODULE_1_ACTIVE",
        )
        self.assertIsNone(_midterm_start_guard(self.student, self.legacy_retake))

    def test_abandoned_attempt_does_not_exempt_a_passer(self):
        # An abandoned attempt is not in-flight — the gate applies as to a fresh start.
        self._record_outcome(score=88, passed=True)
        TestAttempt.objects.create(
            student=self.student, practice_test=self.retake_section, mock_exam=self.legacy_retake,
            is_completed=False, current_state=TestAttempt.STATE_ABANDONED,
        )
        resp = _midterm_start_guard(self.student, self.legacy_retake)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "retake_already_passed")
