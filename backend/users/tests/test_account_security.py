"""The profile's sign-in settings: which devices are signed in, signing the others out, and
changing your own password.

Driven through the browser transport — real login, cookies, CSRF — because "this device" IS the
refresh cookie. A force-authenticated request carries no refresh token, so it has no current
session to find and would prove nothing about the one thing these endpoints have to get right:
never signing out the browser that asked.
"""
from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from users.auth_cookies import REFRESH_COOKIE
from users.models import RefreshSession, SecurityAuditEvent
from users.throttles import PasswordChangeThrottle

User = get_user_model()

_HOST = "mastersat.uz"
_ALLOWED = ("testserver", "localhost", "127.0.0.1", _HOST)
_PASSWORD = "Violet-Harbor-26"
_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"


@override_settings(ALLOWED_HOSTS=list(_ALLOWED))
class _SignedInBrowsers(TestCase):
    def setUp(self):
        # Throttle counters live in the cache, and the login throttle is keyed on the address
        # every test shares.
        cache.clear()
        self.student = User.objects.create_user(
            email="madina@example.com",
            password=_PASSWORD,
            username="madina_y",
            first_name="Madina",
            last_name="Yusupova",
        )
        self.laptop = self.sign_in(_WINDOWS)

    def sign_in(self, user_agent: str) -> Client:
        """A browser that has signed in: its own cookie jar, its own session row."""
        client = Client(enforce_csrf_checks=True, HTTP_USER_AGENT=user_agent)
        client.get("/api/auth/csrf/", HTTP_HOST=_HOST)
        r = client.post(
            "/api/auth/login/",
            data={"email": self.student.email, "password": _PASSWORD},
            content_type="application/json",
            **self.unsafe(client),
        )
        self.assertEqual(r.status_code, 200, r.content)
        return client

    @staticmethod
    def unsafe(client: Client) -> dict:
        """What a browser sends with a POST: same-site Origin and the CSRF token pair."""
        return {
            "HTTP_HOST": _HOST,
            "HTTP_ORIGIN": f"https://{_HOST}",
            "HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value,
        }

    @staticmethod
    def jti(client: Client) -> str:
        return str(RefreshToken(client.cookies[REFRESH_COOKIE].value)["jti"])

    def live_jtis(self) -> set[str]:
        return set(
            RefreshSession.objects.filter(user=self.student, revoked_at__isnull=True).values_list(
                "refresh_jti", flat=True
            )
        )

    def refresh(self, client: Client):
        return client.post("/api/auth/refresh/", data={}, content_type="application/json", **self.unsafe(client))


class SessionListTests(_SignedInBrowsers):
    def test_lists_the_signed_in_devices_only_with_this_one_first(self):
        phone = self.sign_in(_IPHONE)
        # A renewal's leftover: rotation revokes the old row and writes a new one.
        RefreshSession.objects.create(user=self.student, refresh_jti="rotated-away", revoked_at=timezone.now())
        # A device that stopped coming back: never revoked, but its token is past renewing.
        stale = RefreshSession.objects.create(user=self.student, refresh_jti="gone-quiet", user_agent=_IPHONE)
        RefreshSession.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(days=8))

        r = self.laptop.get("/api/auth/sessions/", HTTP_HOST=_HOST)

        self.assertEqual(r.status_code, 200, r.content)
        rows = r.data["sessions"]
        jti_by_id = dict(RefreshSession.objects.filter(user=self.student).values_list("id", "refresh_jti"))
        self.assertEqual([jti_by_id[row["id"]] for row in rows], [self.jti(self.laptop), self.jti(phone)])
        self.assertEqual([row["is_current"] for row in rows], [True, False])
        self.assertIn("Windows", rows[0]["user_agent"])

        # The same list from the phone names the phone.
        from_phone = phone.get("/api/auth/sessions/", HTTP_HOST=_HOST).data["sessions"]
        self.assertEqual(jti_by_id[from_phone[0]["id"]], self.jti(phone))
        self.assertTrue(from_phone[0]["is_current"])

    def test_without_a_refresh_cookie_no_device_is_called_this_one(self):
        self.sign_in(_IPHONE)
        del self.laptop.cookies[REFRESH_COOKIE]

        rows = self.laptop.get("/api/auth/sessions/", HTTP_HOST=_HOST).data["sessions"]

        self.assertEqual(len(rows), 2)
        self.assertFalse(any(row["is_current"] for row in rows))


