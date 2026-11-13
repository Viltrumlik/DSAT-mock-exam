"""Teachers out of the admin panel, and money out of what they can read (plan 2026-11-12-crm-roles, PR 5).

The owner's answer (Q6): teachers do not enter the admin panel; they keep the Teacher Portal. The people pages
open with ``view_people``, their money with ``view_money``, and a class's archive, branch and teacher are the
desk's (``manage_groups``) even through the general class edit.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C
from access.models import Permission, UserPermission
from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink

User = get_user_model()
ADMIN_HOST = "admin.mastersat.uz"
TEACHER_HOST = "teacher.mastersat.uz"


@override_settings(ALLOWED_HOSTS=["testserver", ADMIN_HOST, TEACHER_HOST])
class TeachersOutCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(email="to-admin@example.com", password="pw-long-123", role=C.ROLE_ADMIN)
        cls.accountant = User.objects.create_user(email="to-acc@example.com", password="pw-long-123", role=C.ROLE_ACCOUNTANT)
        cls.teacher = User.objects.create_user(
            email="to-teacher@example.com", password="pw-long-123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH,
        )
        cls.student = User.objects.create_user(
            email="to-student@example.com", password="pw-long-123", role=C.ROLE_STUDENT, first_name="Ali",
        )
        LcupStudentLink.objects.create(lcup_student_id=901, name="Ali", user=cls.student, balance=-500000)

    def call(self, actor, method, url, body=None, host=ADMIN_HOST):
        # A real bearer token, not force_authenticate: the host guard is middleware and must see who it is.
        token = RefreshToken.for_user(actor).access_token
        return getattr(APIClient(), method)(
            url, body or {}, format="json", HTTP_HOST=host, HTTP_AUTHORIZATION=f"Bearer {token}"
        )

    def login(self, email, host=ADMIN_HOST):
        client = Client()
        client.get("/api/auth/csrf/", HTTP_HOST=host)
        return client.post(
            "/api/auth/login/", data={"email": email, "password": "pw-long-123"}, content_type="application/json",
            HTTP_HOST=host, HTTP_ORIGIN=f"https://{host}", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )


class AdminPanelRefusesTeachersTests(TeachersOutCase):
    def test_signing_in_on_the_admin_panel_points_a_teacher_to_the_portal(self):
        res = self.login("to-teacher@example.com")
        self.assertEqual(res.status_code, 403, res.content)
        self.assertIn("Teacher Portal", res.json()["detail"])

    def test_the_same_teacher_signs_in_on_the_portal(self):
        res = self.login("to-teacher@example.com", host=TEACHER_HOST)
        self.assertEqual(res.status_code, 200, res.content)

    def test_an_open_session_reaches_only_who_am_i_on_the_admin_panel(self):
        self.assertEqual(self.call(self.teacher, "get", "/api/users/me/").status_code, 200)
        res = self.call(self.teacher, "get", "/api/users/admin/people/?section=students")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["code"], "teacher_portal")

    def test_the_desk_still_signs_in_on_the_admin_panel(self):
        res = self.login("to-acc@example.com")
        self.assertEqual(res.status_code, 200, res.content)


class PeopleAndMoneyTests(TeachersOutCase):
    def balance_of_ali(self, actor):
        res = self.call(actor, "get", "/api/users/admin/people/?section=students")
        self.assertEqual(res.status_code, 200, res.content)
        row = next(r for r in res.json()["results"] if r["id"] == self.student.pk)
        return row["lcup"]["balance"]

    def test_the_accountant_reads_students_and_their_money(self):
        self.assertEqual(self.balance_of_ali(self.accountant), -500000)
        res = self.call(self.accountant, "get", f"/api/users/admin/people/{self.student.pk}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNotNone(res.json()["lcup"])

    def test_without_view_money_the_balance_and_payments_are_left_out(self):
        permission, _ = Permission.objects.get_or_create(codename=C.PERM_VIEW_MONEY, defaults={"name": "x"})
        UserPermission.objects.create(user=self.admin, permission=permission, granted=False)
        self.assertIsNone(self.balance_of_ali(self.admin))
        res = self.call(self.admin, "get", f"/api/users/admin/people/{self.student.pk}/")
        self.assertIsNone(res.json()["lcup"])

    def test_reading_is_not_changing(self):
        res = self.call(self.accountant, "patch", f"/api/users/{self.student.pk}/update/", {"first_name": "Okay"})
        self.assertEqual(res.status_code, 403)


class ClassEditTests(TeachersOutCase):
    def setUp(self):
        self.room = Classroom.objects.create(
            name="Junior G1", subject=Classroom.SUBJECT_MATH, lesson_days="ODD", teacher=self.teacher, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)

    def patch(self, actor, body):
        return self.call(actor, "patch", f"/api/classes/{self.room.pk}/", body, host=TEACHER_HOST)

    def test_the_class_teacher_cannot_archive_it(self):
        res = self.patch(self.teacher, {"is_active": False})
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(res.json()["fields"], ["is_active"])
        self.room.refresh_from_db()
        self.assertTrue(self.room.is_active)

    def test_the_class_teacher_still_edits_the_rest_even_with_the_fields_posted_unchanged(self):
        res = self.patch(self.teacher, {"name": "Junior G1 (evening)", "is_active": True})
        self.assertEqual(res.status_code, 200, res.content)
        self.room.refresh_from_db()
        self.assertEqual(self.room.name, "Junior G1 (evening)")
