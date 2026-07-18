"""Hardening around the public registration endpoint, self-service email edits, and
Telegram identity resolution.

Each test here pins a defect that was live on ``main``:

* ``/api/users/register/`` is unauthenticated and was also unmetered, and ``is_frozen``
  was writable straight through it.
* ``PATCH /api/users/me/`` changed ``email`` with no proof of ownership of the new
  address, so an account could be moved to any unclaimed mailbox.
* ``TelegramAuthView`` resolved the account by synthetic email only, so a Telegram user
  whose email had changed produced a *second* row and then tripped the unique
  ``telegram_id`` constraint.

    python manage.py test users.tests.test_registration_and_email_hardening \
        --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from users.views import RegistrationRateThrottle

User = get_user_model()


def _register_rate(rate: str):
    """Pin the ``register`` throttle rate for one test.

    ``override_settings(REST_FRAMEWORK=...)`` does **not** work here: DRF binds
    ``SimpleRateThrottle.THROTTLE_RATES`` to the settings dict once, at import time,
    so a later settings override never reaches it. Patch the table the throttle
    actually reads instead.
    """
    return patch.object(
        RegistrationRateThrottle,
        "THROTTLE_RATES",
        {**RegistrationRateThrottle.THROTTLE_RATES, "register": rate},
    )


class RegistrationHardeningTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        cache.clear()  # throttle buckets live in the default cache

    def tearDown(self):
        cache.clear()

    @_register_rate("1000/hour")
    def test_registration_ignores_is_frozen(self):
        r = self.client.post(
            reverse("user-register"),
            {
                "email": "newbie@test.com",
                "username": "newbie",
                "first_name": "New",
                "last_name": "Bie",
                "password": "secret12345",
                "is_frozen": True,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertFalse(User.objects.get(email="newbie@test.com").is_frozen)

    @_register_rate("1000/hour")
    def test_registration_still_works(self):
        # Guard against the throttle/read-only changes over-blocking the happy path.
        r = self.client.post(
            reverse("user-register"),
            {
                "email": "happy@test.com",
                "username": "happyone",
                "first_name": "Hap",
                "last_name": "Path",
                "password": "secret12345",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        u = User.objects.get(email="happy@test.com")
        self.assertEqual(u.role, "student")
        self.assertTrue(u.check_password("secret12345"))

    @_register_rate("2/hour")
    def test_registration_is_throttled_per_ip(self):
        def _post(n):
            return self.client.post(
                reverse("user-register"),
                {
                    "email": f"flood{n}@test.com",
                    "username": f"flood{n}",
                    "first_name": "Flo",
                    "last_name": "Oder",
                    "password": "secret12345",
                },
                format="json",
            )

        self.assertEqual(_post(1).status_code, 201)
        self.assertEqual(_post(2).status_code, 201)
        self.assertEqual(_post(3).status_code, 429, "3rd registration from one IP must be throttled")
        self.assertFalse(User.objects.filter(email="flood3@test.com").exists())


class MeEmailImmutableTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            email="owner@test.com", username="owneruser", password="secret12345", role="student",
        )
        self.client.force_authenticate(self.user)

    def test_patch_me_cannot_change_email(self):
        r = self.client.patch(reverse("user-me"), {"email": "attacker@test.com"}, format="json")
        # Read-only fields are silently dropped by DRF, so the request succeeds but the
        # address must be untouched.
        self.assertEqual(r.status_code, 200, r.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "owner@test.com")
        self.assertEqual(r.json()["email"], "owner@test.com")

    def test_patch_me_still_updates_other_profile_fields(self):
        r = self.client.patch(
            reverse("user-me"),
            {"first_name": "Renamed", "last_name": "Person", "username": "renamed"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Renamed")
        self.assertEqual(self.user.username, "renamed")


class TelegramLoginLookupTests(TestCase):
    """Telegram login must resolve by ``telegram_id``, not by the synthetic address."""

    TG_ID = 987654321

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def _post_telegram(self, claims):
        with patch("users.views._verified_telegram_oidc_payload", return_value=(claims, None)):
            return self.client.post(
                reverse("telegram-auth"), {"id_token": "stub"}, format="json",
                HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
            )

    def test_resolves_existing_user_by_telegram_id_after_email_change(self):
        existing = User.objects.create_user(
            email="real.person@gmail.com", username="realperson", password="secret12345",
            role="student", first_name="Real", last_name="Person",
        )
        existing.telegram_id = self.TG_ID
        existing.save(update_fields=["telegram_id"])

        r = self._post_telegram({"sub": str(self.TG_ID), "name": "Real Person"})

        self.assertEqual(r.status_code, 200, r.content)
        # Before the fix this created a second row and then raised IntegrityError on
        # the unique telegram_id when saving it.
        self.assertEqual(User.objects.filter(telegram_id=self.TG_ID).count(), 1)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(User.objects.get(pk=existing.pk).email, "real.person@gmail.com")

    def test_still_resolves_legacy_user_by_synthetic_email(self):
        # Rows created before telegram_id was backfilled have no telegram_id yet; the
        # email fallback must keep finding them rather than minting a duplicate.
        domain = getattr(settings, "TELEGRAM_SYNTHETIC_EMAIL_DOMAIN", "telegram.mastersat.local")
        legacy = User.objects.create_user(
            email=f"tg{self.TG_ID}@{domain}", username="legacytg", password="secret12345",
            role="student",
        )

        r = self._post_telegram({"sub": str(self.TG_ID), "name": "Legacy User"})

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(User.objects.count(), 1)
        legacy.refresh_from_db()
        self.assertEqual(legacy.telegram_id, self.TG_ID)

    def test_creates_user_on_first_telegram_login(self):
        r = self._post_telegram({"sub": str(self.TG_ID), "name": "Brand New"})

        self.assertEqual(r.status_code, 200, r.content)
        created = User.objects.get(Q(telegram_id=self.TG_ID))
        self.assertEqual(created.first_name, "Brand")
        self.assertEqual(created.last_name, "New")
