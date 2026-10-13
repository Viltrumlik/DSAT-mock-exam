"""A phone is typed every which way: "+998 90 123 45 67", "998901234567", "90-123-45-67". An account
whose username IS the phone (every account the lc-up sync creates) signs in with any of them — not
only the first time with the code, but after the student chose a password too."""

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from users.backends import EmailOrUsernameModelBackend
from users.models import User

PASSWORD = "Kitob-va-Qalam-2026"


class PhoneLoginTests(TestCase):
    def setUp(self):
        cache.clear()  # the login throttle counts per IP across tests
        self.user = User.objects.create_user(
            None, password=PASSWORD, username="998901234567", phone_number="998901234567", role="student"
        )
        self.backend = EmailOrUsernameModelBackend()

    def auth(self, ident, password=PASSWORD):
        return self.backend.authenticate(None, username=ident, password=password)

    def test_the_phone_signs_in_with_or_without_the_plus_and_spaces(self):
        for ident in ("998901234567", "+998901234567", "+998 90 123 45 67", "+998 (90) 123-45-67", "90 123 45 67"):
            self.assertEqual(self.auth(ident), self.user, ident)

    def test_the_password_still_has_to_be_right(self):
        self.assertIsNone(self.auth("+998901234567", "wrong-password"))

    def test_a_username_or_email_that_merely_contains_digits_is_not_rewritten(self):
        other = User.objects.create_user("ali@example.com", password=PASSWORD, username="ali+998901234567")
        self.assertEqual(self.auth("ali+998901234567"), other)
        self.assertEqual(self.auth("ali@example.com"), other)

    def test_an_exact_username_wins_over_the_phone_form(self):
        # Someone really called "+998901234567" (however unlikely) keeps their own login.
        literal = User.objects.create_user(None, password="Another-Pass-2026", username="+998901234567")
        self.assertEqual(self.auth("+998901234567", "Another-Pass-2026"), literal)

    def test_a_phone_that_is_not_an_uzbek_number_is_not_guessed(self):
        self.assertIsNone(self.auth("+1 202 555 0143"))

    def test_only_the_username_is_matched_never_someone_elses_phone_number_field(self):
        User.objects.create_user(None, password=PASSWORD, username="malika", phone_number="998907777777", role="student")
        self.assertIsNone(self.auth("+998 90 777 77 77"))

    def test_through_the_login_endpoint(self):
        api = APIClient()
        resp = api.post(
            "/api/auth/login/",
            {"email": "+998 90 123 45 67", "password": PASSWORD},
            format="json",
            HTTP_ORIGIN="http://localhost:3000",
            HTTP_REFERER="http://localhost:3000/login",
        )
        self.assertEqual(resp.status_code, 200, resp.content[:300])
