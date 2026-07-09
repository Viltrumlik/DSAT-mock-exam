"""Deactivated accounts (is_active=False) cannot log in on any path, but their
row stays in the DB. Freeze (is_frozen) is separate — a frozen user CAN log in
(the frontend then blocks them with an overlay).

    python manage.py test users.tests_deactivate_login --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

User = get_user_model()


class DeactivateLoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="deact@test.com", username="deactuser", password="secret12345",
        )

    def _login(self):
        return self.client.post(
            "/api/auth/login/", {"email": "deact@test.com", "password": "secret12345"}, format="json",
            HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
        )

    def test_active_user_can_log_in(self):
        r = self._login()
        self.assertEqual(r.status_code, 200, r.content)  # tokens are set as HttpOnly cookies

    def test_deactivated_user_cannot_log_in(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        r = self._login()
        self.assertEqual(r.status_code, 401, r.content)
        # Row is preserved (data stays in the DB).
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_frozen_user_can_still_log_in(self):
        # Freeze is NOT deactivation — the frozen user logs in (frontend overlay blocks them).
        self.user.is_frozen = True
        self.user.save(update_fields=["is_frozen"])
        r = self._login()
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json().get("is_frozen"))
