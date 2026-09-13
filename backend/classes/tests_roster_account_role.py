"""The roster carries each member's ACCOUNT role, because that is what the teaching team is
titled by.

GET /api/classes/<pk>/people/   → the classroom People page (any member)
GET /api/classes/<pk>/members/  → the same rows, for the ops console

The membership role on each row is a permission tier and cannot name a person: an ownership
transfer leaves the class's teacher as OWNER and the admin who created it as TEACHER, and a
support teacher is always a TA. Read as titles, the People page showed teachers as "Owner" and
admins as "Teacher" (2026-09-13). The frontend now titles staff by ``user.role``; these tests
pin that the field is there, on both endpoints, in its canonical spelling.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Classroom, ClassroomMembership

User = get_user_model()
M = ClassroomMembership


class RosterAccountRole(TestCase):
    def setUp(self):
        def u(email, role):
            user = User.objects.create_user(email, "secret123")
            user.role = role
            user.save(update_fields=["role"])
            return user

        self.teacher = u("acct_teacher@t.com", acc_const.ROLE_TEACHER)
        self.admin = u("acct_admin@t.com", acc_const.ROLE_ADMIN)
        self.owner = u("acct_owner@t.com", acc_const.ROLE_SUPER_ADMIN)
        self.support = u("acct_support@t.com", acc_const.ROLE_SUPPORT_TEACHER)
        self.student = u("acct_student@t.com", acc_const.ROLE_STUDENT)
        # A pre-rename spelling still stored on some old accounts.
        self.legacy = u("acct_legacy@t.com", "math_teacher")

        self.classroom = Classroom.objects.create(
            name="Account roles", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.admin
        )
        # The shape an ownership transfer leaves behind, which is what made the titles wrong.
        M.objects.create(classroom=self.classroom, user=self.teacher, role=M.ROLE_OWNER)
        M.objects.create(classroom=self.classroom, user=self.admin, role=M.ROLE_TEACHER)
        M.objects.create(classroom=self.classroom, user=self.owner, role=M.ROLE_TEACHER)
        M.objects.create(classroom=self.classroom, user=self.support, role=M.ROLE_TA)
        M.objects.create(classroom=self.classroom, user=self.student, role=M.ROLE_STUDENT)
        M.objects.create(classroom=self.classroom, user=self.legacy, role=M.ROLE_TEACHER)
        self.client = APIClient()

    def _rows(self, who, path):
        self.client.force_authenticate(who)
        r = self.client.get(f"/api/classes/{self.classroom.id}/{path}/")
        self.assertEqual(r.status_code, 200, r.content)
        return {row["user"]["email"]: row for row in r.json()}

    def _assert_account_roles(self, rows):
        self.assertEqual(rows["acct_teacher@t.com"]["user"]["role"], "teacher")
        self.assertEqual(rows["acct_admin@t.com"]["user"]["role"], "admin")
        self.assertEqual(rows["acct_owner@t.com"]["user"]["role"], "super_admin")
        self.assertEqual(rows["acct_support@t.com"]["user"]["role"], "support_teacher")
        self.assertEqual(rows["acct_student@t.com"]["user"]["role"], "student")
        # Canonical, so the page needs no copy of the alias table.
        self.assertEqual(rows["acct_legacy@t.com"]["user"]["role"], "teacher")

    def test_people_page_roster_carries_the_account_role(self):
        self._assert_account_roles(self._rows(self.student, "people"))

    def test_ops_roster_carries_the_account_role(self):
        self._assert_account_roles(self._rows(self.teacher, "members"))

    def test_membership_role_is_untouched(self):
        # The permission tier still travels beside it — capabilities are derived from it, and
        # this change is a label, not a permission change.
        rows = self._rows(self.student, "people")
        self.assertEqual(rows["acct_teacher@t.com"]["role"], M.ROLE_OWNER)
        self.assertEqual(rows["acct_admin@t.com"]["role"], M.ROLE_TEACHER)
        self.assertEqual(rows["acct_support@t.com"]["role"], M.ROLE_TA)
