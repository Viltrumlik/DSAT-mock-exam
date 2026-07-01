"""Bulk user management endpoint: POST /api/users/admin/bulk/.

Covers each action, partial per-id results, permission gating, and the
security-critical scope isolation (a subject-scoped teacher may only act on
users their own directory would return).
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import Permission, UserAccess, UserPermission

User = get_user_model()


class UserBulkActionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            email="bulk-admin@example.com",
            password="pw",
            role="super_admin",
            is_staff=True,
            is_superuser=True,
        )
        cls.s1 = User.objects.create_user(email="bulk-s1@example.com", password="pw", role="student")
        cls.s2 = User.objects.create_user(email="bulk-s2@example.com", password="pw", role="student")
        cls.s3 = User.objects.create_user(email="bulk-s3@example.com", password="pw", role="student")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = reverse("admin-user-bulk")

    def _post(self, action, ids):
        return self.client.post(self.url, {"action": action, "ids": ids}, format="json")

    # ── Happy paths ──────────────────────────────────────────────────────────
    def test_bulk_freeze_students_sets_flag(self):
        res = self._post("freeze", [self.s1.id, self.s2.id])
        self.assertEqual(res.status_code, 200)
        self.assertTrue(all(r["ok"] for r in res.data["results"]))
        self.s1.refresh_from_db()
        self.s2.refresh_from_db()
        self.assertTrue(self.s1.is_frozen)
        self.assertTrue(self.s2.is_frozen)

    def test_bulk_unfreeze(self):
        User.objects.filter(pk__in=[self.s1.id, self.s2.id]).update(is_frozen=True)
        res = self._post("unfreeze", [self.s1.id, self.s2.id])
        self.assertEqual(res.status_code, 200)
        self.s1.refresh_from_db()
        self.assertFalse(self.s1.is_frozen)

    def test_bulk_activate_and_deactivate(self):
        res = self._post("deactivate", [self.s1.id])
        self.assertEqual(res.status_code, 200)
        self.s1.refresh_from_db()
        self.assertFalse(self.s1.is_active)

        res = self._post("activate", [self.s1.id])
        self.assertEqual(res.status_code, 200)
        self.s1.refresh_from_db()
        self.assertTrue(self.s1.is_active)

    def test_bulk_delete_removes_rows(self):
        res = self._post("delete", [self.s3.id])
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["results"][0]["deleted"])
        self.assertFalse(User.objects.filter(pk=self.s3.id).exists())

    def test_idempotent_freeze(self):
        self._post("freeze", [self.s1.id])
        res = self._post("freeze", [self.s1.id])
        self.assertTrue(res.data["results"][0]["ok"])
        self.s1.refresh_from_db()
        self.assertTrue(self.s1.is_frozen)

    # ── Partial results ──────────────────────────────────────────────────────
    def test_partial_results_for_missing_id(self):
        res = self._post("freeze", [self.s1.id, 999999])
        self.assertEqual(res.status_code, 200)
        by_id = {r["id"]: r for r in res.data["results"]}
        self.assertTrue(by_id[self.s1.id]["ok"])
        self.assertFalse(by_id[999999]["ok"])
        self.assertIn("not found or out of scope", by_id[999999]["error"])

    def test_cannot_act_on_self(self):
        res = self._post("deactivate", [self.admin.id, self.s1.id])
        self.assertEqual(res.status_code, 200)
        by_id = {r["id"]: r for r in res.data["results"]}
        self.assertFalse(by_id[self.admin.id]["ok"])
        self.assertIn("your own account", by_id[self.admin.id]["error"])
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    # ── Validation ───────────────────────────────────────────────────────────
    def test_ids_cap_enforced(self):
        res = self._post("freeze", list(range(1, 502)))
        self.assertEqual(res.status_code, 400)

    def test_invalid_action_rejected(self):
        res = self._post("nuke", [self.s1.id])
        self.assertEqual(res.status_code, 400)

    def test_empty_ids_rejected(self):
        res = self._post("freeze", [])
        self.assertEqual(res.status_code, 400)

    # ── Permission ───────────────────────────────────────────────────────────
    def test_non_manager_denied(self):
        self.client.force_authenticate(self.s1)
        res = self._post("freeze", [self.s2.id])
        self.assertEqual(res.status_code, 403)
        self.s2.refresh_from_db()
        self.assertFalse(self.s2.is_frozen)

    # ── Scope isolation (security-critical) ──────────────────────────────────
    def test_scope_isolation_out_of_scope_id_rejected(self):
        # A math teacher granted manage_users must not act on a student outside their scope.
        teacher = User.objects.create_user(
            email="bulk-math-teacher@example.com", password="pw", role="teacher", subject="math"
        )
        perm, _ = Permission.objects.get_or_create(codename=acc_const.PERM_MANAGE_USERS)
        UserPermission.objects.create(user=teacher, permission=perm, granted=True)
        # Teachers need a global domain grant for their subject to pass authorize().
        UserAccess.objects.create(user=teacher, subject=acc_const.DOMAIN_MATH, granted_by=teacher)

        # In-scope student (has a math grant) — the teacher SHOULD be able to act.
        in_scope = User.objects.create_user(email="bulk-math-stu@example.com", password="pw", role="student")
        UserAccess.objects.create(user=in_scope, subject=acc_const.DOMAIN_MATH, granted_by=teacher)

        # Out-of-scope student — plain student, no math grant/classroom.
        out_scope = self.s1

        self.client.force_authenticate(teacher)
        res = self._post("freeze", [in_scope.id, out_scope.id])
        self.assertEqual(res.status_code, 200)
        by_id = {r["id"]: r for r in res.data["results"]}
        self.assertTrue(by_id[in_scope.id]["ok"])
        self.assertFalse(by_id[out_scope.id]["ok"])
        self.assertIn("not found or out of scope", by_id[out_scope.id]["error"])

        in_scope.refresh_from_db()
        out_scope.refresh_from_db()
        self.assertTrue(in_scope.is_frozen)
        self.assertFalse(out_scope.is_frozen)
