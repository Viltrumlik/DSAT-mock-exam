"""
Regression: a fresh pastpaper attempt must HOLD its Module 1 timer until the
student clicks Start on the welcome screen.

The bug: attempt creation immediately called `start_attempt()`, which set
`module_1_started_at = now` while the student was still on the welcome/instructions
screen. If she left without answering (and the leave wasn't paused), the 32-min
Module 1 clock burned overnight; on return Module 1 was auto-submitted blank and
she landed on Module 2 — "the test started from Module 2".

Fix: create a pastpaper attempt in NOT_STARTED (timer un-anchored); the existing
`POST .../start/` action (fired by the welcome Start button) starts Module 1 at
that moment. Mock exams (no welcome gate) still auto-start, and an ABANDONED
attempt is still resumed on re-entry.
"""
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from exams.models import PracticeTest, Module, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test


class PastpaperTimerHoldTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="hold_student", email="hold@example.com", password="pw12345678",
        )
        self.client.force_authenticate(self.user)
        self.test = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True,
        )
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=32)
        self.m2 = Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=32)
        seed_mc_questions_for_practice_test(self.test, questions_per_module=2)
        # Attempt-create is now gated to assigned pastpapers for students; grant access.
        self.test.assigned_users.add(self.user)

    def _create_attempt(self):
        return self.client.post("/api/exams/attempts/", {"practice_test": self.test.id}, format="json")

    def test_fresh_pastpaper_attempt_holds_timer_not_started(self):
        r = self._create_attempt()
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_NOT_STARTED)
        att = TestAttempt.objects.get(pk=r.data["id"])
        # Timer must NOT be anchored yet — this is the whole fix.
        self.assertIsNone(att.module_1_started_at)
        self.assertIsNone(att.current_module_start_time)
        # No active module / no remaining-seconds countdown while held.
        self.assertIsNone(att.current_module_id)
        self.assertIsNone(r.data.get("remaining_seconds"))

    def test_start_action_begins_module_1_timer_now(self):
        r = self._create_attempt()
        att_id = r.data["id"]
        before = timezone.now()
        r2 = self.client.post(f"/api/exams/attempts/{att_id}/start/", {}, format="json")
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(r2.data.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)
        att = TestAttempt.objects.get(pk=att_id)
        self.assertIsNotNone(att.module_1_started_at)
        # Timer anchored at Start time, NOT at creation.
        self.assertGreaterEqual(att.module_1_started_at, before)
        self.assertEqual(att.current_module_id, self.m1.id)

    def test_recreate_returns_same_held_attempt_without_starting(self):
        # Clicking the pastpaper card twice must not start (nor duplicate) the timer.
        r1 = self._create_attempt()
        r2 = self._create_attempt()
        self.assertEqual(r2.status_code, 201, r2.content)
        self.assertEqual(r1.data["id"], r2.data["id"])  # get-or-create reuses it
        self.assertEqual(r2.data.get("current_state"), TestAttempt.STATE_NOT_STARTED)
        self.assertIsNone(TestAttempt.objects.get(pk=r2.data["id"]).module_1_started_at)

    def test_recreate_after_abandon_gives_fresh_held_attempt(self):
        # After abandoning, re-entering yields a fresh NOT_STARTED attempt with the
        # timer held (clean retake) — the abandoned one is left behind.
        r = self._create_attempt()
        att_id = r.data["id"]
        self.client.post(f"/api/exams/attempts/{att_id}/start/", {}, format="json")
        att = TestAttempt.objects.get(pk=att_id)
        att.current_state = TestAttempt.STATE_ABANDONED
        att.abandoned_checkpoint_state = TestAttempt.STATE_MODULE_1_ACTIVE
        att.save(update_fields=["current_state", "abandoned_checkpoint_state", "updated_at"])
        r2 = self._create_attempt()
        self.assertEqual(r2.status_code, 201, r2.content)
        self.assertNotEqual(r2.data["id"], att_id)  # fresh attempt, not the abandoned one
        self.assertEqual(r2.data.get("current_state"), TestAttempt.STATE_NOT_STARTED)
        self.assertIsNone(TestAttempt.objects.get(pk=r2.data["id"]).module_1_started_at)

    def test_start_attempt_still_resumes_an_abandoned_attempt(self):
        # The resume path (start_attempt on a non-NOT_STARTED state) is unchanged by
        # the timer-hold — an ABANDONED attempt still restores to its checkpoint.
        r = self._create_attempt()
        att = TestAttempt.objects.get(pk=r.data["id"])
        att.start_attempt()  # NOT_STARTED -> MODULE_1_ACTIVE
        att.current_state = TestAttempt.STATE_ABANDONED
        att.abandoned_checkpoint_state = TestAttempt.STATE_MODULE_1_ACTIVE
        att.save(update_fields=["current_state", "abandoned_checkpoint_state", "updated_at"])
        att.refresh_from_db()
        att.start_attempt()  # ABANDONED -> resume
        att.refresh_from_db()
        self.assertEqual(att.current_state, TestAttempt.STATE_MODULE_1_ACTIVE)
