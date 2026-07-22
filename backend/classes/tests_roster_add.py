"""Code-less student enrollment + roster read for the ops admin panel.

GET   /api/classes/<pk>/members/           → roster (non-removed; ?include_removed=1 for all)
POST  /api/classes/<pk>/members/ {user_id}  → enroll a student WITHOUT a join code (admins only)

Mirrors JoinClassView semantics: reactivate a previously-removed student, enforce
max_students, and create the per-classroom subject UserAccess grant.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from classes.models import Classroom, ClassroomMembership

User = get_user_model()
M = ClassroomMembership


class RosterAddFixture(TestCase):
    def setUp(self):
        def u(email, role="student"):
            user = User.objects.create_user(email, "secret123")
            if role != "student":
                user.role = role
                user.save(update_fields=["role"])
            return user

        self.admin = u("roster_admin@t.com", role=acc_const.ROLE_ADMIN)
        self.teacher = u("roster_teacher@t.com", role=acc_const.ROLE_TEACHER)
        self.student = u("roster_student@t.com")
        self.other_student = u("roster_student2@t.com")
        self.classroom = Classroom.objects.create(
            name="Roster", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.teacher
        )
        M.objects.create(classroom=self.classroom, user=self.teacher, role=M.ROLE_TEACHER)
        self.client = APIClient()

    def as_(self, who):
        self.client.force_authenticate(who)
        return self.client

    @property
    def roster_url(self):
        return f"/api/classes/{self.classroom.id}/members/"

    def _add(self, who, user_id):
        return self.as_(who).post(self.roster_url, {"user_id": user_id}, format="json")


class CodelessAdd(RosterAddFixture):
    def test_admin_adds_student_creates_membership_and_access(self):
        r = self._add(self.admin, self.student.id)
        self.assertEqual(r.status_code, 201, r.content)
        mem = M.objects.get(classroom=self.classroom, user=self.student)
        self.assertEqual(mem.role, M.ROLE_STUDENT)
        self.assertEqual(mem.status, M.STATUS_ACTIVE)
        # Parity with JoinClassView: the subject access grant must exist.
        self.assertTrue(
            UserAccess.objects.filter(
                user=self.student, classroom=self.classroom, subject=acc_const.DOMAIN_MATH
            ).exists()
        )

    def test_add_is_idempotent_for_active_member(self):
        self.assertEqual(self._add(self.admin, self.student.id).status_code, 201)
        r = self._add(self.admin, self.student.id)
        self.assertEqual(r.status_code, 200, r.content)  # already active → 200, not a duplicate row
        self.assertEqual(M.objects.filter(classroom=self.classroom, user=self.student).count(), 1)

    def test_add_reactivates_removed_student(self):
        M.objects.create(
            classroom=self.classroom, user=self.student, role=M.ROLE_STUDENT, status=M.STATUS_REMOVED
        )
        r = self._add(self.admin, self.student.id)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            M.objects.get(classroom=self.classroom, user=self.student).status, M.STATUS_ACTIVE
        )

    def test_teacher_cannot_codeless_add(self):
        # Ordinary teachers keep the join-code flow; code-less add is admin-only.
        self.assertEqual(self._add(self.teacher, self.student.id).status_code, 403)

    def test_student_cannot_codeless_add(self):
        M.objects.create(classroom=self.classroom, user=self.student, role=M.ROLE_STUDENT)
        self.assertEqual(self._add(self.student, self.other_student.id).status_code, 403)

    def test_cannot_enroll_a_non_student_account(self):
        r = self._add(self.admin, self.teacher.id)
        self.assertEqual(r.status_code, 400, r.content)

    def test_missing_user_id_is_400(self):
        self.assertEqual(self.as_(self.admin).post(self.roster_url, {}, format="json").status_code, 400)

    def test_unknown_user_is_404(self):
        self.assertEqual(self._add(self.admin, 999999).status_code, 404)


class MaxStudentsCap(RosterAddFixture):
    def test_cap_blocks_net_new_but_reactivation_bypasses(self):
        self.classroom.max_students = 1
        self.classroom.save(update_fields=["max_students"])
        # First student fills the single seat.
        self.assertEqual(self._add(self.admin, self.student.id).status_code, 201)
        # Second net-new student is rejected — group is full.
        self.assertEqual(self._add(self.admin, self.other_student.id).status_code, 400)
        # Removing the first frees a seat, and re-adding them (reactivation) still works.
        self.as_(self.admin).patch(
            f"/api/classes/{self.classroom.id}/members/{self.student.id}/",
            {"status": M.STATUS_REMOVED}, format="json",
        )
        self.assertEqual(self._add(self.admin, self.student.id).status_code, 200)


class RosterRead(RosterAddFixture):
    def test_admin_reads_roster_excluding_removed_by_default(self):
        self._add(self.admin, self.student.id)
        M.objects.create(
            classroom=self.classroom, user=self.other_student, role=M.ROLE_STUDENT, status=M.STATUS_REMOVED
        )
        r = self.as_(self.admin).get(self.roster_url)
        self.assertEqual(r.status_code, 200)
        ids = {row["user"]["id"] for row in r.json()}
        self.assertIn(self.student.id, ids)
        self.assertNotIn(self.other_student.id, ids)  # REMOVED hidden by default

    def test_include_removed_shows_removed(self):
        M.objects.create(
            classroom=self.classroom, user=self.other_student, role=M.ROLE_STUDENT, status=M.STATUS_REMOVED
        )
        r = self.as_(self.admin).get(self.roster_url + "?include_removed=1")
        ids = {row["user"]["id"] for row in r.json()}
        self.assertIn(self.other_student.id, ids)
