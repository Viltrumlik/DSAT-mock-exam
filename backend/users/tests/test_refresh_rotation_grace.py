"""A native refresh whose reply is lost must not sign the student out.

Refresh rotates: the presented token is revoked inside the request and its successor travels
back in the reply. When that reply is lost (a network blip), the app still holds the revoked
token, and its retry used to 401 — which the Windows and iOS apps rightly treat as a definite
sign-out, mid-exam, through no fault of the student's.

So a rotation remembers its successor for AUTH_REFRESH_REUSE_GRACE_SECONDS, and the FIRST
re-presentation of the retired token from the same device gets that same successor back.
Everything around it stays exactly as strict as before, and most of this module pins that:
a reuse after the window, a second reuse, a reuse from another device or network, a reuse
after the successor was renewed or signed out (including signing out with the retired token
itself), and any browser (cookie) caller are all still refused.

Requests carry X-Real-IP as the deployed nginx sets it: gunicorn only ever sees the proxy as
REMOTE_ADDR (127.0.0.1, which is also the test client's), so the client's own address is there.
"""
from __future__ import annotations

import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, RequestFactory, SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from users import views
from users.auth_cookies import NATIVE_CLIENT_HEADER, REFRESH_COOKIE
from users.models import RefreshSession, SecurityAuditEvent

User = get_user_model()

_HOST = "mastersat.uz"
_ALLOWED = ("testserver", "localhost", "127.0.0.1", _HOST)
_NATIVE_HEADER_KEY = "HTTP_" + NATIVE_CLIENT_HEADER.upper().replace("-", "_")
_DESKTOP_UA = "MasterSAT-Desktop/1.0 (Windows NT 10.0)"
_LAB_IP = "203.0.113.10"
_NATIVE = {_NATIVE_HEADER_KEY: "windows/1.0.0", "HTTP_USER_AGENT": _DESKTOP_UA, "HTTP_X_REAL_IP": _LAB_IP}
_GRACE = 60


