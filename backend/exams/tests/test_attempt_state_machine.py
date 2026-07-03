from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import override_settings
from rest_framework.test import APITestCase

from exams.models import MockExam, PracticeTest, Module, TestAttempt
from exams.tasks import score_attempt_async
from exams.tests.support import seed_mc_question, seed_mc_questions_for_practice_test


@override_settings(CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
class TestAttemptStateMachineTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="student1",
            email="student1@example.com",
            password="pw12345678",
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(self.user)

        self.test = PracticeTest.objects.create(
            subject="READING_WRITING",
            title="RW section",
            form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        # Provision modules explicitly for test determinism.
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=1)
        self.m2 = Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(self.test)

    def _start_attempt(self) -> dict:
        # Pastpapers create in NOT_STARTED (Module 1 timer HELD on the welcome
        # screen); the welcome Start button (POST .../start/) begins Module 1.
        # Mirror that two-step flow so these tests exercise an active attempt.
        r = self.client.post("/api/exams/attempts/", {"practice_test": self.test.id}, format="json")
        self.assertIn(r.status_code, (200, 201))
        r2 = self.client.post(f"/api/exams/attempts/{r.data['id']}/start/", {}, format="json")
        self.assertEqual(r2.status_code, 200, r2.content)
        return r2.data

    def test_module1_submit_advances_to_module2_not_review(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]
        self.assertEqual(attempt.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)
        self.assertEqual(attempt.get("current_module_details", {}).get("module_order"), 1)

        r = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {"1": "A"}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data.get("is_completed"))
        self.assertEqual(r.data.get("current_module_details", {}).get("module_order"), 2)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)

        # Review must be forbidden until COMPLETED.
        r = self.client.get(f"/api/exams/attempts/{attempt_id}/review/")
        self.assertEqual(r.status_code, 403)

    def test_cannot_start_module2_first(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]

        r = self.client.post(
            f"/api/exams/attempts/{attempt_id}/start_module/",
            {"module_id": self.m2.id},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_final_results_only_after_module2_submit(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]
        self.assertEqual(attempt.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)
        self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )

        r = self.client.get(f"/api/exams/attempts/{attempt_id}/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data.get("is_completed"))

        # Submit module 2 -> SCORING (async)
        r = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data.get("is_completed"))
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_SCORING)

        # Results still forbidden while scoring
        r = self.client.get(f"/api/exams/attempts/{attempt_id}/review/")
        self.assertEqual(r.status_code, 403)

        # Simulate worker completion
        score_attempt_async(attempt_id)
        r = self.client.get(f"/api/exams/attempts/{attempt_id}/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.get("is_completed"))
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_COMPLETED)

        # Review now allowed
        r = self.client.get(f"/api/exams/attempts/{attempt_id}/review/")
        self.assertEqual(r.status_code, 200)

    def test_duplicate_submit_does_not_skip_modules(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]

        r1 = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        self.assertFalse(r1.data.get("is_completed"))
        self.assertEqual(r1.data.get("current_module_details", {}).get("module_order"), 2)

        # Submitting again (while module2 active) should not complete early unless module2 actually submitted.
        # First, force the attempt back into module 1 idempotency scenario:
        att = TestAttempt.objects.get(pk=attempt_id)
        att.current_module = self.m1
        att.save(update_fields=["current_module"])

        r2 = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        # Either 200 (idempotent no-op) or 400 (backend rejects invalid current state) are acceptable,
        # but it must NOT mark completed.
        self.assertIn(r2.status_code, (200, 400))
        att.refresh_from_db()
        self.assertFalse(att.is_completed)

    def test_midterm_missing_module2_is_reprovisioned_on_submit(self):
        """
        Regression guard for production bug:
        If a midterm is configured for 2 modules but Module 2 row is missing (e.g., deleted),
        Module 1 submission must still advance to an active Module 2 (not a null current_module).
        """
        exam = MockExam.objects.create(
            title="Midterm",
            kind=MockExam.KIND_MIDTERM,
            midterm_subject="READING_WRITING",
            midterm_module_count=2,
            midterm_module1_minutes=1,
            midterm_module2_minutes=1,
            is_published=True,
        )
        test = PracticeTest.objects.create(
            mock_exam=exam,
            subject="READING_WRITING",
            form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        m1 = Module.objects.create(practice_test=test, module_order=1, time_limit_minutes=1)
        # Intentionally do not create module 2.
        seed_mc_question(m1, stem="Midterm M1 only")

        attempt = self.client.post("/api/exams/attempts/", {"practice_test": test.id}, format="json").data
        attempt_id = attempt["id"]
        # Timer held on create → begin Module 1 via the Start action.
        attempt = self.client.post(f"/api/exams/attempts/{attempt_id}/start/", {}, format="json").data
        self.assertEqual(attempt.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)

        r = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertEqual(r.data.get("current_module_details", {}).get("module_order"), 2)

    def test_resume_status_restores_module2(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]

        self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {"1": "A"}, "flagged": []},
            format="json",
        )
        r = self.client.get(f"/api/exams/attempts/{attempt_id}/status/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertEqual(r.data.get("current_module_details", {}).get("module_order"), 2)

    def test_legacy_module1_submitted_repaired_off_cli_then_resume_ok(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]
        # Simulate a legacy/partial-write attempt that got stuck in MODULE_1_SUBMITTED with no active module pointer.
        att = TestAttempt.objects.get(pk=attempt_id)
        att.current_state = TestAttempt.STATE_MODULE_1_SUBMITTED
        att.current_module = None
        att.current_module_start_time = None
        att.save(update_fields=["current_state", "current_module", "current_module_start_time"])

        # HTTP resume no longer folds *_SUBMITTED (repair_exam_integrity / lock path only).
        with transaction.atomic():
            locked = TestAttempt.objects.select_for_update().get(pk=attempt_id)
            locked.repair_legacy_submitted_states()
        r = self.client.post(f"/api/exams/attempts/{attempt_id}/resume/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)
        self.assertEqual(r.data.get("current_module_details", {}).get("module_order"), 2)

    def test_submit_idempotency_key_replay(self):
        attempt = self._start_attempt()
        attempt_id = attempt["id"]
        headers = {"HTTP_IDEMPOTENCY_KEY": "submit-1"}
        r1 = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {"1": "A"}, "flagged": []},
            format="json",
            **headers,
        )
        self.assertEqual(r1.status_code, 200)
        r2 = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {"1": "B"}, "flagged": []},
            format="json",
            **headers,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r1.data, r2.data)

