"""Regression: Module 2 must not begin PAUSED.

Production bug: a student who submitted Module 1 while paused — via the manual
Pause button or an auto-pause-on-leave (tab switch) they never resumed — landed
on Module 2 with the countdown frozen. `pause_started_at` is a single
attempt-wide field cleared only by the resume endpoint, and the M1->M2
transition never reset it, so the new module started paused.

Fix: `TestAttempt.submit_module_1()` banks any in-flight pause into Module 1's
ledger and nulls `pause_started_at` so Module 2 always begins running.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_question


class ModuleTransitionClearsPauseTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="pt_student", email="pt_pause@example.com", password="pw12345678",
            is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.user)

        # A two-module pastpaper (both modules have a question, so Module 1 advances
        # to Module 2 rather than skipping straight to scoring).
        self.test = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True,
        )
        self.m1 = Module.objects.create(practice_test=self.test, module_order=1, time_limit_minutes=20)
        self.m2 = Module.objects.create(practice_test=self.test, module_order=2, time_limit_minutes=20)
        seed_mc_question(self.m1, stem="PT M1 Q1")
        seed_mc_question(self.m2, stem="PT M2 Q1")

    def test_module_2_starts_running_when_module_1_submitted_while_paused(self):
        attempt = self.client.post(
            "/api/exams/attempts/", {"practice_test": self.test.id}, format="json"
        ).data
        attempt_id = attempt["id"]

        # A fresh pastpaper is held in NOT_STARTED (welcome-burn fix); begin Module 1.
        started = self.client.post(f"/api/exams/attempts/{attempt_id}/start/", {}, format="json")
        self.assertEqual(started.status_code, 200, started.content)
        self.assertEqual(started.data.get("current_state"), TestAttempt.STATE_MODULE_1_ACTIVE)

        # Simulate: paused during Module 1 (manual or auto-pause on leave) and never
        # resumed before submitting the module.
        paused_at = timezone.now() - timedelta(seconds=30)
        TestAttempt.objects.filter(pk=attempt_id).update(pause_started_at=paused_at)

        r = self.client.post(
            f"/api/exams/attempts/{attempt_id}/submit_module/",
            {"answers": {}, "flagged": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("current_state"), TestAttempt.STATE_MODULE_2_ACTIVE)
        # The API must report Module 2 as running, not paused.
        self.assertFalse(r.data.get("is_paused"), "Module 2 must not begin paused")

        att = TestAttempt.objects.get(pk=attempt_id)
        # pause_started_at cleared at the boundary...
        self.assertIsNone(att.pause_started_at)
        # ...and the in-flight window banked into Module 1's ledger (not Module 2's),
        # so Module 2's timer is full and running.
        self.assertGreaterEqual(att.module_1_paused_seconds, 25)
        self.assertEqual(att.module_2_paused_seconds, 0)
