"""The owner's test accounts: frozen for debt everywhere it is SHOWN, but free to use the site.

The owner, 2026-10-21: an lc-up-linked account they test on was frozen by lc-up for unpaid
debt. Leave it frozen everywhere — the debt and "frozen for debt" must stay visible — but let
it sign in and use MasterSAT. ``settings.FREEZE_ACCESS_EXEMPT_EMAILS`` names such accounts;
``users.permissions.is_frozen_for_access`` is the only reading of the freeze that consults it.

    python manage.py test users.tests_freeze_exempt --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from events.services import is_signupable_student
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import is_freeze_exempt, is_frozen_for_access, is_frozen_learner
from users.serializers import UserSerializer

User = get_user_model()

EXEMPT = frozenset({"tester@test.com"})


class FreezeExemptFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        # Stored in mixed case on purpose: the setting is matched case-insensitively.
        self.tester = User.objects.create_user(
            email="Tester@Test.com", username="tester", password="secret12345", role="student",
        )
        self.other = User.objects.create_user(
            email="other@test.com", username="other", password="secret12345", role="student",
        )
        # Frozen the way the lc-up debt sweep freezes: a queryset update, no post_save hooks.
        User.objects.filter(pk__in=[self.tester.pk, self.other.pk]).update(
            is_frozen=True, frozen_reason=FROZEN_LCUP_DEBT
        )
        self.tester.refresh_from_db()
        self.other.refresh_from_db()

    def _login(self, email):
        return self.client.post(
            "/api/auth/login/", {"email": email, "password": "secret12345"}, format="json",
            HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
        )


@override_settings(FREEZE_ACCESS_EXEMPT_EMAILS=EXEMPT)
class ExemptTestAccountTests(FreezeExemptFixture):
    def test_it_signs_in_unfrozen(self):
        r = self._login("Tester@Test.com")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json().get("is_frozen"))

    def test_its_own_me_says_it_is_not_frozen(self):
        """What the frozen screen on the web and iOS reads."""
        self.client.force_authenticate(self.tester)
        r = self.client.get(reverse("user-me"))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIs(r.json()["is_frozen"], False)

    def test_it_can_use_the_api_and_edit_its_profile(self):
        self.client.force_authenticate(self.tester)
        self.assertEqual(self.client.get(reverse("exam-date-options")).status_code, 200)
        r = self.client.patch(reverse("user-me"), {"first_name": "Tester"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

    def test_it_may_sign_up_for_events(self):
        self.assertTrue(is_signupable_student(self.tester))

    def test_the_freeze_itself_is_left_exactly_as_it_was(self):
        """The owner: "har yerda frozen qoldiring ... qarz uchun frozen bo'lgani ko'rinsin"."""
        self.client.force_authenticate(self.tester)
        self.client.get(reverse("user-me"))
        self.client.patch(reverse("user-me"), {"first_name": "Tester"}, format="json")

        self.tester.refresh_from_db()
        self.assertTrue(self.tester.is_frozen)
        self.assertEqual(self.tester.frozen_reason, FROZEN_LCUP_DEBT)

    def test_staff_screens_still_see_it_frozen_for_debt(self):
        data = UserSerializer(self.tester, context={}).data
        self.assertTrue(data["is_frozen"])
        self.assertEqual(data["frozen_reason"], FROZEN_LCUP_DEBT)

    def test_the_rules_read_it_as_exempt(self):
        self.assertTrue(is_freeze_exempt(self.tester))
        self.assertFalse(is_frozen_for_access(self.tester))
        self.assertFalse(is_frozen_learner(self.tester))

    def test_every_other_frozen_account_is_still_frozen_out(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(reverse("exam-date-options")).status_code, 403)
        self.assertIs(self.client.get(reverse("user-me")).json()["is_frozen"], True)
        self.assertTrue(self._login("other@test.com").json().get("is_frozen"))
        self.assertFalse(is_signupable_student(self.other))


@override_settings(FREEZE_ACCESS_EXEMPT_EMAILS=EXEMPT)
class BroadcastAudienceTests(FreezeExemptFixture):
    """A staff broadcast skips accounts the freeze locks out — but not an exempt test account,
    which can open the notification. An unfrozen account with no email stays in too: the
    exemption is a NOT-frozen-or-exempt filter, and a NULL email must not drop anybody."""

    def test_the_exempt_account_is_told_and_other_frozen_ones_are_not(self):
        from notifications.models import Notification

        no_email = User.objects.create_user(
            None, username="phone_only", password="secret12345", role="student",
        )
        admin = User.objects.create_user(
            email="root@test.com", username="root", password="secret12345", role="super_admin",
        )
        self.client.force_authenticate(admin)
        r = self.client.post(
            "/api/notifications/broadcast/",
            {"audience": "students", "title": "Centre closed tomorrow"}, format="json",
        )
        self.assertIn(r.status_code, (200, 201), r.content)

        told = set(Notification.objects.values_list("recipient_id", flat=True))
        self.assertIn(self.tester.pk, told)
        self.assertIn(no_email.pk, told)
        self.assertNotIn(self.other.pk, told)


class NoExemptionConfiguredTests(FreezeExemptFixture):
    """With the setting empty — every environment but production — nothing changes."""

    @override_settings(FREEZE_ACCESS_EXEMPT_EMAILS=frozenset())
    def test_the_account_is_frozen_like_any_other(self):
        self.client.force_authenticate(self.tester)
        self.assertEqual(self.client.get(reverse("exam-date-options")).status_code, 403)
        self.assertIs(self.client.get(reverse("user-me")).json()["is_frozen"], True)
        self.assertFalse(is_freeze_exempt(self.tester))
