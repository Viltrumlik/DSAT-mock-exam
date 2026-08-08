from __future__ import annotations

from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import Permission, UserAccess

from classes.models import Classroom
from exams.models import PracticeTest


User = get_user_model()

_ALLOWED_SUBDOMAIN_HOSTS = (
    "localhost",
    "127.0.0.1",
    "testserver",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
)

_ADMIN_HOST = {"HTTP_HOST": "admin.mastersat.uz"}
_QUESTIONS_HOST = {"HTTP_HOST": "questions.mastersat.uz"}


@dataclass(frozen=True)
class RoleUser:
    role: str
    user: object


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_SUBDOMAIN_HOSTS))
class PermissionMatrixEndpointSmokeTests(TestCase):
    """
    Executable permission matrix: role → endpoint access.

    This is intentionally **endpoint-level** (not just `authorize()` unit tests) to catch drift between
    RBAC helpers, DRF permission classes, and host guard routing.
    """

    def setUp(self):
        self.client = APIClient()

        # Ensure core permission rows exist (some endpoints consult DB-permissions).
        for code, name in (
            (acc_const.PERM_MANAGE_TESTS, "Manage tests"),
            (acc_const.PERM_ASSIGN_ACCESS, "Assign access"),
            (acc_const.PERM_MANAGE_USERS, "Manage users"),
        ):
            Permission.objects.get_or_create(codename=code, defaults={"name": name})

        self.student = User.objects.create_user(email="mx_student@example.com", password="x", role=acc_const.ROLE_STUDENT)
        self.teacher_math = User.objects.create_user(
            email="mx_teacher_math@example.com",
            password="x",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        # ABAC: grant teacher global subject access for math (needed for authorize(...subject=...)).
        UserAccess.objects.create(
            user=self.teacher_math,
            subject=acc_const.DOMAIN_MATH,
            classroom=None,
            granted_by=self.teacher_math,
        )
        self.test_admin = User.objects.create_user(
            email="mx_test_admin@example.com", password="x", role=acc_const.ROLE_TEST_ADMIN
        )
        self.admin = User.objects.create_user(email="mx_admin@example.com", password="x", role=acc_const.ROLE_ADMIN)
        self.super_admin = User.objects.create_user(
            email="mx_super_admin@example.com", password="x", role=acc_const.ROLE_SUPER_ADMIN
        )

        self._role_users: list[RoleUser] = [
            RoleUser(acc_const.ROLE_STUDENT, self.student),
            RoleUser(acc_const.ROLE_TEACHER, self.teacher_math),
            RoleUser(acc_const.ROLE_TEST_ADMIN, self.test_admin),
            RoleUser(acc_const.ROLE_ADMIN, self.admin),
            RoleUser(acc_const.ROLE_SUPER_ADMIN, self.super_admin),
        ]

        # Data needed for bulk-assign POST (permission class inspects payload + referenced objects).
        self.practice_test_math = PracticeTest.objects.create(
            subject=acc_const.SUBJECT_MATH_PLATFORM,
            title="M",
            skip_default_modules=True,
        )

        # For directory endpoint: create a class owned by teacher (not by super_admin).
        self.classroom = Classroom.objects.create(
            name="Matrix class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher_math,
        )

    def _as(self, u):
        self.client.force_authenticate(user=u)
        return self.client

    def test_questions_authoring_list_tests_matrix(self):
        """
        /api/exams/admin/tests/ (questions.*) is content-authoring surface: staff authoring only.

        Teachers were added deliberately — see ``access.services.can_manage_questions``,
        "Authoring rights extended to teachers so they can prepare their own assessments,
        mock exams, and practice tests for their classrooms." This matrix kept the older
        answer, and nothing said so while backend CI was down.
        """
        url = "/api/exams/admin/tests/"
        allowed = {
            acc_const.ROLE_TEACHER,
            acc_const.ROLE_TEST_ADMIN,
            acc_const.ROLE_ADMIN,
            acc_const.ROLE_SUPER_ADMIN,
        }
        for ru in self._role_users:
            c = self._as(ru.user)
            r = c.get(url, **_QUESTIONS_HOST)
            if ru.role in allowed:
                self.assertEqual(r.status_code, 200, (ru.role, r.status_code, r.content))
            else:
                self.assertIn(r.status_code, (403, 404), (ru.role, r.status_code, r.content))

    def test_admin_bulk_assign_matrix(self):
        """
        /api/exams/bulk_assign/ (admin.*) is staff assignment surface.

        ``test_admin`` is not on the list. The gate is ``BulkAssignAccess``, which asks for
        ``assign_access`` in each subject the payload touches; unlike ``manage_tests``, no
        role implies it, and this fixture's tester holds no grant. The host guard letting
        testers onto ``admin.*`` for bulk-assign is a separate, coarser thing — reaching the
        console is not the same as being entitled to assign. A real tester who has been
        granted ``assign_access`` still passes.
        """
        url = "/api/exams/bulk_assign/"
        # Target student assignment so view can proceed when authorized.
        payload = {
            "user_ids": [self.student.pk],
            "practice_test_ids": [self.practice_test_math.pk],
            "exam_ids": [],
            "assignment_type": "FULL",
        }
        allowed = {acc_const.ROLE_TEACHER, acc_const.ROLE_ADMIN, acc_const.ROLE_SUPER_ADMIN}
        for ru in self._role_users:
            c = self._as(ru.user)
            r = c.post(url, data=payload, format="json", **_ADMIN_HOST)
            if ru.role in allowed:
                # Allowed roles may still see 200/201/409 depending on idempotency window and payload handling,
                # but must not be denied at the permission layer.
                self.assertNotEqual(r.status_code, 403, (ru.role, r.status_code, r.content))
            else:
                self.assertEqual(r.status_code, 403, (ru.role, r.status_code, r.content))

    def test_classes_directory_matrix(self):
        """
        /api/classes/directory/ is privileged listing (not membership-scoped).

        ``admin`` belongs here: the view states its own rule as "governance: admin /
        super_admin / superuser", and the ops console's subject → level → classroom picker
        reads it. This matrix was written before that.
        """
        url = "/api/classes/directory/"
        allowed = {acc_const.ROLE_ADMIN, acc_const.ROLE_SUPER_ADMIN}
        for ru in self._role_users:
            c = self._as(ru.user)
            r = c.get(url)
            if ru.role in allowed:
                self.assertEqual(r.status_code, 200, (ru.role, r.status_code, r.content))
            else:
                self.assertEqual(r.status_code, 403, (ru.role, r.status_code, r.content))

