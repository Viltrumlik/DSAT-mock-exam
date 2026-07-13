"""Frozen accounts are the single account restriction (the "deactivate" feature was
removed). A FROZEN student:

* CAN log in.
* CAN read ``/users/me`` — so the frontend boots the dashboard shell and renders the
  non-dismissible frozen overlay.
* CANNOT write ``/users/me`` (profile edits) and is blocked on every *other* API.

    python manage.py test users.tests_frozen_access --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

User = get_user_model()


class FrozenAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="frozen@test.com", username="frozenuser", password="secret12345",
            role="student",
        )

    def _login(self):
        return self.client.post(
            "/api/auth/login/", {"email": "frozen@test.com", "password": "secret12345"}, format="json",
            HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
        )

    # ── Login ────────────────────────────────────────────────────────────────
    def test_active_user_can_log_in(self):
        r = self._login()
        self.assertEqual(r.status_code, 200, r.content)

    def test_frozen_student_can_still_log_in(self):
        # Freeze is NOT a lockout — the frozen student logs in and the frontend
        # overlay (backed by the API blocks below) restricts them.
        self.user.is_frozen = True
        self.user.save(update_fields=["is_frozen"])
        r = self._login()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json().get("is_frozen"))

    # ── /users/me is readable while frozen (boots the overlay) ──────────────
    def test_frozen_student_can_read_me(self):
        self.user.is_frozen = True
        self.user.save(update_fields=["is_frozen"])
        self.client.force_authenticate(self.user)
        r = self.client.get(reverse("user-me"))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json().get("is_frozen"))

    # ── ...but writes to /users/me are blocked while frozen ──────────────────
    def test_frozen_student_cannot_write_me(self):
        self.user.is_frozen = True
        self.user.save(update_fields=["is_frozen"])
        self.client.force_authenticate(self.user)
        r = self.client.patch(reverse("user-me"), {"first_name": "Nope"}, format="json")
        self.assertEqual(r.status_code, 403, r.content)

    # ── ...and every other API is blocked while frozen ───────────────────────
    def test_frozen_student_blocked_on_other_api(self):
        self.user.is_frozen = True
        self.user.save(update_fields=["is_frozen"])
        self.client.force_authenticate(self.user)
        r = self.client.get(reverse("exam-date-options"))
        self.assertEqual(r.status_code, 403, r.content)

    # ── Non-frozen student is unrestricted on the same endpoints ─────────────
    def test_active_student_can_read_and_write_me(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(reverse("user-me")).status_code, 200)
        r = self.client.patch(reverse("user-me"), {"first_name": "Fine"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.client.get(reverse("exam-date-options")).status_code, 200)
