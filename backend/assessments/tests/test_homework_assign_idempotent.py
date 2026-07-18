from __future__ import annotations

import threading

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments.models import AssessmentQuestion, AssessmentSet, HomeworkAssignment
from classes.models import Classroom, ClassroomMembership

_ALLOWED_SUBDOMAIN_HOSTS = (
    "localhost",
    "127.0.0.1",
    "testserver",
    "admin.mastersat.uz",
)


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_SUBDOMAIN_HOSTS))
class HomeworkAssignRaceTests(TransactionTestCase):
    """
    Concurrency regression: UNIQUE(classroom, assessment_set) + assign view must yield
    exactly one canonical ``HomeworkAssignment`` under simultaneous POST /homework/assign/.
    """

    reset_sequences = True

    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="tmath_race@example.com",
            password="x",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher,
            subject=acc_const.DOMAIN_MATH,
            classroom=None,
            granted_by=self.teacher,
        )

        self.classroom = Classroom.objects.create(
            name="Math class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom,
            user=self.teacher,
            role=ClassroomMembership.ROLE_ADMIN,
        )

        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="algebra",
            title="Algebra set",
            created_by=self.teacher,
            is_active=True,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=1,
            prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=4,
            points=1,
            is_active=True,
        )

    def _post_assign(self, *, barrier: threading.Barrier, out: list, idx: int):
        try:
            c = APIClient()
            c.force_authenticate(self.teacher)
            barrier.wait(timeout=5)
            resp = c.post(
                "/api/assessments/homework/assign/",
                data={"classroom_id": self.classroom.id, "set_id": self.aset.id, "title": "HW"},
                format="json",
                HTTP_HOST="admin.mastersat.uz",
            )
            json_body = None
            ct = (resp.headers.get("Content-Type") or "").lower()
            if "application/json" in ct:
                try:
                    json_body = resp.json()
                except ValueError:
                    json_body = None
            out[idx] = {"status": resp.status_code, "json": json_body}
        except BaseException as exc:
            out[idx] = {"status": None, "json": None, "error": f"{type(exc).__name__}: {exc}"}

    def test_serial_duplicate_assign_single_row_under_unique_constraint(self):
        """UNIQUE(classroom, set) — second POST returns the canonical row (all backends)."""
        c = APIClient()
        c.force_authenticate(self.teacher)
        body = {"classroom_id": self.classroom.id, "set_id": self.aset.id, "title": "HW"}
        r1 = c.post("/api/assessments/homework/assign/", body, format="json", HTTP_HOST="admin.mastersat.uz")
        self.assertEqual(r1.status_code, 201, getattr(r1, "content", b""))
        r2 = c.post("/api/assessments/homework/assign/", body, format="json", HTTP_HOST="admin.mastersat.uz")
        self.assertEqual(r2.status_code, 201, getattr(r2, "content", b""))
        self.assertEqual(
            HomeworkAssignment.objects.filter(classroom=self.classroom, assessment_set=self.aset).count(),
            1,
        )
        self.assertEqual(r1.json().get("id"), r2.json().get("id"))
        self.assertEqual(r1.json().get("assignment_id"), r2.json().get("assignment_id"))

    def test_concurrent_assign_creates_single_homework_row(self):
        if connection.vendor != "postgresql":
            self.skipTest("Multi-threaded assign stress requires PostgreSQL; SQLite triggers table locks.")
        barrier = threading.Barrier(2)
        out = [None, None]
        t1 = threading.Thread(target=self._post_assign, kwargs={"barrier": barrier, "out": out, "idx": 0})
        t2 = threading.Thread(target=self._post_assign, kwargs={"barrier": barrier, "out": out, "idx": 1})
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        for r in out:
            self.assertIsNotNone(r, msg=str(r))
            self.assertEqual(r["status"], 201, msg=str(r))

        self.assertEqual(
            HomeworkAssignment.objects.filter(classroom=self.classroom, assessment_set=self.aset).count(),
            1,
        )

    def test_concurrent_six_way_assign_single_homework_row(self):
        if connection.vendor != "postgresql":
            self.skipTest("Multi-threaded assign stress requires PostgreSQL; SQLite triggers table locks.")
        barrier = threading.Barrier(6)
        out = [None] * 6
        threads = [
            threading.Thread(target=self._post_assign, kwargs={"barrier": barrier, "out": out, "idx": i})
            for i in range(6)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        for r in out:
            self.assertIsNotNone(r)
            self.assertEqual(r["status"], 201, msg=r)
        self.assertEqual(
            HomeworkAssignment.objects.filter(classroom=self.classroom, assessment_set=self.aset).count(),
            1,
        )

