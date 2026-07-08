from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, EXAMS_SCORE_INLINE_IF_NO_CELERY=True)
class ExamRunnerSmokeTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.student = User.objects.create_user(
            username="smoke_student",
            email="smoke_student@example.com",
            password="pw12345678",
        )
        self.client.force_authenticate(self.student)

        self.test = PracticeTest.objects.create(
            subject="READING_WRITING",
            title="Smoke RW",
            form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=1)
        Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(self.test)
        # Attempt-create is now gated to assigned pastpapers for students; grant access.
        self.test.assigned_users.add(self.student)

    def test_start_resume_status_smoke(self):
        r = self.client.post("/api/exams/attempts/", {"practice_test": self.test.id}, format="json")
        self.assertIn(r.status_code, (200, 201), r.content)
        attempt_id = int(r.data["id"])

        r = self.client.post(f"/api/exams/attempts/{attempt_id}/resume/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("id"), attempt_id)
        self.assertIn(
            r.data.get("current_state"),
            (TestAttempt.STATE_MODULE_1_ACTIVE, TestAttempt.STATE_MODULE_2_ACTIVE),
        )

        r = self.client.get(f"/api/exams/attempts/{attempt_id}/status/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("id"), attempt_id)

