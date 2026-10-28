"""A linked learner's name and phone are lc-up's (owner, 2026-10-28: "To'liq lc-up bo'yicha").

Every sync sets them to what lc-up holds; nobody edits them here; a phone another account holds is
left alone and listed; an account named after its phone keeps its login and first-sign-in code on
the new phone. Off until ``LCUP_PROFILE_SYNC_ENABLED``.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from types import SimpleNamespace

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from lcup import profiles
from lcup.models import AccountClaim, LcupStudentLink, LinkStatus
from users.models import SecurityAuditEvent, User

HOST = "admin.mastersat.uz"
ON = {"LCUP_ENABLED": True, "LCUP_PROFILE_SYNC_ENABLED": True, "ALLOWED_HOSTS": ["testserver", HOST]}


def run():
    return SimpleNamespace(counts=Counter())


@override_settings(**ON)
class ProfileFixture(TestCase):
    def setUp(self):
        self.kid = User.objects.create_user(
            None, password="x-pass-123", username="kid", role=C.ROLE_STUDENT, first_name="Бехруз", last_name="Зокиржонов"
        )
        self.link = LcupStudentLink.objects.create(
            lcup_student_id=7, name="Zokirjonov Behruzbek", phone="998901112233", user=self.kid, status=LinkStatus.CONFIRMED
        )

    def apply(self):
        r = run()
        profiles.apply(r)
        self.kid.refresh_from_db()
        return r.counts


class MirrorTests(ProfileFixture):
    def test_the_name_and_phone_become_lcups(self):
        counts = self.apply()
        self.assertEqual((self.kid.first_name, self.kid.last_name, self.kid.phone_number),
                         ("Behruzbek", "Zokirjonov", "998901112233"))
        self.assertEqual((counts["profile_updated"], counts["profile_first_name"], counts["profile_phone_number"]), (1, 1, 1))
        event = SecurityAuditEvent.objects.get(user=self.kid, event_type="lcup_profile_sync")
        self.assertEqual(event.detail["changes"]["first_name"], ["Бехруз", "Behruzbek"])
        self.assertEqual(event.detail["lcup_student_id"], 7)

    def test_a_second_run_changes_nothing(self):
        self.apply()
        self.assertEqual(self.apply()["profile_updated"], 0)
        self.assertEqual(SecurityAuditEvent.objects.filter(user=self.kid, event_type="lcup_profile_sync").count(), 1)

    def test_lcup_changing_the_name_or_phone_follows(self):
        self.apply()
        LcupStudentLink.objects.filter(pk=self.link.pk).update(name="Behruz Zokirov", phone="998935556677")
        self.apply()
        self.assertEqual((self.kid.first_name, self.kid.last_name, self.kid.phone_number), ("Behruz", "Zokirov", "998935556677"))

    def test_a_phone_another_account_holds_is_left_and_listed(self):
        sibling = User.objects.create_user(None, password=None, username="sis", role=C.ROLE_STUDENT, phone_number="+998 90 111 22 33")
        counts = self.apply()
        self.assertIsNone(self.kid.phone_number)
        self.assertEqual(self.kid.first_name, "Behruzbek")  # the name still follows
        self.assertEqual(counts["profile_phone_taken"], 1)
        conflict = profiles.phone_conflicts()
        self.assertEqual([(c["user_id"], [h["id"] for h in c["held_by"]]) for c in conflict], [(self.kid.pk, [sibling.pk])])
        self.assertNotIn("phone_number", profiles.locked_fields(self.kid))

    def test_an_account_named_after_its_phone_keeps_its_login_and_code_on_the_new_one(self):
        self.kid.username = self.kid.phone_number = "998900000001"
        self.kid.save(update_fields=["username", "phone_number"])
        claim = AccountClaim.objects.create(user=self.kid, phone="998900000001", expires_at=timezone.now() + timedelta(days=14))
        self.apply()
        claim.refresh_from_db()
        self.assertEqual((self.kid.username, self.kid.phone_number, claim.phone), ("998901112233", "998901112233", "998901112233"))

    def test_a_used_claim_stays_where_it_was(self):
        self.kid.username = self.kid.phone_number = "998900000001"
        self.kid.save(update_fields=["username", "phone_number"])
        claim = AccountClaim.objects.create(
            user=self.kid, phone="998900000001", expires_at=timezone.now(), password_set_at=timezone.now()
        )
        self.apply()
        claim.refresh_from_db()
        self.assertEqual(claim.phone, "998900000001")

    def test_a_name_part_lcup_leaves_too_short_stays_ours_and_editable(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(name="Behruzbek")
        self.apply()
        self.assertEqual((self.kid.first_name, self.kid.last_name), ("Behruzbek", "Зокиржонов"))
        self.assertEqual(profiles.locked_fields(self.kid), ["first_name", "phone_number"])

    def test_only_a_linked_learner_is_touched(self):
        for status in (LinkStatus.NEEDS_REVIEW, LinkStatus.IGNORED, LinkStatus.UNMATCHED):
            LcupStudentLink.objects.filter(pk=self.link.pk).update(status=status)
            self.apply()
            self.assertEqual(self.kid.first_name, "Бехруз", status)
            self.assertEqual(profiles.locked_fields(self.kid), [], status)
        LcupStudentLink.objects.filter(pk=self.link.pk).update(status=LinkStatus.CONFIRMED)
        User.objects.filter(pk=self.kid.pk).update(role=C.ROLE_TEACHER)
        self.apply()
        self.assertEqual(self.kid.first_name, "Бехруз")

    @override_settings(LCUP_PROFILE_SYNC_ENABLED=False)
    def test_switched_off_nothing_changes_and_nothing_is_locked(self):
        self.assertEqual(self.apply()["profile_updated"], 0)
        self.assertEqual(self.kid.first_name, "Бехруз")
        self.assertEqual(profiles.locked_fields(self.kid), [])


class LockTests(ProfileFixture):
    def setUp(self):
        super().setUp()
        self.apply()
        self.api = APIClient()

    def test_the_learner_cannot_change_lcups_fields(self):
        self.api.force_authenticate(self.kid)
        me = self.api.get("/api/users/me/").json()
        self.assertEqual(me["lcup_locked_fields"], ["first_name", "last_name", "phone_number"])
        r = self.api.patch("/api/users/me/", {"first_name": "Bexa"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("lc-up", r.json()["first_name"][0])
        self.kid.refresh_from_db()
        self.assertEqual(self.kid.first_name, "Behruzbek")

    def test_sending_the_same_values_back_is_no_change(self):
        self.api.force_authenticate(self.kid)
        r = self.api.patch(
            "/api/users/me/",
            {"first_name": "Behruzbek", "last_name": "Zokirjonov", "phone_number": "+998 90 111 22 33", "target_score": 1400},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)

    def test_an_admin_cannot_change_them_either(self):
        admin = User.objects.create_user(None, password=None, username="boss", role=C.ROLE_ADMIN)
        self.api.force_authenticate(admin)
        r = self.api.patch(f"/api/users/{self.kid.pk}/update/", {"phone_number": "998935556677"}, format="json", HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 400)
        self.assertIn("lc-up", r.json()["phone_number"][0])
        core = self.api.get(f"/api/users/admin/people/{self.kid.pk}/", HTTP_HOST=HOST).json()
        self.assertEqual(core["lcup_locked_fields"], ["first_name", "last_name", "phone_number"])

    def test_history_says_lcup_did_it(self):
        from users.people_parts import history_part

        item = next(i for i in history_part(self.kid)["items"] if i["title"].startswith("Updated from lc-up"))
        self.assertEqual((item["title"], item["by"]), ("Updated from lc-up: first name, last name, phone", "lc-up sync"))
