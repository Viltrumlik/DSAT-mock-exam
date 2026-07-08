"""
Guards exercised under PostgreSQL semantics (locking + MVCC).

The default Django test SQLite backend does not model Postgres behavior; tests are skipped there.
"""

from __future__ import annotations

import threading
import unittest

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import Module, PracticeTest, Question

User = get_user_model()

_ALLOWED_FOR_SUBDOMAIN_TESTS = (
    "testserver",
    "localhost",
    "127.0.0.1",
)

_POSTGRES_ENGINE = settings.DATABASES["default"].get("ENGINE", "")
requires_postgres = unittest.skipUnless(
    "postgresql" in _POSTGRES_ENGINE,
    "PostgreSQL backend required for cross-session locking semantics.",
)


def _exam_client(student) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=student)
    return c


@requires_postgres
@override_settings(ALLOWED_HOSTS=list(_ALLOWED_FOR_SUBDOMAIN_TESTS))
@override_settings(CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
class ExamEnginePostgresConcurrency(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="pg-engine@example.com",
            password="pw",
            role=acc_const.ROLE_STUDENT,
        )
        self.pt = PracticeTest.objects.create(
            subject="MATH",
            form_type="INTERNATIONAL",
            mock_exam=None,
            title="PG Engine PT",
            skip_default_modules=True,
        )
        m1 = Module.objects.create(practice_test=self.pt, module_order=1, time_limit_minutes=35)
        m2 = Module.objects.create(practice_test=self.pt, module_order=2, time_limit_minutes=35)
        for _i in range(2):
            Question.objects.create(module=m1, question_type="MATH", question_text="Q1", correct_answers="a")
            Question.objects.create(module=m2, question_type="MATH", question_text="Q2", correct_answers="a")
        # Attempt-create is now gated to assigned pastpapers for students; grant access.
        self.pt.assigned_users.add(self.student)

    def test_parallel_resume_requests_serializes_and_stays_consistent(self):
        c0 = _exam_client(self.student)
        r = c0.post("/api/exams/attempts/", data={"practice_test": self.pt.id}, format="json")
        self.assertEqual(r.status_code, 201)
        attempt_id = int(r.json()["id"])
        rr = c0.post(
            f"/api/exams/attempts/{attempt_id}/start/",
            format="json",
            HTTP_IDEMPOTENCY_KEY="pg.start.once",
        )
        self.assertIn(rr.status_code, (200, 201))

        bad_status: list[int] = []

        def worker(i: int):
            cx = APIClient()
            cx.force_authenticate(user=self.student)
            out = cx.post(
                f"/api/exams/attempts/{attempt_id}/resume/",
                format="json",
                HTTP_IDEMPOTENCY_KEY=f"pg.resume.{i}",
            )
            if out.status_code not in (200, 400):
                bad_status.append(out.status_code)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(bad_status, [])
