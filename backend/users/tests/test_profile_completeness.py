"""The "is this profile complete?" rule, and the one-time cleanup it depends on.

    python manage.py test users.tests.test_profile_completeness \
        --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

import importlib

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from users.email_utils import RELEASED_EMAIL_DOMAIN, synthetic_telegram_email
from users.profile_completeness import is_profile_complete, missing_profile_fields

User = get_user_model()


def _complete_user(**overrides):
    kwargs = dict(
        email="real@gmail.com", username="realuser", password="secret12345",
        role="student", first_name="Aziz", last_name="Karimov",
    )
    kwargs.update(overrides)
    u = User.objects.create_user(**kwargs)
    u.email_verified = True
    u.email_verified_at = timezone.now()
    u.save(update_fields=["email_verified", "email_verified_at"])
    return u


class PredicateTests(TestCase):
    def test_fully_populated_and_verified_is_complete(self):
        u = _complete_user()
        self.assertEqual(missing_profile_fields(u), [])
        self.assertTrue(is_profile_complete(u))

    def test_each_short_field_is_reported(self):
        for field in ("first_name", "last_name", "username"):
            with self.subTest(field=field):
                kwargs = {"email": f"{field}@gmail.com", "username": f"u{field}"}
                kwargs[field] = "ab"
                self.assertIn(field, missing_profile_fields(_complete_user(**kwargs)))

    def test_blank_fields_are_reported(self):
        u = _complete_user(first_name="", last_name="")
        self.assertEqual(missing_profile_fields(u), ["first_name", "last_name"])

    def test_unverified_email_counts_as_missing(self):
        u = _complete_user()
        u.email_verified = False
        u.save(update_fields=["email_verified"])
        self.assertEqual(missing_profile_fields(u), ["email"])

    def test_synthetic_telegram_address_counts_as_missing(self):
        u = _complete_user(email=synthetic_telegram_email(4242))
        self.assertIn("email", missing_profile_fields(u))

    def test_released_placeholder_counts_as_missing(self):
        u = _complete_user(email=f"released-7-abcd1234@{RELEASED_EMAIL_DOMAIN}")
        self.assertIn("email", missing_profile_fields(u))

    def test_ordering_is_stable(self):
        u = _complete_user(first_name="", last_name="", username="")
        u.email_verified = False
        u.save(update_fields=["email_verified"])
        self.assertEqual(
            missing_profile_fields(u), ["first_name", "last_name", "username", "email"]
        )

    def test_identical_first_and_last_name_is_NOT_flagged(self):
        # Load-bearing: a live "last name must differ from first" rule can never be
        # satisfied by someone genuinely named "Aziz Aziz". Legacy fabricated rows are
        # handled once by migration 0024 instead.
        u = _complete_user(first_name="Aziz", last_name="Aziz")
        self.assertEqual(missing_profile_fields(u), [])

    def test_literal_placeholder_name_is_NOT_flagged_by_the_live_rule(self):
        u = _complete_user(first_name="Telegram", last_name="Telegram")
        self.assertEqual(missing_profile_fields(u), [])


class MeEndpointExposureTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_me_reports_completion_state(self):
        u = _complete_user()
        u.email_verified = False
        u.save(update_fields=["email_verified"])
        self.client.force_authenticate(u)
        body = self.client.get(reverse("user-me")).json()
        self.assertFalse(body["profile_complete"])
        self.assertEqual(body["missing_fields"], ["email"])

    def test_me_reports_complete_profile(self):
        self.client.force_authenticate(_complete_user())
        body = self.client.get(reverse("user-me")).json()
        self.assertTrue(body["profile_complete"])
        self.assertEqual(body["missing_fields"], [])

    def test_completion_state_is_read_only(self):
        u = _complete_user()
        u.email_verified = False
        u.save(update_fields=["email_verified"])
        self.client.force_authenticate(u)
        r = self.client.patch(
            reverse("user-me"), {"profile_complete": True, "missing_fields": []}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()["profile_complete"])


class FabricatedNameCleanupTests(TestCase):
    """Migration 0024 — the rows the live predicate deliberately does not catch."""

    def _run(self):
        mod = importlib.import_module("users.migrations.0024_clear_fabricated_names")
        mod.clear_fabricated_names(django_apps, connection.schema_editor())

    def test_placeholder_first_name_is_cleared(self):
        u = _complete_user(first_name="Telegram", last_name="Telegram", email="a@gmail.com", username="tg1")
        self._run()
        u.refresh_from_db()
        self.assertEqual(u.first_name, "")
        self.assertEqual(u.last_name, "")

    def test_literal_user_surname_is_cleared(self):
        u = _complete_user(first_name="Asadbek", last_name="User", email="b@gmail.com", username="tg2")
        self._run()
        u.refresh_from_db()
        self.assertEqual(u.first_name, "Asadbek", "the real given name is kept")
        self.assertEqual(u.last_name, "")

    def test_duplicated_given_name_clears_only_the_surname(self):
        u = _complete_user(first_name="Asadbek", last_name="Asadbek", email="c@gmail.com", username="tg3")
        self._run()
        u.refresh_from_db()
        self.assertEqual(u.first_name, "Asadbek")
        self.assertEqual(u.last_name, "")

    def test_case_differing_duplicate_is_also_cleared(self):
        u = _complete_user(first_name="Asadbek", last_name="asadbek", email="d@gmail.com", username="tg4")
        self._run()
        u.refresh_from_db()
        self.assertEqual(u.last_name, "")

    def test_genuine_names_are_untouched(self):
        u = _complete_user(first_name="Aziz", last_name="Karimov", email="e@gmail.com", username="tg5")
        self._run()
        u.refresh_from_db()
        self.assertEqual((u.first_name, u.last_name), ("Aziz", "Karimov"))

    def test_cleanup_makes_the_row_visible_to_the_predicate(self):
        # The point of the migration: before it these rows read as complete.
        u = _complete_user(first_name="Telegram", last_name="Telegram", email="f@gmail.com", username="tg6")
        self.assertEqual(missing_profile_fields(u), [], "reads complete before cleanup")
        self._run()
        u.refresh_from_db()
        self.assertEqual(missing_profile_fields(u), ["first_name", "last_name"])
