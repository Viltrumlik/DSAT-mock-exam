"""Which console a sign-in is allowed to land on — on EVERY path that mints a token.

Written after a support teacher reported they could not get into the teacher panel. They were
signed in the whole time: the password path refused them on the main site and told them where
the portal was, but the Google path had no console check at all, so it let them in and left
them on the student experience with nothing explaining why the teacher panel was missing.

The rule is only worth anything if every door applies it, so these tests are parametrised over
the doors rather than written once against the one that happened to have it.
"""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C

User = get_user_model()

MAIN = "mastersat.uz"
TEACHER = "teacher.mastersat.uz"


class ConsoleGateHelperTests(TestCase):
    """The shared decision, exercised directly — the view tests below prove it is CALLED."""

    def setUp(self):
        from users.views import _console_refusal_for

        self.gate = _console_refusal_for
        self.support = User(email="g_sup@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH)
        self.teacher = User(email="g_t@t.com", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.student = User(email="g_s@t.com", role=C.ROLE_STUDENT)

    def _req(self, console):
        class R:
            lms_console = console

        return R()

    def test_a_support_teacher_is_sent_to_the_portal_from_the_main_site(self):
        denied = self.gate(self._req("main"), self.support)

        self.assertIsNotNone(denied)
        self.assertEqual(denied.status_code, 403)
        # The refusal has to say where to go, or it is just a locked door.
        self.assertIn("teacher.mastersat.uz", denied.data["detail"])

    def test_a_support_teacher_is_allowed_on_the_portal(self):
        self.assertIsNone(self.gate(self._req("teacher"), self.support))

    def test_a_teacher_is_allowed_on_the_portal_and_refused_on_main(self):
        self.assertIsNone(self.gate(self._req("teacher"), self.teacher))
        self.assertIsNotNone(self.gate(self._req("main"), self.teacher))

    def test_a_student_is_refused_the_portal_and_allowed_on_main(self):
        self.assertIsNotNone(self.gate(self._req("teacher"), self.student))
        self.assertIsNone(self.gate(self._req("main"), self.student))


# The console is derived from the Host header, so these hosts have to be real ones as far
# as Django is concerned or the request dies at ALLOWED_HOSTS before any view runs.
@override_settings(ALLOWED_HOSTS=[MAIN, TEACHER, "testserver"])
class GoogleSignInAppliesTheGateTests(TestCase):
    """The path that actually let the support teacher through."""

    def setUp(self):
        self.client = APIClient()
        # Names matter: the Google view refuses an incomplete profile BEFORE the console
        # check, so without them these tests would 400 and never reach what they are testing.
        self.support = User.objects.create_user(
            "gsup@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_BOTH,
            first_name="Sardor", last_name="Umarov",
        )

    def _google_as(self, host):
        # Stand in for Google's verifier: the point under test is the console decision, not
        # token verification, and the real call needs the network.
        with patch("google.oauth2.id_token.verify_oauth2_token") as verify:
            verify.return_value = {
                "email": self.support.email,
                "email_verified": True,
                # At least three characters each: the view refuses an incomplete profile from
                # the PAYLOAD before it ever reaches the console decision.
                "given_name": "Sardor",
                "family_name": "Umarov",
                "sub": "123",
                "aud": "test-client-id",
            }
            with self.settings(GOOGLE_CLIENT_ID="test-client-id"):
                return self.client.post(
                    "/api/users/google/", {"credential": "x"}, format="json", HTTP_HOST=host,
                )

    def test_google_on_the_main_site_refuses_a_support_teacher(self):
        response = self._google_as(MAIN)

        self.assertEqual(response.status_code, 403, response.content)
        self.assertIn("teacher.mastersat.uz", response.json()["detail"])
        # And crucially: no credentials handed out on the way to refusing.
        self.assertNotIn("access", response.json())
        self.assertFalse(response.cookies, "a refused sign-in must not set session cookies")

    def test_google_on_the_portal_lets_a_support_teacher_in(self):
        response = self._google_as(TEACHER)

        self.assertEqual(response.status_code, 200, response.content)
        # Not `access`: tokens are stripped from the body unless `include_tokens` is asked for
        # and are delivered as cookies instead. Success is the role coming back and a session
        # cookie being set — asserting on the token would pin a delivery detail, not the rule.
        self.assertEqual(response.json()["role"], C.ROLE_SUPPORT_TEACHER)
        self.assertTrue(response.cookies, "sign-in should set session cookies")
