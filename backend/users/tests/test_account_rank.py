"""Whose account an actor may change from the admin console (CRM roles, PR 1).

The serializer already refuses to GIVE a role above the actor's own. These tests pin the other half:
the account being CHANGED. An admin may change accounts ranked below their own that are learners; staff
(teachers included, since PR 4 of the CRM roles plan) and an owner's or another admin's account are the
owner's (super admin or Django superuser) to change.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from access import constants as C
from users.models import RefreshSession

User = get_user_model()


class AccountRankTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # As on prod: the owners are super admins AND Django superusers.
        cls.owner = User.objects.create_user(
            email="rank-owner@example.com", password="owner-pw-1", role=C.ROLE_SUPER_ADMIN,
            is_staff=True, is_superuser=True, phone_number="+998901110001",
        )
        cls.owner2 = User.objects.create_user(
            email="rank-owner2@example.com", password="owner2-pw-1", role=C.ROLE_SUPER_ADMIN,
        )
        cls.admin = User.objects.create_user(email="rank-admin@example.com", password="pw", role=C.ROLE_ADMIN)
        cls.admin2 = User.objects.create_user(email="rank-admin2@example.com", password="pw", role=C.ROLE_ADMIN)
        # A Django superuser whose role string says less still counts as an owner.
        cls.hidden_owner = User.objects.create_user(
            email="rank-hidden@example.com", password="pw", role=C.ROLE_ADMIN, is_superuser=True,
        )
        cls.teacher = User.objects.create_user(
            email="rank-teacher@example.com", password="pw", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH,
        )
        cls.student = User.objects.create_user(email="rank-stu@example.com", password="pw", role=C.ROLE_STUDENT)

    def setUp(self):
        self.client = APIClient()

    def _patch(self, actor, target, data):
        self.client.force_authenticate(actor)
        return self.client.patch(reverse("user-update", args=[target.pk]), data, format="json")

    # ── An admin is refused on the owner's account ────────────────────────────────────────────────
    def test_admin_cannot_set_owner_password(self):
        res = self._patch(self.admin, self.owner, {"password": "taken-over-1"})
        self.assertEqual(res.status_code, 403, res.content)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.check_password("owner-pw-1"))

    def test_admin_cannot_change_owner_phone_or_role(self):
        res = self._patch(self.admin, self.owner, {"phone_number": "+998909999999"})
        self.assertEqual(res.status_code, 403, res.content)
        res = self._patch(self.admin, self.owner2, {"role": C.ROLE_STUDENT})
        self.assertEqual(res.status_code, 403, res.content)
        self.owner.refresh_from_db()
        self.owner2.refresh_from_db()
        self.assertEqual(self.owner.phone_number, "+998901110001")
        self.assertEqual(self.owner2.role, C.ROLE_SUPER_ADMIN)

    def test_admin_cannot_freeze_owner_through_edit(self):
        res = self._patch(self.admin, self.owner2, {"is_frozen": True})
        self.assertEqual(res.status_code, 403, res.content)
        self.owner2.refresh_from_db()
        self.assertFalse(self.owner2.is_frozen)

    def test_admin_cannot_delete_owner(self):
        self.client.force_authenticate(self.admin)
        res = self.client.delete(reverse("user-delete", args=[self.owner2.pk]))
        self.assertEqual(res.status_code, 403, res.content)
        self.assertTrue(User.objects.filter(pk=self.owner2.pk).exists())

    def test_refusal_says_who_may(self):
        res = self._patch(self.admin, self.owner, {"first_name": "Xavier"})
        self.assertEqual(res.status_code, 403)
        self.assertIn("owner", str(res.data.get("detail", "")).lower())

    # ── …and on an equal or hidden-owner account ──────────────────────────────────────────────────
    def test_admin_cannot_change_another_admin(self):
        res = self._patch(self.admin, self.admin2, {"password": "taken-over-1"})
        self.assertEqual(res.status_code, 403, res.content)

    def test_admin_cannot_change_a_superuser_with_a_lower_role_string(self):
        res = self._patch(self.admin, self.hidden_owner, {"first_name": "Xavier"})
        self.assertEqual(res.status_code, 403, res.content)

    def test_admin_cannot_change_own_account_from_the_console(self):
        res = self._patch(self.admin, self.admin, {"role": C.ROLE_SUPER_ADMIN})
        self.assertIn(res.status_code, (400, 403), res.content)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, C.ROLE_ADMIN)

    # ── Bulk actions and "log out everywhere" ─────────────────────────────────────────────────────
    def test_bulk_skips_accounts_at_or_above_the_actor(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            reverse("admin-user-bulk"),
            {"action": "freeze", "ids": [self.owner.pk, self.admin2.pk, self.student.pk]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        by_id = {r["id"]: r for r in res.data["results"]}
        self.assertFalse(by_id[self.owner.pk]["ok"])
        self.assertFalse(by_id[self.admin2.pk]["ok"])
        self.assertTrue(by_id[self.student.pk]["ok"])
        self.owner.refresh_from_db()
        self.admin2.refresh_from_db()
        self.student.refresh_from_db()
        self.assertFalse(self.owner.is_frozen)
        self.assertFalse(self.admin2.is_frozen)
        self.assertTrue(self.student.is_frozen)

    def test_bulk_delete_cannot_remove_owner(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            reverse("admin-user-bulk"), {"action": "delete", "ids": [self.owner2.pk]}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.data["results"][0]["ok"])
        self.assertTrue(User.objects.filter(pk=self.owner2.pk).exists())

    def test_admin_cannot_log_owner_out_everywhere(self):
        RefreshSession.objects.create(user=self.owner, refresh_jti="rank-owner-jti")
        self.client.force_authenticate(self.admin)
        res = self.client.post(reverse("users-admin-person-revoke", args=[self.owner.pk]))
        self.assertEqual(res.status_code, 403, res.content)
        self.assertTrue(RefreshSession.objects.filter(refresh_jti="rank-owner-jti", revoked_at__isnull=True).exists())

    # ── What still works ──────────────────────────────────────────────────────────────────────────
    def test_admin_still_manages_learners(self):
        self.assertEqual(self._patch(self.admin, self.student, {"first_name": "Okay"}).status_code, 200)
        self.client.force_authenticate(self.admin)
        res = self.client.post(reverse("users-admin-person-revoke", args=[self.student.pk]))
        self.assertEqual(res.status_code, 200, res.content)

    def test_owner_manages_admins_and_other_owners(self):
        self.assertEqual(self._patch(self.owner, self.admin, {"first_name": "Okay"}).status_code, 200)
        self.assertEqual(self._patch(self.owner, self.owner2, {"first_name": "Okay"}).status_code, 200)
        # A super admin who is not a Django superuser is an owner too.
        self.assertEqual(self._patch(self.owner2, self.admin2, {"first_name": "Okay"}).status_code, 200)


class SecurityMetricsAuthTests(TestCase):
    """The security counters were served to anyone, signed in or not."""

    def setUp(self):
        self.client = APIClient()
        self.url = reverse("admin-security-metrics")

    def test_anonymous_is_refused(self):
        res = self.client.get(self.url)
        self.assertIn(res.status_code, (401, 403))

    def test_admin_without_staff_flag_is_refused(self):
        admin = User.objects.create_user(email="metrics-admin@example.com", password="pw", role=C.ROLE_ADMIN)
        self.client.force_authenticate(admin)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_owner_reads_the_counters(self):
        owner = User.objects.create_user(
            email="metrics-owner@example.com", password="pw", role=C.ROLE_SUPER_ADMIN,
            is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(owner)
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res["Content-Type"].startswith("text/plain"))
