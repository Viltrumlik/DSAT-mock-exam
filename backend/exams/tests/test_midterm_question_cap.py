"""Regression: midterm question authoring must not be capped at 100 total points.

Midterms are graded as a percentage of the actual total (SCALE_100 = correct/total × 100,
weight-independent; SCALE_800 = proportional), so there is no fixed total-points cap. Previously
the serializer rejected any question that pushed the midterm's summed `score` over 100, which made
the "Add question" button (stub defaults to score 10) fail after 10 questions — blocking larger
midterms. These tests assert the cap is gone and only a positive score is required.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest, Question

User = get_user_model()

_ALLOWED_HOSTS = ("testserver", "localhost", "127.0.0.1", "questions.mastersat.uz")
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class MidtermQuestionCapTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="mt-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.admin)

        self.exam = MockExam.objects.create(
            title="Midterm cap test", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_100,
            midterm_module_count=1,
        )
        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=self.exam,
            title="Midterm section", skip_default_modules=True,
        )
        self.mod = Module.objects.create(
            practice_test=self.pt, module_order=1, time_limit_minutes=35,
        )
        # 10 questions × 10 points = 100 — exactly the old cap.
        for i in range(10):
            Question.objects.create(
                module=self.mod, question_type="MATH", question_text=f"Q{i}",
                correct_answers="a", score=10, order=i,
            )

    def _url(self):
        return f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/"

    def test_add_question_past_100_total_points(self):
        # Stub create ({}) defaults to score 10 → previously 400 "cannot exceed 100".
        r = self.client.post(self._url(), {}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Question.objects.filter(module=self.mod).count(), 11)

    def test_any_positive_score_allowed(self):
        # Score outside the old {1,2,3,5,8,10} set is now accepted.
        r = self.client.post(
            self._url(), {"question_type": "MATH", "correct_answer": "a", "score": 7},
            format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 201, r.content)

    def test_zero_score_rejected(self):
        r = self.client.post(
            self._url(), {"question_type": "MATH", "correct_answer": "a", "score": 0},
            format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class MidtermModuleQuestionLimitTests(TestCase):
    """Midterms enforce a builder-configurable per-module question limit (default
    30) instead of the official SAT 22/27 counts. See exams/midterm_rules.py."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="mt-limit-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.admin)
        # Small limit (2) keeps the test fast while exercising the same gate as 30.
        self.exam = MockExam.objects.create(
            title="Midterm limit test", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_100,
            midterm_module_count=1, midterm_module_question_limit=2,
        )
        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=self.exam,
            title="Midterm section", skip_default_modules=True,
        )
        self.mod = Module.objects.create(
            practice_test=self.pt, module_order=1, time_limit_minutes=35,
        )

    def _url(self):
        return f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/"

    def test_add_blocked_at_configured_limit(self):
        # First two stub creates succeed; the third exceeds the limit of 2.
        for _ in range(2):
            r = self.client.post(self._url(), {}, format="json", **_QHOST)
            self.assertEqual(r.status_code, 201, r.content)
        r = self.client.post(self._url(), {}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn(b"maximum for this module is 2", r.content)
        self.assertEqual(Question.objects.filter(module=self.mod).count(), 2)

    def test_default_limit_is_30(self):
        # An exam with no explicit limit falls back to 30 (well above SAT Math 22).
        exam = MockExam.objects.create(
            title="Default limit", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_100,
            midterm_module_count=1,
        )
        self.assertEqual(exam.midterm_module_question_limit, 30)
