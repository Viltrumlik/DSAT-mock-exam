"""The native-app (iOS/Android) auth contract.

A native client has no cookie jar we want to use: it keeps the token pair in the Keychain
and sends ``Authorization: Bearer``. That means three things must hold, and each one is a
hard blocker for the app if it breaks:

  * login and refresh must pass CSRF without a csrftoken cookie the app cannot have;
  * neither may Set-Cookie, so a login can never plant a session in a browser;
  * refresh must hand back the ROTATED refresh token, or the app is locked out three
    hours later with no cookie to pick the new one up from.

The exemption is deliberately narrow — declared header AND no auth cookie — so the tests
below also pin what must NOT be relaxed: a browser (cookies present) stays fully enforced,
and a request without the header stays fully enforced.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from users.auth_cookies import ACCESS_COOKIE, NATIVE_CLIENT_HEADER, REFRESH_COOKIE
from users.models import RefreshSession

User = get_user_model()

_HOST = "mastersat.uz"
_ALLOWED = ("testserver", "localhost", "127.0.0.1", _HOST)
# Django turns a header name into the WSGI key the test client expects.
_NATIVE_HEADER_KEY = "HTTP_" + NATIVE_CLIENT_HEADER.upper().replace("-", "_")
_NATIVE = {_NATIVE_HEADER_KEY: "ios/1.0.0"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED))
class NativeClientAuthTests(TestCase):
    def setUp(self):
        # enforce_csrf_checks mirrors production: without the exemption every POST below
        # would 403 before reaching the view.
        self.client = Client(enforce_csrf_checks=True)
        self.student = User.objects.create_user(email="ios-student@example.com", password="pw")

    def _login(self, **extra):
        return self.client.post(
            "/api/auth/login/",
            data={"email": self.student.email, "password": "pw"},
            content_type="application/json",
            HTTP_HOST=_HOST,
            **extra,
        )

    # ── the app can get in ────────────────────────────────────────────────────

    def test_login_returns_both_tokens_and_sets_no_cookie(self):
        r = self._login(**_NATIVE)

        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data.get("access"))
        self.assertTrue(r.data.get("refresh"))
        # The whole safety argument for exempting login rests on this: a login that plants
        # no cookie cannot be used to log a browser into someone else's account.
        self.assertNotIn(ACCESS_COOKIE, r.cookies)
        self.assertNotIn(REFRESH_COOKIE, r.cookies)

    def test_bearer_token_authenticates_a_normal_request(self):
        access = self._login(**_NATIVE).data["access"]

        r = self.client.get("/api/users/me/", HTTP_HOST=_HOST, HTTP_AUTHORIZATION=f"Bearer {access}", **_NATIVE)

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("email"), self.student.email)

    def test_login_still_records_a_revocable_session(self):
        """A phone is the device a student most needs to be able to sign out remotely."""
        self._login(**_NATIVE)

        self.assertEqual(RefreshSession.objects.filter(user=self.student, revoked_at__isnull=True).count(), 1)

    # ── the app can stay in ───────────────────────────────────────────────────

    def test_refresh_returns_the_rotated_refresh_token(self):
        refresh = self._login(**_NATIVE).data["refresh"]

        r = self.client.post(
            "/api/auth/refresh/",
            data={"refresh": refresh},
            content_type="application/json",
            HTTP_HOST=_HOST,
            **_NATIVE,
        )

        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data.get("access"))
        # Without this the app dies at the first renewal: rotation revoked the token it
        # just spent and there is no cookie carrying the replacement.
        self.assertTrue(r.data.get("refresh"))
        self.assertNotEqual(r.data["refresh"], refresh)
        self.assertNotIn(REFRESH_COOKIE, r.cookies)

    def test_rotated_refresh_token_works_for_the_next_renewal(self):
        """Proves the returned token is usable, not just present and well-formed."""
        first = self._login(**_NATIVE).data["refresh"]
        second = self.client.post(
            "/api/auth/refresh/", data={"refresh": first}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        ).data["refresh"]

        r = self.client.post(
            "/api/auth/refresh/", data={"refresh": second}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        )

        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data.get("access"))

    def test_spent_refresh_token_is_rejected(self):
        """Rotation must still be one-shot for native clients — no replay."""
        first = self._login(**_NATIVE).data["refresh"]
        self.client.post(
            "/api/auth/refresh/", data={"refresh": first}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        )

        replay = self.client.post(
            "/api/auth/refresh/", data={"refresh": first}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        )

        self.assertEqual(replay.status_code, 401)

    # ── the app can get out ───────────────────────────────────────────────────

    def test_logout_revokes_the_session_named_in_the_body(self):
        refresh = self._login(**_NATIVE).data["refresh"]

        r = self.client.post(
            "/api/auth/logout/",
            data={"refresh": refresh},
            content_type="application/json",
            HTTP_HOST=_HOST,
            **_NATIVE,
        )

        self.assertEqual(r.status_code, 200, r.content)
        # A signed-out phone must not linger under /api/auth/sessions/ with a live token.
        self.assertEqual(RefreshSession.objects.filter(user=self.student, revoked_at__isnull=True).count(), 0)
        replay = self.client.post(
            "/api/auth/refresh/", data={"refresh": refresh}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        )
        self.assertEqual(replay.status_code, 401)

    # ── what must NOT be relaxed ──────────────────────────────────────────────

    def test_without_the_header_csrf_is_still_enforced(self):
        r = self._login()

        self.assertEqual(r.status_code, 403, "a plain cookie-less POST must not get the exemption")

    def test_a_request_carrying_an_auth_cookie_is_never_native(self):
        """Header + cookies = a browser, whatever the header claims. Stay enforced."""
        self.client.cookies[ACCESS_COOKIE] = "some-browser-session"

        r = self._login(**_NATIVE)

        self.assertEqual(r.status_code, 403)

    def test_browser_login_is_unchanged(self):
        """The cookie transport keeps working exactly as before, tokens out of JS reach."""
        self.client.get("/api/auth/csrf/", HTTP_HOST=_HOST)
        csrf = self.client.cookies["csrftoken"].value

        r = self.client.post(
            "/api/auth/login/",
            data={"email": self.student.email, "password": "pw"},
            content_type="application/json",
            HTTP_HOST=_HOST,
            HTTP_ORIGIN=f"https://{_HOST}",
            HTTP_X_CSRFTOKEN=csrf,
        )

        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn(ACCESS_COOKIE, r.cookies)
        self.assertIn(REFRESH_COOKIE, r.cookies)
        self.assertIsNone(r.data.get("access"), "browser must not receive raw tokens in the body")
        self.assertIsNone(r.data.get("refresh"))
