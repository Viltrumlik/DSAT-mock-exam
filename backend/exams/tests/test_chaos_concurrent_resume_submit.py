from __future__ import annotations

import threading
import unittest

import django.db
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()

_ALLOWED_FOR_SUBDOMAIN_TESTS = (
    "testserver",
    "localhost",
    "127.0.0.1",
)


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_FOR_SUBDOMAIN_TESTS))
class ExamEngineChaosConcurrencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(
            email="student-chaos@example.com",
            password="pw",
            role=acc_const.ROLE_STUDENT,
        )

        self.pt = PracticeTest.objects.create(
            subject="MATH",
            form_type="INTERNATIONAL",
            mock_exam=None,
            title="Chaos PT",
            skip_default_modules=True,
        )
        Module.objects.create(practice_test=self.pt, module_order=1, time_limit_minutes=35)
        Module.objects.create(practice_test=self.pt, module_order=2, time_limit_minutes=35)
        seed_mc_questions_for_practice_test(self.pt, questions_per_module=2)
        # Attempt-create is now gated to assigned pastpapers for students; grant access.
        self.pt.assigned_users.add(self.student)

    @unittest.skipUnless(
        django.db.connection.vendor == "postgresql",
        "Parallel resume stress test requires PostgreSQL (SQLite table locks under threads).",
    )
    def test_concurrent_resume_is_stable(self):
        self.client.force_authenticate(user=self.student)
        r = self.client.post("/api/exams/attempts/", data={"practice_test": self.pt.id}, format="json")
        self.assertEqual(r.status_code, 201)
        attempt_id = int(r.json()["id"])

        # Start engine once.
        r2 = self.client.post(f"/api/exams/attempts/{attempt_id}/start/", format="json", HTTP_IDEMPOTENCY_KEY="chaos.start")
        self.assertIn(r2.status_code, (200, 201))

        errs: list[int] = []

        def worker(i: int):
            c = APIClient()
            c.force_authenticate(user=self.student)
            rr = c.post(
                f"/api/exams/attempts/{attempt_id}/resume/",
                format="json",
                HTTP_IDEMPOTENCY_KEY=f"chaos.resume.{i}",
            )
            if rr.status_code not in (200, 400):
                errs.append(rr.status_code)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errs, [])
        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertFalse(attempt.is_completed)

    @unittest.skipUnless(
        django.db.connection.vendor == "postgresql",
        "Parallel submit stress test requires PostgreSQL (SQLite table locks under threads).",
    )
    def test_concurrent_submit_module_does_not_duplicate_transition(self):
        self.client.force_authenticate(user=self.student)
        r = self.client.post("/api/exams/attempts/", data={"practice_test": self.pt.id}, format="json")
        self.assertEqual(r.status_code, 201)
        attempt_id = int(r.json()["id"])

        r2 = self.client.post(f"/api/exams/attempts/{attempt_id}/start/", format="json", HTTP_IDEMPOTENCY_KEY="chaos.start")
        self.assertIn(r2.status_code, (200, 201))

        errs: list[int] = []

        def submit(i: int):
            c = APIClient()
            c.force_authenticate(user=self.student)
            rr = c.post(
                f"/api/exams/attempts/{attempt_id}/submit_module/",
                data={"answers": {}, "flagged": []},
                format="json",
                HTTP_IDEMPOTENCY_KEY=f"chaos.submit.{i}",
            )
            if rr.status_code not in (200, 400, 409, 500):
                errs.append(rr.status_code)

        threads = [threading.Thread(target=submit, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errs, [])

        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertIsNotNone(attempt.current_state)
        self.assertLessEqual(int(attempt.version_number or 0), 50)

