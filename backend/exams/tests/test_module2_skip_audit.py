"""The Module-2-skip audit must not cry wolf, and must not miss the real thing.

Both directions matter. A false COPIED sends a teacher to a student whose score was fine; a
miss leaves a student carrying half a paper's mark with nobody looking.
"""

from __future__ import annotations

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_question

User = get_user_model()


class Module2SkipAuditTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user("m2skip@t.com", "secret123")
        self.test = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", title="Paper A", skip_default_modules=True
        )
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=32)
        self.m2 = Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=32)
        self.q1 = seed_mc_question(self.m1, stem="M1 Q1", order=0)
        self.q2 = seed_mc_question(self.m2, stem="M2 Q1", order=0)

    def _attempt(self, *, m2_answers, m2_seconds):
        now = timezone.now()
        return TestAttempt.objects.create(
            student=self.student,
            practice_test=self.test,
            current_state=TestAttempt.STATE_COMPLETED,
            is_completed=True,
            completed_at=now,
            score=400,
            module_answers={str(self.m1.id): {str(self.q1.id): "A"}, str(self.m2.id): m2_answers},
            module_2_started_at=now,
            module_2_submitted_at=now + timezone.timedelta(seconds=m2_seconds),
        )

    def _run(self, *args):
        out = StringIO()
        call_command("audit_pastpaper_module2_skips", *args, stdout=out)
        return out.getvalue()

    def test_module_1_answers_under_module_2_are_reported_as_copied(self):
        # The signature of the bug: M2 answered with M1's question ids.
        self._attempt(m2_answers={str(self.q1.id): "A"}, m2_seconds=0.03)
        report = self._run()
        self.assertIn("COPIED", report)
        self.assertIn("Distinct students affected: 1", report)

    def test_a_genuine_short_module_2_is_only_FAST_not_COPIED(self):
        # A student who opened Module 2 and gave up immediately was scored correctly. Worth a
        # look; not worth telling anyone their score is wrong.
        self._attempt(m2_answers={str(self.q2.id): "B"}, m2_seconds=4)
        report = self._run()
        self.assertIn("COPIED: 0", report)
        self.assertIn("FAST", report)

    def test_a_normal_attempt_is_not_reported_at_all(self):
        self._attempt(m2_answers={str(self.q2.id): "B"}, m2_seconds=1500)
        report = self._run()
        self.assertIn("COPIED: 0", report)
        self.assertIn("Distinct students affected: 0", report)

    def test_an_empty_module_2_is_not_called_copied(self):
        # No answers at all is a student who ran out of time, not the bug.
        self._attempt(m2_answers={}, m2_seconds=1500)
        report = self._run()
        self.assertIn("COPIED: 0", report)

    def test_the_threshold_is_adjustable(self):
        self._attempt(m2_answers={str(self.q2.id): "B"}, m2_seconds=45)
        self.assertIn("Distinct students affected: 0", self._run("--max-seconds", "30"))
        self.assertIn("Distinct students affected: 1", self._run("--max-seconds", "60"))

    def test_it_changes_nothing(self):
        attempt = self._attempt(m2_answers={str(self.q1.id): "A"}, m2_seconds=0.03)
        before = (attempt.score, attempt.current_state, dict(attempt.module_answers))
        self._run()
        attempt.refresh_from_db()
        self.assertEqual((attempt.score, attempt.current_state, attempt.module_answers), before)

    def test_a_single_module_paper_is_ignored(self):
        solo = PracticeTest.objects.create(
            subject="MATH", title="Solo", skip_default_modules=True
        )
        only = Module.objects.create(practice_test=solo, module_order=1, time_limit_minutes=32)
        q = seed_mc_question(only, stem="Q", order=0)
        TestAttempt.objects.create(
            student=self.student, practice_test=solo,
            current_state=TestAttempt.STATE_COMPLETED, is_completed=True,
            module_answers={str(only.id): {str(q.id): "A"}},
        )
        self.assertIn("Distinct students affected: 0", self._run())
