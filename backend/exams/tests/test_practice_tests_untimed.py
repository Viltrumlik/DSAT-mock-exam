from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from desktop.v1.snapshots import pastpaper_lite
from exams.attempt_timing import get_active_module_timing
from exams.models import PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


class UntimedPracticeTestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(email="unt_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.client.force_authenticate(self.student)

    def _create_attempt(self, *, practice, number=1):
        pt = PracticeTest.objects.create(
            subject="MATH", title="S", is_practice_test=practice, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=number if practice else None,
        )
        seed_mc_questions_for_practice_test(pt)
        if not practice:
            pt.assigned_users.add(self.student)
        r = self.client.post("/api/exams/attempts/", {"practice_test": pt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["id"]

    def test_untimed_start_records_choice_and_drops_the_clock(self):
        aid = self._create_attempt(practice=True)
        r = self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertFalse(body["is_timed"])
        self.assertIsNone(body["remaining_seconds"])
        self.assertIsNone(body["module_duration_seconds"])
        self.assertTrue(body["can_submit"])
        self.assertTrue(body["practice_test_details"]["is_practice_test"])
        self.assertEqual(body["practice_test_details"]["practice_number"], 1)

    def test_untimed_attempt_never_expires(self):
        aid = self._create_attempt(practice=True)
        self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json")
        TestAttempt.objects.filter(pk=aid).update(module_1_started_at=timezone.now() - timedelta(hours=5))
        attempt = TestAttempt.objects.select_related("current_module").get(pk=aid)
        self.assertIsNone(get_active_module_timing(attempt))

    def test_default_start_stays_timed(self):
        aid = self._create_attempt(practice=True)
        body = self.client.post(f"/api/exams/attempts/{aid}/start/", {}, format="json").json()
        self.assertTrue(body["is_timed"])
        self.assertIsNotNone(body["remaining_seconds"])

    def test_past_papers_ignore_the_untimed_request(self):
        aid = self._create_attempt(practice=False)
        body = self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json").json()
        self.assertTrue(body["is_timed"])

    def test_choice_cannot_change_after_the_start(self):
        aid = self._create_attempt(practice=True)
        self.client.post(f"/api/exams/attempts/{aid}/start/", {}, format="json", HTTP_IDEMPOTENCY_KEY="k1")
        body = self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json", HTTP_IDEMPOTENCY_KEY="k2").json()
        self.assertTrue(body["is_timed"])

    def test_desktop_snapshot_has_no_clock_for_an_untimed_attempt(self):
        # desktop/v1/snapshots.py builds its own deadline from the module limit (it does not call
        # get_active_module_timing), so it needs its own untimed guard.
        timed_id = self._create_attempt(practice=True)
        self.client.post(f"/api/exams/attempts/{timed_id}/start/", {}, format="json")
        timed = pastpaper_lite(TestAttempt.objects.get(pk=timed_id))["timing"]
        self.assertIsNotNone(timed["deadline_at"])
        self.assertIsNotNone(timed["remaining_ms"])

        aid = self._create_attempt(practice=True, number=2)
        self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json")
        untimed = pastpaper_lite(TestAttempt.objects.get(pk=aid))["timing"]
        self.assertIsNone(untimed["deadline_at"])
        self.assertIsNone(untimed["remaining_ms"])

    def test_review_payload_carries_is_timed(self):
        aid = self._create_attempt(practice=True)
        self.client.post(f"/api/exams/attempts/{aid}/start/", {"timed": False}, format="json")
        TestAttempt.objects.filter(pk=aid).update(
            current_state=TestAttempt.STATE_COMPLETED, is_completed=True, completed_at=timezone.now()
        )
        r = self.client.get(f"/api/exams/attempts/{aid}/review/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIs(r.json()["is_timed"], False)

        TestAttempt.objects.filter(pk=aid).update(is_timed=True)
        r = self.client.get(f"/api/exams/attempts/{aid}/review/")
        self.assertIs(r.json()["is_timed"], True)
