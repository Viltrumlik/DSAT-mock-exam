"""Classroom creation is an admin-only governance action.

Teachers are assigned to classrooms by admins (see AssignTeacherView); they must not
create their own classrooms. The create endpoint (``POST /api/classes/``) is guarded so
that only global-scope staff (admin / super_admin / Django superuser) can create — even
though the ``teacher`` role still carries ``PERM_CREATE_CLASSROOM`` (that permission also
gates the assignable-teacher list and is intentionally NOT revoked from the role).
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from classes.models import Classroom

User = get_user_model()


class ClassroomCreateIsAdminOnlyTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # A fully-provisioned teacher who WOULD pass authorize(PERM_CREATE_CLASSROOM):
        # correct domain subject + a global UserAccess grant. The endpoint guard must
        # still block them, proving the restriction is at the endpoint (not the role perm).
        self.teacher = User.objects.create_user(
            email="cc_teacher@example.com",
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

        self.admin = User.objects.create_user(
            email="cc_admin@example.com", password="x", role=acc_const.ROLE_ADMIN
        )
        self.student = User.objects.create_user(
            email="cc_student@example.com", password="x", role=acc_const.ROLE_STUDENT
        )

        self.payload = {
            "name": "Admin-created class",
            "subject": Classroom.SUBJECT_MATH,
            "lesson_days": Classroom.DAYS_ODD,
        }

    def _as(self, user):
        self.client.force_authenticate(user=user)
        return self.client

    def test_teacher_cannot_create_classroom(self):
        resp = self._as(self.teacher).post("/api/classes/", self.payload, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(Classroom.objects.filter(name="Admin-created class").exists())

    def test_student_cannot_create_classroom(self):
        resp = self._as(self.student).post("/api/classes/", self.payload, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(Classroom.objects.filter(name="Admin-created class").exists())

    def test_admin_can_create_classroom(self):
        resp = self._as(self.admin).post("/api/classes/", self.payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(Classroom.objects.filter(name="Admin-created class").exists())

    def test_assigned_teacher_becomes_member_and_sees_classroom(self):
        from classes.models import ClassroomMembership

        created = self._as(self.admin).post("/api/classes/", self.payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        cid = created.json()["id"]

        assigned = self._as(self.admin).post(
            f"/api/classes/{cid}/assign-teacher/", {"user_id": self.teacher.pk}, format="json"
        )
        self.assertEqual(assigned.status_code, 200, assigned.content)

        mem = ClassroomMembership.objects.filter(classroom_id=cid, user=self.teacher).first()
        self.assertIsNotNone(mem, "teacher should have a membership row after assignment")
        self.assertEqual(mem.status, ClassroomMembership.STATUS_ACTIVE)

        listing = self._as(self.teacher).get("/api/classes/")
        body = listing.json()
        rows = body if isinstance(body, list) else body.get("results", body.get("items", []))
        ids = [c.get("id") for c in rows]
        self.assertIn(cid, ids, f"assigned teacher should see the classroom; got {ids}")

    def test_create_with_teacher_id_auto_enrolls_teacher(self):
        """Admin picks a teacher in the create form → teacher is set AND auto-added as an
        active member in the same request (no separate assign call)."""
        from classes.models import ClassroomMembership

        payload = {**self.payload, "teacher_id": self.teacher.pk}
        created = self._as(self.admin).post("/api/classes/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        cid = created.json()["id"]
        self.assertEqual(created.json().get("teacher"), self.teacher.pk)

        mem = ClassroomMembership.objects.filter(classroom_id=cid, user=self.teacher).first()
        self.assertIsNotNone(mem, "teacher should be enrolled on create")
        self.assertEqual(mem.role, ClassroomMembership.ROLE_TEACHER)
        self.assertEqual(mem.status, ClassroomMembership.STATUS_ACTIVE)

        listing = self._as(self.teacher).get("/api/classes/")
        body = listing.json()
        rows = body if isinstance(body, list) else body.get("results", body.get("items", []))
        ids = [c.get("id") for c in rows]
        self.assertIn(cid, ids, f"teacher assigned at create should see the classroom; got {ids}")