class SignOutOtherDevicesTests(_SignedInBrowsers):
    URL = "/api/auth/sessions/revoke_all/"

    def test_keep_current_signs_out_every_other_device_and_leaves_this_one_alone(self):
        phone = self.sign_in(_IPHONE)
        tablet = self.sign_in(_IPHONE)

        r = self.laptop.post(self.URL, data={"keep_current": True}, content_type="application/json", **self.unsafe(self.laptop))

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data, {"ok": True, "revoked": 2, "kept_current": True})
        self.assertEqual(self.live_jtis(), {self.jti(self.laptop)})
        # This browser keeps its cookies — and can still renew with them.
        self.assertNotIn(REFRESH_COOKIE, r.cookies)
        self.assertEqual(self.refresh(self.laptop).status_code, 200)
        # The others are out at their next renewal.
        self.assertEqual(self.refresh(phone).status_code, 401)
        self.assertEqual(self.refresh(tablet).status_code, 401)
        self.assertTrue(
            SecurityAuditEvent.objects.filter(user=self.student, event_type="session_revoke_others").exists()
        )

    def test_without_keep_current_everything_goes_and_this_browser_is_signed_out_too(self):
        self.sign_in(_IPHONE)

        r = self.laptop.post(self.URL, data={}, content_type="application/json", **self.unsafe(self.laptop))

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["kept_current"], False)
        self.assertEqual(self.live_jtis(), set())
        self.assertEqual(r.cookies[REFRESH_COOKIE].value, "")

    def test_keep_current_with_no_identifiable_session_reads_as_everywhere(self):
        self.sign_in(_IPHONE)
        del self.laptop.cookies[REFRESH_COOKIE]

        r = self.laptop.post(self.URL, data={"keep_current": True}, content_type="application/json", **self.unsafe(self.laptop))

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["kept_current"], False)
        self.assertEqual(self.live_jtis(), set())


class ChangePasswordTests(_SignedInBrowsers):
    URL = "/api/auth/password/change/"

    def change(self, client: Client, **body):
        return client.post(self.URL, data=body, content_type="application/json", **self.unsafe(client))

    def test_changes_the_password_and_signs_out_the_other_devices(self):
        phone = self.sign_in(_IPHONE)
        before = timezone.now()

        r = self.change(self.laptop, current_password=_PASSWORD, new_password="Quiet-Lantern-81")

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["signed_out_sessions"], 1)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password("Quiet-Lantern-81"))
        self.assertFalse(self.student.check_password(_PASSWORD))
        self.assertGreaterEqual(self.student.last_password_change, before)
        # Whoever else was signed in is exactly who a password change locks out…
        self.assertEqual(self.refresh(phone).status_code, 401)
        # …and the browser that changed it stays in.
        self.assertEqual(self.live_jtis(), {self.jti(self.laptop)})
        self.assertEqual(self.refresh(self.laptop).status_code, 200)
        event = SecurityAuditEvent.objects.get(user=self.student, event_type="password_change")
        self.assertEqual(event.detail, {"signed_out_sessions": 1})

    def test_a_wrong_current_password_changes_nothing(self):
        phone = self.sign_in(_IPHONE)

        r = self.change(self.laptop, current_password="not-it", new_password="Quiet-Lantern-81")

        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(list(r.data), ["current_password"])
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password(_PASSWORD))
        self.assertEqual(self.live_jtis(), {self.jti(self.laptop), self.jti(phone)})
        self.assertTrue(
            SecurityAuditEvent.objects.filter(user=self.student, event_type="password_change_failed").exists()
        )

    def test_the_new_password_goes_through_the_validators(self):
        numeric = self.change(self.laptop, current_password=_PASSWORD, new_password="12345678")
        same = self.change(self.laptop, current_password=_PASSWORD, new_password=_PASSWORD)
        short = self.change(self.laptop, current_password=_PASSWORD, new_password="Ab1-x")

        for r in (numeric, same, short):
            self.assertEqual(r.status_code, 400, r.content)
            self.assertEqual(list(r.data), ["new_password"])
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password(_PASSWORD))

    def test_both_fields_are_required(self):
        r = self.change(self.laptop)

        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(set(r.data), {"current_password", "new_password"})

    def test_signed_out_and_frozen_accounts_are_refused(self):
        stranger = Client(enforce_csrf_checks=True)
        stranger.get("/api/auth/csrf/", HTTP_HOST=_HOST)
        anonymous = self.change(stranger, current_password=_PASSWORD, new_password="Quiet-Lantern-81")
        self.assertEqual(anonymous.status_code, 401, anonymous.content)

        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        frozen = self.change(self.laptop, current_password=_PASSWORD, new_password="Quiet-Lantern-81")
        self.assertEqual(frozen.status_code, 403, frozen.content)

        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password(_PASSWORD))

    def test_guesses_at_the_current_password_are_throttled(self):
        with mock.patch.object(PasswordChangeThrottle, "THROTTLE_RATES", {"password_change": "2/hour"}):
            statuses = [
                self.change(self.laptop, current_password=f"guess-{i}", new_password="Quiet-Lantern-81").status_code
                for i in range(3)
            ]

        self.assertEqual(statuses, [400, 400, 429])

    def test_a_post_without_the_csrf_token_never_reaches_the_view(self):
        """Companion to the rest: the transport above is the browser's, not an exemption."""
        r = self.laptop.post(
            self.URL,
            data={"current_password": _PASSWORD, "new_password": "Quiet-Lantern-81"},
            content_type="application/json",
            HTTP_HOST=_HOST,
            HTTP_ORIGIN=f"https://{_HOST}",
        )

        self.assertEqual(r.status_code, 403)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password(_PASSWORD))