@override_settings(ALLOWED_HOSTS=list(_ALLOWED), AUTH_REFRESH_REUSE_GRACE_SECONDS=_GRACE)
class RefreshRotationGraceTests(TestCase):
    def setUp(self):
        # The login throttle is keyed on the address every test shares.
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.student = User.objects.create_user(email="desktop-student@example.com", password="pw")

    def _login(self) -> str:
        r = self.client.post(
            "/api/auth/login/",
            data={"email": self.student.email, "password": "pw"},
            content_type="application/json",
            HTTP_HOST=_HOST,
            **_NATIVE,
        )
        self.assertEqual(r.status_code, 200, r.content)
        return r.data["refresh"]

    def _refresh(self, token: str, **headers):
        return self.client.post(
            "/api/auth/refresh/",
            data={"refresh": token},
            content_type="application/json",
            HTTP_HOST=_HOST,
            **{**_NATIVE, **headers},
        )

    def _rotate(self, token: str) -> str:
        """A refresh that reached the server and rotated; the caller decides if its reply was lost."""
        r = self._refresh(token)
        self.assertEqual(r.status_code, 200, r.content)
        return r.data["refresh"]

    def _live_jtis(self) -> set[str]:
        return set(
            RefreshSession.objects.filter(user=self.student, revoked_at__isnull=True).values_list(
                "refresh_jti", flat=True
            )
        )

    def _replays_blocked(self) -> int:
        return SecurityAuditEvent.objects.filter(user=self.student, event_type="refresh_replay_blocked").count()

    # ── the lost reply is recovered ───────────────────────────────────────────

    def test_retry_after_a_lost_reply_gets_the_successor_pair(self):
        spent = self._login()
        successor = self._rotate(spent)  # the reply never reaches the app

        retry = self._refresh(spent)

        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertTrue(retry.data.get("access"))
        # The SAME successor, not a new session: nothing is minted for the retry, so the
        # device list still shows one session and nothing new is left dangling.
        self.assertEqual(retry.data.get("refresh"), successor)
        self.assertEqual(self._live_jtis(), {str(RefreshToken(successor)["jti"])})
        self.assertNotIn(REFRESH_COOKIE, retry.cookies)
        self.assertTrue(
            SecurityAuditEvent.objects.filter(user=self.student, event_type="refresh_reuse_grace").exists()
        )
        self.assertEqual(self._replays_blocked(), 0)

    def test_the_recovered_pair_keeps_the_session_going(self):
        """Proves the handed-back successor is usable, not just present."""
        spent = self._login()
        self._rotate(spent)
        recovered = self._refresh(spent).data["refresh"]

        next_renewal = self._refresh(recovered)

        self.assertEqual(next_renewal.status_code, 200, next_renewal.content)
        self.assertTrue(next_renewal.data.get("refresh"))

    def test_retry_late_in_the_window_still_succeeds(self):
        spent = self._login()
        successor = self._rotate(spent)

        with patch("time.time", return_value=time.time() + _GRACE - 5):
            retry = self._refresh(spent)

        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.data.get("refresh"), successor)

    def test_retry_found_by_the_session_probe_when_the_revocation_marker_is_missing(self):
        """The revoked-jti cache marker is best-effort; the session-row probe catches the reuse
        instead, and the grace has to answer there too."""
        spent = self._login()
        successor = self._rotate(spent)
        cache.delete(views._revoked_key(str(RefreshToken(spent)["jti"])))

        retry = self._refresh(spent)

        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.data.get("refresh"), successor)

    def test_retry_that_raced_the_rotation_still_in_flight_gets_the_successor(self):
        """The app timed out and retried while the first refresh was still being served: the
        retry passed the session probe, then lost the row lock to the rotation. It must get
        the successor that rotation issued, not a 401."""
        spent = self._login()
        factory = APIRequestFactory()

        def call_refresh():
            request = factory.post(
                "/api/auth/refresh/", {"refresh": spent}, format="json", HTTP_HOST=_HOST, **_NATIVE
            )
            return views.CookieTokenRefreshView.as_view()(request)

        first = {}

        class FirstRefreshLandsMidway(views.TokenRefreshSerializer):
            # Runs between the retry's session probe and its locked re-read — exactly where a
            # concurrent rotation commits in production.
            def is_valid(self, *args, **kwargs):
                if not first:
                    first["reply"] = None
                    first["reply"] = call_refresh()
                return super().is_valid(*args, **kwargs)

        with patch.object(views, "TokenRefreshSerializer", FirstRefreshLandsMidway):
            retry = call_refresh()

        self.assertEqual(first["reply"].status_code, 200, first["reply"].data)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(retry.data["refresh"], first["reply"].data["refresh"])
        self.assertEqual(len(self._live_jtis()), 1)

    # ── replay detection outside the grace is unchanged ───────────────────────

    def test_retry_after_the_window_is_refused(self):
        spent = self._login()
        self._rotate(spent)

        with patch("time.time", return_value=time.time() + _GRACE + 1):
            retry = self._refresh(spent)

        self.assertEqual(retry.status_code, 401)
        self.assertEqual(self._replays_blocked(), 1)

    def test_a_second_reuse_is_a_replay(self):
        spent = self._login()
        self._rotate(spent)
        self.assertEqual(self._refresh(spent).status_code, 200)

        again = self._refresh(spent)

        self.assertEqual(again.status_code, 401)
        self.assertEqual(again.data.get("detail"), "Refresh token revoked.")
        self.assertEqual(self._replays_blocked(), 1)

    def test_reuse_after_the_successor_was_renewed_is_a_replay(self):
        """The app clearly got the reply — it already renewed with the successor — so the old
        token coming back can only be a copy."""
        spent = self._login()
        successor = self._rotate(spent)
        self._rotate(successor)

        reuse = self._refresh(spent)

        self.assertEqual(reuse.status_code, 401)
        self.assertEqual(self._replays_blocked(), 1)

    def test_reuse_after_the_successor_was_signed_out_is_refused(self):
        """The grace must never revive a session someone deliberately ended."""
        spent = self._login()
        successor = self._rotate(spent)
        self.client.post(
            "/api/auth/logout/", data={"refresh": successor}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        )

        reuse = self._refresh(spent)

        self.assertEqual(reuse.status_code, 401)
        self.assertEqual(self._live_jtis(), set())

    def test_reuse_from_another_device_is_a_replay_and_spends_the_grace(self):
        spent = self._login()
        self._rotate(spent)

        elsewhere = self._refresh(spent, HTTP_USER_AGENT="curl/8.7.1")
        then_the_app = self._refresh(spent)

        self.assertEqual(elsewhere.status_code, 401)
        # One re-presentation, whoever makes it: once a stranger has spent it, the token is
        # done for good, so the grace can never be probed for a second chance.
        self.assertEqual(then_the_app.status_code, 401)
        self.assertEqual(self._replays_blocked(), 2)

    def test_reuse_from_another_network_with_the_apps_user_agent_is_a_replay(self):
        """The User-Agent is the client's to choose; the address nginx saw is not."""
        spent = self._login()
        self._rotate(spent)

        elsewhere = self._refresh(spent, HTTP_X_REAL_IP="198.51.100.7")

        self.assertEqual(elsewhere.status_code, 401)
        self.assertEqual(self._replays_blocked(), 1)

    def test_signing_out_with_the_spent_token_ends_its_successor(self):
        """All the app holds after a lost reply is the retired token, so that is what it signs
        out with. The session it now lives on as must end, or the grace would revive it."""
        spent = self._login()
        successor = self._rotate(spent)  # the reply never reaches the app

        out = self.client.post(
            "/api/auth/logout/", data={"refresh": spent}, content_type="application/json",
            HTTP_HOST=_HOST, **_NATIVE,
        )

        self.assertEqual(out.status_code, 200, out.content)
        self.assertEqual(self._live_jtis(), set())
        self.assertEqual(self._refresh(spent).status_code, 401)
        self.assertEqual(self._refresh(successor).status_code, 401)

    @override_settings(AUTH_REFRESH_REUSE_GRACE_SECONDS=0)
    def test_a_zero_window_turns_the_grace_off(self):
        spent = self._login()
        self._rotate(spent)

        self.assertEqual(self._refresh(spent).status_code, 401)

    # ── browsers are unaffected ───────────────────────────────────────────────

    def _browser(self) -> Client:
        browser = Client(enforce_csrf_checks=True)
        browser.get("/api/auth/csrf/", HTTP_HOST=_HOST)
        r = browser.post(
            "/api/auth/login/",
            data={"email": self.student.email, "password": "pw"},
            content_type="application/json",
            **self._browser_headers(browser),
        )
        self.assertEqual(r.status_code, 200, r.content)
        return browser

    @staticmethod
    def _browser_headers(browser: Client) -> dict:
        return {
            "HTTP_HOST": _HOST,
            "HTTP_ORIGIN": f"https://{_HOST}",
            "HTTP_X_CSRFTOKEN": browser.cookies["csrftoken"].value,
        }

    def test_browser_reuse_of_a_rotated_cookie_is_still_a_replay(self):
        browser = self._browser()
        spent = browser.cookies[REFRESH_COOKIE].value
        rotated = browser.post(
            "/api/auth/refresh/", data={}, content_type="application/json", **self._browser_headers(browser)
        )
        self.assertEqual(rotated.status_code, 200, rotated.content)
        self.assertIsNone(rotated.data.get("refresh"), "a browser never sees a raw refresh token")

        browser.cookies[REFRESH_COOKIE] = spent
        reuse = browser.post(
            "/api/auth/refresh/", data={}, content_type="application/json", **self._browser_headers(browser)
        )

        self.assertEqual(reuse.status_code, 401)
        self.assertIsNone(reuse.data.get("refresh"))
        self.assertEqual(self._replays_blocked(), 1)

    def test_a_natively_rotated_token_reused_through_a_cookie_is_a_replay(self):
        """A request carrying an auth cookie is a browser's whatever its header says, and a
        browser is never handed a raw refresh token — not even by the grace."""
        spent = self._login()
        self._rotate(spent)
        browser = Client(enforce_csrf_checks=True)
        browser.get("/api/auth/csrf/", HTTP_HOST=_HOST)
        browser.cookies[REFRESH_COOKIE] = spent

        reuse = browser.post(
            "/api/auth/refresh/", data={}, content_type="application/json",
            **self._browser_headers(browser), **_NATIVE,
        )

        self.assertEqual(reuse.status_code, 401)
        self.assertIsNone(reuse.data.get("refresh"))


class ClientAddressTests(SimpleTestCase):
    """X-Real-IP is only as trustworthy as whoever set it: nginx overwrites it, but a caller
    reaching gunicorn directly could write anything there."""

    def _address(self, **meta) -> str:
        return views._client_address(RequestFactory().post("/api/auth/refresh/", **meta))

    def test_behind_the_proxy_the_forwarded_address_is_the_client(self):
        self.assertEqual(self._address(REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP=_LAB_IP), _LAB_IP)

    def test_a_direct_caller_cannot_claim_someone_elses_address(self):
        self.assertEqual(
            self._address(REMOTE_ADDR="198.51.100.7", HTTP_X_REAL_IP=_LAB_IP), "198.51.100.7"
        )

    def test_without_the_header_the_peer_is_all_there_is(self):
        self.assertEqual(self._address(REMOTE_ADDR="127.0.0.1"), "127.0.0.1")
