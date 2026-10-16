"""The Windows app's own login form: ``POST /api/desktop/auth/login/`` (DesktopPasswordLoginView)."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C
from lcup.models import AccountClaim
from users.auth_cookies import ACCESS_COOKIE, REFRESH_COOKIE
from users.models import RefreshSession

from .throttles import DesktopLoginPerIdentifierThrottle

User = get_user_model()

URL = "/api/desktop/auth/login/"
APP = "windows/0.2.6"
INVALID = {"detail": "Invalid credentials."}


class RateParsingTests(SimpleTestCase):
    def test_a_multiple_of_the_unit_is_a_window_of_that_length(self):
        parse = DesktopLoginPerIdentifierThrottle().parse_rate
        self.assertEqual(parse("10/15m"), (10, 900))
        self.assertEqual(parse("10/min"), (10, 60))
        self.assertEqual(parse("40/hour"), (40, 3600))
        self.assertEqual(parse("5/2h"), (5, 7200))
        self.assertEqual(parse(None), (None, None))

    def test_the_configured_rate_is_ten_tries_in_fifteen_minutes(self):
        throttle = DesktopLoginPerIdentifierThrottle()
        self.assertEqual((throttle.num_requests, throttle.duration), (10, 900))


class DesktopPasswordLoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.student = User.objects.create_user(
            username="stu", email="stu@example.com", password="right-pass", role=C.ROLE_STUDENT
        )

    def tearDown(self):
        cache.clear()

    def login(self, body, *, client=None, **headers):
        headers.setdefault("HTTP_X_MASTERSAT_CLIENT", APP)
        if headers["HTTP_X_MASTERSAT_CLIENT"] is None:
            del headers["HTTP_X_MASTERSAT_CLIENT"]
        return (client or APIClient()).post(URL, body, format="json", **headers)

    def assertSignedIn(self, res, user):
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIs(res.data["ok"], True)
        self.assertEqual(str(RefreshToken(res.data["refresh"])["user_id"]), str(user.pk))
        self.assertTrue(res.data["access"])

    # ── who gets in ──────────────────────────────────────────────────────────

    def test_signs_in_by_email(self):
        self.assertSignedIn(self.login({"identifier": "stu@example.com", "password": "right-pass"}), self.student)

    def test_signs_in_by_email_in_any_case(self):
        self.assertSignedIn(self.login({"identifier": "  STU@Example.com ", "password": "right-pass"}), self.student)

    def test_signs_in_by_username(self):
        self.assertSignedIn(self.login({"identifier": "stu", "password": "right-pass"}), self.student)

    def test_signs_in_by_phone_however_it_is_typed(self):
        phoned = User.objects.create_user(
            username="998901234567", email="ph@example.com", password="phone-pass", role=C.ROLE_STUDENT
        )
        self.assertSignedIn(self.login({"identifier": "+998 90 123-45-67", "password": "phone-pass"}), phoned)

    def test_email_is_accepted_as_the_identifiers_alias(self):
        self.assertSignedIn(self.login({"email": "stu@example.com", "password": "right-pass"}), self.student)

    def test_the_password_is_not_trimmed(self):
        res = self.login({"identifier": "stu", "password": " right-pass "})
        self.assertEqual(res.status_code, 401, res.content)

    # ── what a sign-in leaves behind ─────────────────────────────────────────

    def test_sets_no_cookie_and_records_the_session(self):
        res = self.login({"identifier": "stu", "password": "right-pass"})
        self.assertSignedIn(res, self.student)
        self.assertNotIn(ACCESS_COOKIE, res.cookies)
        self.assertNotIn(REFRESH_COOKIE, res.cookies)
        jti = RefreshToken(res.data["refresh"])["jti"]
        row = RefreshSession.objects.get(refresh_jti=jti)
        self.assertEqual(row.user_id, self.student.pk)
        self.assertIsNone(row.revoked_at)

    def test_the_refresh_token_renews_at_the_sites_refresh_endpoint(self):
        # One client that keeps cookies the way the app's HTTP client does, through the CSRF
        # middleware: a foreign Origin, no CSRF token — exactly what the app sends.
        client = APIClient(enforce_csrf_checks=True)
        res = self.login({"identifier": "stu", "password": "right-pass"}, client=client)
        self.assertSignedIn(res, self.student)
        refreshed = client.post(
            "/api/auth/refresh/",
            {"refresh": res.data["refresh"]},
            format="json",
            HTTP_X_MASTERSAT_CLIENT=APP,
            HTTP_ORIGIN="http://tauri.localhost",
        )
        self.assertEqual(refreshed.status_code, 200, refreshed.content)
        self.assertTrue(refreshed.data.get("access"))

    def test_a_password_sign_in_clears_a_security_step_up(self):
        User.objects.filter(pk=self.student.pk).update(
            security_step_up_required_until=timezone.now() + timedelta(hours=1)
        )
        self.assertSignedIn(self.login({"identifier": "stu", "password": "right-pass"}), self.student)
        self.student.refresh_from_db()
        self.assertIsNone(self.student.security_step_up_required_until)

    # ── who does not ─────────────────────────────────────────────────────────

    def test_a_wrong_password_is_invalid_credentials(self):
        res = self.login({"identifier": "stu", "password": "nope"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json(), INVALID)
        self.assertFalse(RefreshSession.objects.exists())

    def test_an_unknown_account_reads_exactly_like_a_wrong_password(self):
        res = self.login({"identifier": "nobody@example.com", "password": "right-pass"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json(), INVALID)

    def test_blank_or_missing_fields_are_invalid_credentials(self):
        for body in (
            {},
            {"identifier": "stu"},
            {"password": "right-pass"},
            {"identifier": "   ", "password": "right-pass"},
            {"identifier": "stu", "password": ""},
            {"identifier": ["stu"], "password": "right-pass"},
        ):
            res = self.login(body)
            self.assertEqual(res.status_code, 401, body)
            self.assertEqual(res.json(), INVALID, body)

    def test_a_deactivated_account_is_invalid_credentials(self):
        User.objects.filter(pk=self.student.pk).update(is_active=False)
        res = self.login({"identifier": "stu", "password": "right-pass"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json(), INVALID)

    def test_a_browser_is_sent_to_the_website(self):
        res = self.login({"identifier": "stu", "password": "right-pass"}, HTTP_X_MASTERSAT_CLIENT=None)
        self.assertEqual(res.status_code, 400)
        self.assertNotIn("access", res.json())
        self.assertNotIn(ACCESS_COOKIE, res.cookies)

    def test_a_request_carrying_an_auth_cookie_is_a_browsers(self):
        # Whatever the header says. The CSRF middleware refuses it first (403 "Bad origin."); the
        # view would refuse it too (400) — either way no tokens.
        client = APIClient()
        client.cookies[ACCESS_COOKIE] = "stale"
        res = self.login({"identifier": "stu", "password": "right-pass"}, client=client)
        self.assertIn(res.status_code, (400, 403))
        self.assertNotIn("access", res.json())

    def test_a_public_learner_is_refused(self):
        User.objects.create_user(
            username="pub", email="pub@example.com", password="right-pass", role=C.ROLE_PUBLIC_STUDENT
        )
        res = self.login({"identifier": "pub", "password": "right-pass"})
        self.assertEqual(res.status_code, 403, res.content)
        self.assertIn("learning center students", res.json()["detail"])
        self.assertFalse(RefreshSession.objects.exists())

    @override_settings(LCUP_ENABLED=True)
    def test_an_lcup_first_sign_in_is_sent_to_the_website_to_set_a_password(self):
        claimed = User.objects.create_user(None, password=None, username="998907654321", role=C.ROLE_STUDENT)
        self.assertFalse(claimed.has_usable_password())
        AccountClaim.objects.create(
            user=claimed, phone="998907654321", expires_at=timezone.now() + timedelta(days=14)
        )
        res = self.login({"identifier": "+998 90 765 43 21", "password": "4321"})
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(
            res.json(),
            {"code": "password_not_set", "detail": "Set your password on mastersat.uz first, then sign in here."},
        )
        self.assertFalse(RefreshSession.objects.exists())

    @override_settings(LCUP_ENABLED=True)
    def test_an_lcup_account_with_the_wrong_four_digits_is_invalid_credentials(self):
        claimed = User.objects.create_user(None, password=None, username="998907654321", role=C.ROLE_STUDENT)
        AccountClaim.objects.create(
            user=claimed, phone="998907654321", expires_at=timezone.now() + timedelta(days=14)
        )
        res = self.login({"identifier": "998907654321", "password": "0000"})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json(), INVALID)

    # ── throttles ────────────────────────────────────────────────────────────

    def test_ten_tries_at_one_account_then_429_with_retry_after(self):
        # Typed every way the account can be named: case and spacing do not open a fresh bucket.
        spellings = ["stu", "STU", " Stu "]
        for i in range(10):
            res = self.login({"identifier": spellings[i % 3], "password": "nope"})
            self.assertEqual(res.status_code, 401, f"try {i + 1}")
        res = self.login({"identifier": "stu", "password": "right-pass"})
        self.assertEqual(res.status_code, 429, res.content)
        self.assertTrue(res.has_header("Retry-After"))
        self.assertTrue(0 < int(res["Retry-After"]) <= 900, res["Retry-After"])
        # Another account from the same address is untouched.
        User.objects.create_user(username="other", email="other@example.com", password="p", role=C.ROLE_STUDENT)
        self.assertEqual(self.login({"identifier": "other", "password": "p"}).status_code, 200)

    def test_a_phone_typed_differently_is_the_same_account_to_the_throttle(self):
        for i, typed in enumerate(["998901112233", "+998 90 111 22 33", "90-111-22-33"] * 4):
            res = self.login({"identifier": typed, "password": "nope"})
            if i < 10:
                self.assertEqual(res.status_code, 401, typed)
            else:
                self.assertEqual(res.status_code, 429, typed)

    def test_one_address_is_capped_across_accounts(self):
        with mock.patch.object(
            ScopedRateThrottle, "THROTTLE_RATES", {**ScopedRateThrottle.THROTTLE_RATES, "desktop_login": "3/hour"}
        ):
            statuses = [
                self.login({"identifier": f"user{i}@example.com", "password": "nope"}).status_code for i in range(4)
            ]
        self.assertEqual(statuses, [401, 401, 401, 429])
