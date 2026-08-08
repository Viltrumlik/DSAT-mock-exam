"""The flags a student raised during a pastpaper must survive into review.

"Mark for Review" is the runner's promise that the student can come back to a question. The
flags were already persisted per module — `save_attempt` and `submit_module_1` write
`TestAttempt.flagged_questions` — but the review payload never carried them, so the list was
thrown away at exactly the moment the student came back to it.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_question

User = get_user_model()


class ReviewCarriesTheStudentsFlagsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user("flagrev@t.com", "secret123")
        self.client.force_authenticate(self.student)

        self.test = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        self.module = Module.objects.create(
            practice_test=self.test, module_order=1, time_limit_minutes=10
        )
        self.q1 = seed_mc_question(self.module, stem="Q1", order=0)
        self.q2 = seed_mc_question(self.module, stem="Q2", order=1)

        self.attempt = TestAttempt.objects.create(
            student=self.student,
            practice_test=self.test,
            current_state=TestAttempt.STATE_COMPLETED,
            is_completed=True,
            completed_at=timezone.now(),
            module_answers={str(self.module.id): {str(self.q1.id): "A", str(self.q2.id): "B"}},
            flagged_questions={str(self.module.id): [self.q2.id]},
        )

    def _questions(self):
        r = self.client.get(f"/api/exams/attempts/{self.attempt.pk}/review/")
        self.assertEqual(r.status_code, 200, r.content)
        return {q["id"]: q for q in r.data["questions"]}

    def test_a_flagged_question_comes_back_flagged(self):
        qs = self._questions()
        self.assertTrue(qs[self.q2.id]["was_flagged"])

    def test_an_unflagged_question_does_not(self):
        qs = self._questions()
        self.assertFalse(qs[self.q1.id]["was_flagged"])

    def test_ids_stored_as_strings_are_still_recognised(self):
        # The list has been written by several code paths over the years and mixes ints with
        # strings; comparing the two shapes directly would silently drop every flag.
        self.attempt.flagged_questions = {str(self.module.id): [str(self.q2.id)]}
        self.attempt.save(update_fields=["flagged_questions"])
        self.assertTrue(self._questions()[self.q2.id]["was_flagged"])

    def test_an_attempt_with_no_flags_reports_every_question_unflagged(self):
        # A missing key must read as "flagged nothing", not raise.
        self.attempt.flagged_questions = {}
        self.attempt.save(update_fields=["flagged_questions"])
        qs = self._questions()
        self.assertEqual([q["was_flagged"] for q in qs.values()], [False, False])
