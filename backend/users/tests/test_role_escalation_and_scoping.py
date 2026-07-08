"""Security regressions for user-management authorization.

Covers three hardening fixes:

* Fix 1 — privilege escalation: only a super_admin (or Django superuser) may
  create/promote a user to ``super_admin``; a plain admin is rejected.
* Fix 2 — IDOR: single-object update/delete are scoped to the actor's
  ``manageable_users_queryset`` (out-of-scope targets 404).
* Fix 3 — login brute-force: repeated failed logins from one IP are throttled.
"""
from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import Permission, UserAccess, UserPermission
from users.views import LoginRateThrottle

User = get_user_model()


class RoleEscalationTests(TestCase):
    """Fix 1: an actor may not assign a role it does not outrank."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            email="esc-admin@example.com", password="pw", role=acc_const.ROLE_ADMIN
        )
        cls.super_admin = User.objects.create_user(
            email="esc-super@example.com", password="pw", role=acc_const.ROLE_SUPER_ADMIN
        )
        cls.student = User.objects.create_user(
            email="esc-stu@example.com", password="pw", role=acc_const.ROLE_STUDENT
        )

    def setUp(self):
        self.client = APIClient()

    def _create(self, actor, email, role):
        self.client.force_authenticate(actor)
        return self.client.post(
            reverse("user-create"),
            {"email": email, "password": "pw123456", "role": role},
            format="json",
        )

    def _update_role(self, actor, target, role):
        self.client.force_authenticate(actor)
        return self.client.patch(
            reverse("user-update", args=[target.pk]), {"role": role}, format="json"
        )

    # ── Rejections ───────────────────────────────────────────────────────────
    def test_admin_cannot_create_super_admin(self):
        res = self._create(self.admin, "new-super@example.com", acc_const.ROLE_SUPER_ADMIN)
        self.assertEqual(res.status_code, 400, res.content)
        self.assertFalse(User.objects.filter(email="new-super@example.com").exists())

    def test_admin_cannot_promote_to_super_admin(self):
        res = self._update_role(self.admin, self.student, acc_const.ROLE_SUPER_ADMIN)
        self.assertEqual(res.status_code, 400, res.content)
        self.student.refresh_from_db()
        self.assertEqual(self.student.role, acc_const.ROLE_STUDENT)

    # ── Allowed flows preserved ──────────────────────────────────────────────
    def test_super_admin_can_create_super_admin(self):
        res = self._create(self.super_admin, "ok-super@example.com", acc_const.ROLE_SUPER_ADMIN)
        self.assertEqual(res.status_code, 201, res.content)
        created = User.objects.get(email="ok-super@example.com")
        self.assertEqual(created.role, acc_const.ROLE_SUPER_ADMIN)

    def test_admin_can_still_assign_lower_roles(self):
        res = self._create(self.admin, "ok-teacher@example.com", acc_const.ROLE_TEACHER)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(
            User.objects.get(email="ok-teacher@example.com").role, acc_const.ROLE_TEACHER
        )


class SingleObjectScopeTests(TestCase):
    """Fix 2: subject-scoped managers can only update/delete in-scope users."""

    def setUp(self):
        self.client = APIClient()
        # A math teacher granted manage_users (subject-scoped manager).
        self.teacher = User.objects.create_user(
            email="scope-teacher@example.com", password="pw", role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        perm, _ = Permission.objects.get_or_create(codename=acc_const.PERM_MANAGE_USERS)
        UserPermission.objects.create(user=self.teacher, permission=perm, granted=True)
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH, granted_by=self.teacher
        )
        # In-scope student (has a math grant) vs out-of-scope student (no grant).
        self.in_scope = User.objects.create_user(
            email="scope-in@example.com", password="pw", role=acc_const.ROLE_STUDENT
        )
        UserAccess.objects.create(
            user=self.in_scope, subject=acc_const.DOMAIN_MATH, granted_by=self.teacher
        )
        self.out_scope = User.objects.create_user(
            email="scope-out@example.com", password="pw", role=acc_const.ROLE_STUDENT
        )

    def test_update_out_of_scope_returns_404(self):
        self.client.force_authenticate(self.teacher)
        res = self.client.patch(
            reverse("user-update", args=[self.out_scope.pk]),
            {"first_name": "X"}, format="json",
        )
        self.assertEqual(res.status_code, 404, res.content)

    def test_delete_out_of_scope_returns_404(self):
        self.client.force_authenticate(self.teacher)
        res = self.client.delete(reverse("user-delete", args=[self.out_scope.pk]))
        self.assertEqual(res.status_code, 404, res.content)
        self.assertTrue(User.objects.filter(pk=self.out_scope.pk).exists())

    def test_delete_in_scope_succeeds(self):
        self.client.force_authenticate(self.teacher)
        res = self.client.delete(reverse("user-delete", args=[self.in_scope.pk]))
        self.assertEqual(res.status_code, 204, res.content)
        self.assertFalse(User.objects.filter(pk=self.in_scope.pk).exists())


class LoginThrottleTests(TestCase):
    """Fix 3: the login endpoint throttles repeated attempts per IP."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.url = reverse("token_obtain_pair")
        User.objects.create_user(
            email="throttle@example.com", password="rightpass", role=acc_const.ROLE_STUDENT
        )

    def tearDown(self):
        cache.clear()

    def test_repeated_failed_logins_are_throttled(self):
        # Tighten the rate so the test is fast and deterministic regardless of env.
        with mock.patch.object(LoginRateThrottle, "rate", "3/min", create=True):
            statuses = []
            for _ in range(5):
                r = self.client.post(
                    self.url,
                    {"email": "throttle@example.com", "password": "wrong"},
                    format="json",
                )
                statuses.append(r.status_code)
        self.assertNotEqual(statuses[0], 429)
        self.assertIn(429, statuses, statuses)
