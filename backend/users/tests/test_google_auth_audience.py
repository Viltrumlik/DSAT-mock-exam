"""Google sign-in must never verify an ID token without an audience.

``id_token.verify_oauth2_token(..., audience=None)`` skips the audience check
entirely — google-auth's own docstring says "If None then the audience is not
verified". Issuer and signature still pass, so the endpoint would accept a token
Google minted for *any other OAuth client in the world* and hand back a session
for whoever owns the matching email, admin accounts included.

``GOOGLE_CLIENT_ID`` defaults to ``""``, and ``"" or None`` is ``None``, so an
unconfigured server was the vulnerable one. Unset must therefore DISABLE Google
sign-in (503), never silently weaken it — the contract the Telegram OIDC path
already follows in ``_verified_telegram_oidc_payload``.
"""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()

URL = "/api/users/google/"

# What Google would return for a token that is validly signed but was issued to
# somebody else's OAuth client. Only the audience check separates it from ours.
FOREIGN_TOKEN_PAYLOAD = {
    "email": "victim@t.com",
    "email_verified": True,
    "given_name": "Victor",
    "family_name": "Target",
}


class GoogleAuthAudienceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        # A real, privileged account an attacker would want to land on.
        self.victim = User.objects.create_user("victim@t.com", "secret123")

    @override_settings(GOOGLE_CLIENT_ID="")
    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_unset_client_id_disables_sign_in_instead_of_skipping_audience(self, verify):
        verify.return_value = dict(FOREIGN_TOKEN_PAYLOAD)

        resp = self.client.post(URL, {"credential": "validly-signed-foreign-token"}, format="json")

        self.assertEqual(resp.status_code, 503)
        # The heart of the fix: verification is never reached, so there is no code
        # path left on which audience could be None.
        verify.assert_not_called()
        # And no session was minted for the victim.
        self.assertNotIn("lms_access", resp.cookies)
        self.assertNotIn("access", resp.data)

    @override_settings(GOOGLE_CLIENT_ID="   ")
    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_whitespace_only_client_id_counts_as_unset(self, verify):
        verify.return_value = dict(FOREIGN_TOKEN_PAYLOAD)

        resp = self.client.post(URL, {"credential": "validly-signed-foreign-token"}, format="json")

        self.assertEqual(resp.status_code, 503)
        verify.assert_not_called()

    @override_settings(GOOGLE_CLIENT_ID="ours.apps.googleusercontent.com")
    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_configured_client_id_is_passed_as_the_audience(self, verify):
        verify.return_value = dict(FOREIGN_TOKEN_PAYLOAD)

        resp = self.client.post(URL, {"credential": "a-token"}, format="json")

        self.assertEqual(resp.status_code, 200)
        _args, kwargs = verify.call_args
        self.assertEqual(kwargs.get("audience"), "ours.apps.googleusercontent.com")
        self.assertIsNotNone(kwargs.get("audience"))

    @override_settings(GOOGLE_CLIENT_ID="ours.apps.googleusercontent.com")
    @patch("google.oauth2.id_token.verify_oauth2_token")
    def test_token_rejected_by_the_audience_check_does_not_log_anyone_in(self, verify):
        # google-auth raises when the token's aud does not match the audience we pass.
        verify.side_effect = ValueError("Token has wrong audience")

        resp = self.client.post(URL, {"credential": "foreign-token"}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertNotIn("lms_access", resp.cookies)
