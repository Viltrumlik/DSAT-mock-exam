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

import importlib
from unittest.mock import patch

from django.apps import apps as django_apps
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.cache import cache
from django.db import connection
from django.db.models import Q
from django.test import TestCase, TransactionTestCase
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
            # Distinct names per attempt: identical ones would be rejected by the
            # duplicate-full-name rule before the throttle ever gets a say.
            return self.client.post(
                reverse("user-register"),
                {
                    "email": f"flood{n}@test.com",
                    "username": f"flood{n}",
                    "first_name": f"Flood{n}",
                    "last_name": f"Person{n}",
                    "password": "secret12345",
                },
                format="json",
            )

        self.assertEqual(_post(1).status_code, 201)
        self.assertEqual(_post(2).status_code, 201)
        self.assertEqual(_post(3).status_code, 429, "3rd registration from one IP must be throttled")
        self.assertFalse(User.objects.filter(email="flood3@test.com").exists())


class DuplicateFullNameTests(TestCase):
    """Public registration rejects a first+last name that already exists.

    Prod had 36 name-collision groups covering 89 of 387 accounts — mostly one person
    who signed up twice with a slightly different address. Staff keep the escape hatch:
    an admin creating the account is authenticated, so the check does not fire for them,
    which is how a genuinely different person with the same name still gets an account.
    """

    @classmethod
    def setUpTestData(cls):
        cls.existing = User.objects.create_user(
            email="alisher.first@test.com", username="alisher1", password="secret12345",
            role="student", first_name="Alisher", last_name="Muhammadaliyev",
        )
        cls.super_admin = User.objects.create_user(
            email="dup-super@test.com", password="secret12345", role="super_admin",
        )

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def _register(self, first, last, email="second@test.com", username="alisher2"):
        return self.client.post(
            reverse("user-register"),
            {
                "email": email, "username": username, "first_name": first,
                "last_name": last, "password": "secret12345",
            },
            format="json",
        )

    @_register_rate("1000/hour")
    def test_duplicate_full_name_is_rejected(self):
        r = self._register("Alisher", "Muhammadaliyev")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json().get("code"), ["duplicate_full_name"])
        self.assertFalse(User.objects.filter(email="second@test.com").exists())

    @_register_rate("1000/hour")
    def test_rejection_ignores_case_and_padding(self):
        r = self._register("  aLIsher ", "muhammadaliyev  ")
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json().get("code"), ["duplicate_full_name"])

    @_register_rate("1000/hour")
    def test_different_name_is_accepted(self):
        r = self._register("Alisher", "Karimov", username="alisherk")
        self.assertEqual(r.status_code, 201, r.content)

    @_register_rate("1000/hour")
    def test_same_first_name_only_is_accepted(self):
        # Only the *pair* collides; a shared first name must not block anyone.
        r = self._register("Alisher", "Tojiyev", username="alishert")
        self.assertEqual(r.status_code, 201, r.content)

    @_register_rate("1000/hour")
    def test_names_are_stored_whitespace_normalized(self):
        self._register("Bek   zod", "Tursunov", email="bek@test.com", username="bekzod")
        u = User.objects.get(email="bek@test.com")
        self.assertEqual(u.first_name, "Bek zod")

    def test_admin_may_still_create_a_duplicate_name(self):
        # The escape hatch: a genuinely different person with the same name.
        self.client.force_authenticate(self.super_admin)
        r = self.client.post(
            reverse("user-create"),
            {
                "email": "alisher.second@test.com", "username": "alisher2",
                "first_name": "Alisher", "last_name": "Muhammadaliyev",
                "password": "secret12345", "role": "student",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(
            User.objects.filter(first_name="Alisher", last_name="Muhammadaliyev").count(), 2
        )


class AdminFreezeViaUpdateTests(TestCase):
    """Staff must still be able to freeze a single account from /ops/users.

    That page PATCHes ``{is_frozen}`` to ``/users/<id>/update/`` from the row buttons
    (frontend/src/app/(ops)/ops/users/page.tsx setFrozenSingle) and from the edit modal.
    Blanket-blocking the field to stop anonymous registrants from setting it turned both
    into silent no-ops: the API answered 200, the UI optimistically flipped the row and
    toasted "Account frozen.", and the account stayed live.
    """

    @classmethod
    def setUpTestData(cls):
        cls.super_admin = User.objects.create_user(
            email="freeze-super@test.com", password="secret12345", role="super_admin",
        )
        cls.target = User.objects.create_user(
            email="freeze-target@test.com", username="frztarget", password="secret12345",
            role="student", first_name="Freeze", last_name="Target",
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.super_admin)

    def test_admin_can_freeze_a_single_account(self):
        r = self.client.patch(
            reverse("user-update", args=[self.target.pk]), {"is_frozen": True}, format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_frozen, "PATCH is_frozen must actually freeze the account")

    def test_admin_can_unfreeze_a_single_account(self):
        self.target.is_frozen = True
        self.target.save(update_fields=["is_frozen"])
        r = self.client.patch(
            reverse("user-update", args=[self.target.pk]), {"is_frozen": False}, format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.target.refresh_from_db()
        self.assertFalse(self.target.is_frozen)


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


class TelegramNamePlaceholderTests(TestCase):
    """Telegram signups must not fabricate names.

    The old code wrote a literal "Telegram"/"User" and copied first_name into
    last_name for one-word display names. Production carries 12 accounts literally
    named "Telegram" and 38 Telegram-origin rows where first_name == last_name. Those
    read as *complete* to any emptiness check, so the user was never asked to fix them.
    """

    TG_ID = 555000111

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def _login(self, claims):
        with patch("users.views._verified_telegram_oidc_payload", return_value=(claims, None)):
            return self.client.post(
                reverse("telegram-auth"), {"id_token": "stub"}, format="json",
                HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
            )

    def test_missing_name_leaves_both_fields_blank(self):
        r = self._login({"sub": str(self.TG_ID)})
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(telegram_id=self.TG_ID)
        self.assertEqual(u.first_name, "")
        self.assertEqual(u.last_name, "")
        self.assertNotEqual(u.first_name, "Telegram")

    def test_one_word_name_does_not_become_the_last_name(self):
        r = self._login({"sub": str(self.TG_ID), "name": "Asadbek"})
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(telegram_id=self.TG_ID)
        self.assertEqual(u.first_name, "Asadbek")
        self.assertEqual(u.last_name, "", "one-word names must not be duplicated into last_name")


class TelegramUsernameCollisionTests(TestCase):
    """The Telegram handle was taken verbatim with no uniqueness check -> IntegrityError."""

    TG_ID = 777000222

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def _login(self, claims):
        with patch("users.views._verified_telegram_oidc_payload", return_value=(claims, None)):
            return self.client.post(
                reverse("telegram-auth"), {"id_token": "stub"}, format="json",
                HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/login",
            )

    def test_handle_colliding_case_insensitively_gets_a_suffix(self):
        User.objects.create_user(
            email="first.asilbek@test.com", username="asilbek", password="secret12345",
            role="student",
        )
        # Telegram hands us "Asilbek" — same name, different case. Before the fix this
        # was written straight through and blew up on the unique index.
        r = self._login({"sub": str(self.TG_ID), "preferred_username": "Asilbek", "name": "Asil Bek"})

        self.assertEqual(r.status_code, 200, r.content)
        created = User.objects.get(telegram_id=self.TG_ID)
        self.assertEqual(created.username, "Asilbek2")
        self.assertEqual(User.objects.count(), 2)

    def test_falls_back_to_tg_id_when_no_handle(self):
        r = self._login({"sub": str(self.TG_ID), "name": "No Handle"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(User.objects.get(telegram_id=self.TG_ID).username, f"tg{self.TG_ID}")


class UsernameCollisionMigrationTests(TransactionTestCase):
    """The 0021 data step must resolve real collisions before AddConstraint runs.

    Production has six pairs differing only in case. If the data step is wrong the
    migration does not merely misbehave — ``AddConstraint`` fails to apply and the
    deploy rolls back, so this is verified against the actual pre-migration state:
    the constraint is dropped, colliding rows are created, then the migration function
    is run exactly as the migration would run it.
    """

    CONSTRAINT = "users_username_ci_unique"

    def _constraint(self):
        return next(c for c in User._meta.constraints if c.name == self.CONSTRAINT)

    def setUp(self):
        with connection.schema_editor(atomic=False) as se:
            se.remove_constraint(User, self._constraint())

    def tearDown(self):
        User.objects.all().delete()
        with connection.schema_editor(atomic=False) as se:
            se.add_constraint(User, self._constraint())

    def _run_migration_step(self):
        mod = importlib.import_module("users.migrations.0021_username_case_insensitive_unique")
        mod.resolve_username_collisions(django_apps, connection.schema_editor())

    def test_older_account_keeps_the_username_newer_gets_a_suffix(self):
        older = User.objects.create_user(email="a@test.com", username="asilbek", password="p12345678")
        newer = User.objects.create_user(email="b@test.com", username="Asilbek", password="p12345678")
        self.assertLess(older.pk, newer.pk)

        self._run_migration_step()

        older.refresh_from_db()
        newer.refresh_from_db()
        self.assertEqual(older.username, "asilbek", "the older account must keep its username")
        self.assertEqual(newer.username, "Asilbek2")

    def test_suffix_skips_a_name_that_is_already_taken(self):
        User.objects.create_user(email="a@test.com", username="orifjon", password="p12345678")
        User.objects.create_user(email="squat@test.com", username="orifjon2", password="p12345678")
        newer = User.objects.create_user(email="b@test.com", username="Orifjon", password="p12345678")

        self._run_migration_step()

        newer.refresh_from_db()
        self.assertEqual(newer.username, "Orifjon3")

    def test_constraint_applies_after_the_data_step(self):
        User.objects.create_user(email="a@test.com", username="qobiljon", password="p12345678")
        User.objects.create_user(email="b@test.com", username="Qobiljon", password="p12345678")

        self._run_migration_step()

        # This is the operation that would fail the deploy if the data step missed a row.
        with connection.schema_editor(atomic=False) as se:
            se.add_constraint(User, self._constraint())
            se.remove_constraint(User, self._constraint())

    def test_rows_without_a_username_are_left_alone(self):
        blank = User.objects.create_user(email="c@test.com", password="p12345678")
        other = User.objects.create_user(email="d@test.com", password="p12345678")

        self._run_migration_step()

        blank.refresh_from_db()
        other.refresh_from_db()
        self.assertIn(blank.username, (None, ""))
        self.assertIn(other.username, (None, ""))


class AuthBackendTests(TestCase):
    """``EmailOrUsernameModelBackend`` must never password-check an arbitrary row."""

    def setUp(self):
        self.user = User.objects.create_user(
            email="person@test.com", username="person", password="secret12345", role="student",
        )

    def test_blank_credential_does_not_match_null_username_rows(self):
        # ``username`` is nullable, so ``__iexact=None`` compiles to IS NULL and used to
        # select every row without a username.
        User.objects.create_user(email="nousername@test.com", password="secret12345", role="student")
        self.assertIsNone(authenticate(username=None, password="secret12345"))
        self.assertIsNone(authenticate(username="", password="secret12345"))

    def test_email_wins_over_another_users_username(self):
        # Someone whose *username* is another person's email address must not shadow the
        # real owner of that address.
        impostor = User.objects.create_user(
            email="impostor@test.com", username="person@test.com", password="otherpass12345",
            role="student",
        )
        got = authenticate(username="person@test.com", password="secret12345")
        self.assertEqual(got, self.user)
        self.assertNotEqual(got, impostor)

    def test_username_login_still_works(self):
        self.assertEqual(authenticate(username="person", password="secret12345"), self.user)

    def test_wrong_password_returns_none(self):
        self.assertIsNone(authenticate(username="person@test.com", password="nope"))
