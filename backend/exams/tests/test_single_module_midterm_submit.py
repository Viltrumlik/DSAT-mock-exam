"""Regression: a single-module midterm (midterm_module_count=1) must submit, not 500.

Production bug: a student finished a 1-module midterm but submit returned 500
`ValidationError: "Module 2 is missing; cannot advance."` — `ensure_full_mock_practice_test_modules`
correctly provisions only Module 1 for a 1-module midterm, but `submit_module_1` still required a
Module 2. Submitting the only module must finalize into scoring instead.
"""

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from exams.models import MockExam, Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_question


@override_settings(CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
class SingleModuleMidtermSubmitTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="sm_student", email="sm@example.com", password="pw12345678",
            is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.user)

        self.exam = MockExam.objects.create(
            title="Single-module midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_module_count=1, midterm_module1_minutes=10,
            is_published=True,
        )
        self.test = PracticeTest.objects.create(
            mock_exam=self.exam, subject="MATH", form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=10)
        seed_mc_question(self.m1, stem="Midterm M1 Q1")

    def test_submit_single_module_midterm_scores_instead_of_500(self):
        attempt = self.client.post(
            "/api/exams/attempts/", {"practice_test": self.test.id}, format="json"
        ).data
        attempt_id = attempt["id"]
        self.assertEqual(attempt.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)

        r = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        # Was 500 "Module 2 is missing; cannot advance." — must now finalize for scoring.
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn(
            r.data.get("current_state"),
            (TestAttempt.STATE_SCORING, TestAttempt.STATE_COMPLETED),
        )
        # A single-module midterm never gets a Module 2.
        self.assertEqual(
            Module.objects.filter(practice_test=self.test, module_order=2).count(), 0
        )
