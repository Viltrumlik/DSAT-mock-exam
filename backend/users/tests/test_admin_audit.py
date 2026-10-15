"""Admin edits leave a trail on the account they changed (plan 2026-10-15-ops-detail-pages)."""

import json

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from users.models import SecurityAuditEvent, User

HOST = "admin.mastersat.uz"


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class AdminAuditTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role=C.ROLE_ADMIN,
                                              first_name="Bo", last_name="Ss")
        self.kid = User.objects.create_user(None, password="old-pass-123", username="kid", role=C.ROLE_STUDENT,
                                            first_name="Ali", last_name="Valiyev")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def events(self, kind):
        return list(SecurityAuditEvent.objects.filter(user=self.kid, event_type=kind))

    def test_an_edit_records_who_and_what_changed(self):
        r = self.api.patch(f"/api/users/{self.kid.pk}/update/", {"first_name": "Aziz", "phone_number": "998901112233"},
                           format="json", HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 200, r.content)
        (ev,) = self.events("admin_user_update")
        self.assertEqual(ev.detail["actor_id"], self.admin.pk)
        self.assertEqual(ev.detail["actor"], "Bo Ss")
        self.assertEqual(ev.detail["changes"]["first_name"], ["Ali", "Aziz"])
        self.assertEqual(ev.detail["changes"]["phone_number"], [None, "998901112233"])
        self.assertNotIn("last_name", ev.detail["changes"])

    def test_a_password_is_recorded_as_changed_never_by_value(self):
        self.api.patch(f"/api/users/{self.kid.pk}/update/", {"password": "Secret-Value-987"}, format="json",
                       HTTP_HOST=HOST)
        (ev,) = self.events("admin_user_update")
        self.assertTrue(ev.detail["password_changed"])
        self.assertNotIn("Secret-Value-987", json.dumps(ev.detail))

    def test_a_save_that_changes_nothing_records_nothing(self):
        self.api.patch(f"/api/users/{self.kid.pk}/update/", {"first_name": "Ali"}, format="json", HTTP_HOST=HOST)
        self.assertEqual(self.events("admin_user_update"), [])

    def test_a_bulk_freeze_and_unfreeze_are_recorded_once_each(self):
        for action in ("freeze", "freeze", "unfreeze"):
            self.api.post("/api/users/admin/bulk/", {"action": action, "ids": [self.kid.pk]}, format="json",
                          HTTP_HOST=HOST)
        self.assertEqual(len(self.events("admin_freeze")), 1)  # the second freeze changed nothing
        self.assertEqual(len(self.events("admin_unfreeze")), 1)
        self.assertEqual(self.events("admin_freeze")[0].detail["actor_id"], self.admin.pk)

    def test_unfreezing_a_debt_freeze_says_it_was_one(self):
        User.objects.filter(pk=self.kid.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.api.post("/api/users/admin/bulk/", {"action": "unfreeze", "ids": [self.kid.pk]}, format="json",
                      HTTP_HOST=HOST)
        (ev,) = self.events("admin_unfreeze")
        self.assertEqual(ev.detail["was_reason"], "lcup_debt")
