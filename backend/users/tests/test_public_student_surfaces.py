"""A public learner reaches only mocks, events, their profile and sign-in (plan 2026-10-13).

The host guard's allowlist is the gate (many student endpoints check no role at all, and DRF's
default admits any signed-in user); these tests pin it, and the per-surface refusals behind it.
"""

from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import get_resolver
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C
from access.host_guard import public_student_may
from desktop.models import DesktopAuthCode
from desktop.proof import new_secret, pkce_challenge, sha256_hex
from users.models import User

#: The top-level API namespaces a public learner may enter at all. Pinned on purpose: a new app is
#: closed to them until this set (and host_guard.PUBLIC_STUDENT_API_PREFIXES) says otherwise.
PUBLIC_NAMESPACES = {
    "/api/auth/", "/api/users/", "/api/mocks/", "/api/events/", "/api/notifications/",
    "/api/realtime/", "/api/annotations/", "/api/question-reports/", "/api/health/",
    "/api/schema/", "/api/csp-report/",
}


def top_level_api_prefixes() -> set[str]:
    out = set()
    for p in get_resolver().url_patterns:
        route = str(p.pattern).lstrip("^")
        parts = route.split("/")
        if parts[0] == "api" and len(parts) > 1 and parts[1]:
            out.add(f"/api/{parts[1]}/")
    return out


def bearer(user) -> dict:
    return {"HTTP_AUTHORIZATION": f"Bearer {RefreshToken.for_user(user).access_token}"}


class GateTests(TestCase):
    def setUp(self):
        self.pub = User.objects.create_user("p@example.com", password="x", username="pub", role=C.ROLE_PUBLIC_STUDENT)

    def test_every_other_api_namespace_is_closed_to_public_learners(self):
        prefixes = top_level_api_prefixes()
        self.assertIn("/api/classes/", prefixes)  # the walk found the real URLconf
        for prefix in prefixes - PUBLIC_NAMESPACES:
            self.assertFalse(public_student_may(prefix + "x/"), prefix)

    def test_inside_users_only_me_and_sign_in_paths_are_open(self):
        for open_path in ("/api/users/me/", "/api/users/google/", "/api/users/telegram/start/", "/api/users/exam-dates/"):
            self.assertTrue(public_student_may(open_path), open_path)
        for closed in ("/api/users/admin/list/", "/api/users/42/update/", "/api/users/activity/"):
            self.assertFalse(public_student_may(closed), closed)

    def test_mock_sessions_stay_with_the_learning_center(self):
        self.assertTrue(public_student_may("/api/mocks/mine/"))
        self.assertTrue(public_student_may("/api/mocks/attempts/5/status/"))
        self.assertFalse(public_student_may("/api/mocks/sessions/join/"))

    def test_a_refused_request_says_centre_only(self):
        api = APIClient()
        resp = api.get("/api/classes/", **bearer(self.pub))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "centre_only")
        self.assertEqual(api.get("/api/mocks/mine/", **bearer(self.pub)).status_code, 200)
        self.assertEqual(api.get("/api/users/me/", **bearer(self.pub)).status_code, 200)

    def test_a_learning_center_student_is_not_gated(self):
        s = User.objects.create_user("s@example.com", password="x", username="stu", role=C.ROLE_STUDENT)
        resp = APIClient().get("/api/classes/", **bearer(s))
        self.assertNotEqual(resp.status_code, 403)

    @override_settings(ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
    def test_the_admin_console_refuses_a_public_learner_too(self):
        resp = APIClient().get("/api/users/admin/list/", HTTP_HOST="admin.mastersat.uz", **bearer(self.pub))
        self.assertEqual(resp.status_code, 403)


class NativeAppTests(TestCase):
    PASSWORD = "Kitob-va-Qalam-2026"

    def setUp(self):
        cache.clear()
        User.objects.create_user("p@example.com", password=self.PASSWORD, username="pubapp", role=C.ROLE_PUBLIC_STUDENT)

    def login(self, client_header):
        return APIClient().post(
            "/api/auth/login/", {"email": "pubapp", "password": self.PASSWORD}, format="json",
            HTTP_X_MASTERSAT_CLIENT=client_header,
        )

    def test_the_ios_and_windows_apps_refuse_a_public_learner(self):
        for header in ("ios/1.4.0", "windows/0.2.5", "desktop"):
            resp = self.login(header)
            self.assertEqual(resp.status_code, 403, header)
            self.assertIn("learning center students", resp.json()["detail"])

    @override_settings(ALLOWED_HOSTS=["testserver", "mastersat.uz"])
    def test_the_browser_still_signs_a_public_learner_in(self):
        resp = APIClient().post(
            "/api/auth/login/", {"email": "pubapp", "password": self.PASSWORD}, format="json",
            HTTP_HOST="mastersat.uz", HTTP_ORIGIN="https://mastersat.uz",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_a_learning_center_student_still_signs_in_on_the_apps(self):
        User.objects.create_user("s@example.com", password=self.PASSWORD, username="stuapp", role=C.ROLE_STUDENT)
        resp = APIClient().post(
            "/api/auth/login/", {"email": "stuapp", "password": self.PASSWORD}, format="json",
            HTTP_X_MASTERSAT_CLIENT="windows/0.2.5",
        )
        self.assertEqual(resp.status_code, 200, resp.content)


class DesktopTests(TestCase):
    """The host guard already closes /api/desktop/ to public learners; these pin the views' own
    refusals behind it, so the apps stay shut if the allowlist ever opens wider."""

    VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

    def setUp(self):
        cache.clear()
        self.pub = User.objects.create_user("p@example.com", password="x", username="pubdesk", role=C.ROLE_PUBLIC_STUDENT)

    def test_the_browser_will_not_mint_a_public_learner_an_app_code(self):
        from desktop.views import AuthCodeView

        request = APIRequestFactory().post(
            "/api/desktop/auth/code/", {"challenge": pkce_challenge(self.VERIFIER)}, format="json"
        )
        force_authenticate(request, user=self.pub)
        resp = AuthCodeView.as_view()(request)
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(DesktopAuthCode.objects.exists())

    def test_a_code_minted_before_the_split_is_refused_at_the_exchange(self):
        code = new_secret()
        DesktopAuthCode.objects.create(
            code_hash=sha256_hex(code), challenge=pkce_challenge(self.VERIFIER), user=self.pub,
            expires_at=timezone.now() + timedelta(seconds=60),
        )
        resp = APIClient().post(
            "/api/desktop/auth/exchange/", {"code": code, "verifier": self.VERIFIER}, format="json",
            HTTP_X_MASTERSAT_CLIENT="windows/0.2.6",
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertIn("learning center students", resp.json()["detail"])

    @override_settings(DESKTOP_V1_ENABLED=True)
    def test_v1_refuses_a_public_learner_who_still_holds_tokens(self):
        from desktop.v1.home import HomeView

        request = APIRequestFactory().get("/api/desktop/v1/home", HTTP_X_MASTERSAT_CLIENT="windows/0.2.6")
        force_authenticate(request, user=self.pub)
        resp = HomeView.as_view()(request)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["code"], "forbidden")
