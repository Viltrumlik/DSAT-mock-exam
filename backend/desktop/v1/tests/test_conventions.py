"""What every /api/desktop/v1/ endpoint shares: the kill switch, auth, the error envelope,
the Windows build header (version gate, native-client CSRF rule), and the host guard."""

from __future__ import annotations

from django.core.cache import cache
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import resolve
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from access.host_guard import SubdomainAPIGuardMiddleware
from mobile.models import AppReleasePolicy
from mobile.policy import forget_policy, get_policy
from mobile.versioning import PLATFORM_WINDOWS, parse_client_header
from users.auth_cookies import ACCESS_COOKIE, is_native_client

from desktop.v1 import content
from desktop.v1.conventions import iso, parse_have_query, parse_sync_body, V1Error

from .support import (
    APP_HEADER,
    AppClient,
    V1TestCase,
    assert_shape,
    fixture,
    iso_ms,
    make_paper,
    make_student,
    manifest,
)

#: One concrete URL per v1 route (method, path).
V1_ROUTES = [
    ("get", "home"),
    ("post", "pastpapers/1/open"),
    ("post", "pastpapers/attempts/1/start"),
    ("post", "pastpapers/attempts/1/sync"),
    ("post", "pastpapers/attempts/1/submit"),
    ("post", "pastpapers/attempts/1/pause"),
    ("post", "pastpapers/attempts/1/resume"),
    ("get", "pastpapers/attempts/1/result"),
    ("post", "midterms/1/prepare"),
    ("post", "midterms/attempts/1/open"),
    ("post", "midterms/attempts/1/sync"),
    ("post", "midterms/attempts/1/submit"),
    ("post", "midterms/attempts/1/offscreen"),
    ("get", "midterms/attempts/1/result"),
    ("get", "attempts/pastpaper/1/media"),
    ("get", "attempts/midterm/1/media"),
]


class ContractCoverageTests(SimpleTestCase):
    def test_every_v1_endpoint_in_the_manifest_is_routed(self):
        seen = set()
        for row in manifest()["fixtures"]:
            path = row["path"]
            if not path.startswith("/api/desktop/v1/") or "*" in path:
                continue
            concrete = (
                path.replace("{practice_test_id}", "7").replace("{midterm_id}", "7").replace("{id}", "7").replace("{kind}", "pastpaper")
            )
            match = resolve(concrete)
            self.assertNotEqual(match.url_name, "desktop-v1-unknown", f"{row['file']}: {path} is not routed")
            seen.add(match.url_name)
        self.assertGreaterEqual(len(seen), 15)

    def test_content_hash_matches_the_contract_rule_for_every_fixture_module(self):
        """The server's hash is the generator's (and the app's ``contentHashOf``): recompute it
        over every module the fixtures ship and compare with the hash they carry."""
        checked = 0
        for row in manifest()["fixtures"]:
            body = fixture(row["file"])
            for module in (body.get("modules") or []) + ([body["next_module"]] if body.get("next_module") else []):
                if module.get("questions") is not None:
                    self.assertEqual(content.content_hash(module["questions"]), module["content_hash"], row["file"])
                    checked += 1
            for mid, block in (body.get("content") or {}).items():
                if block.get("questions") is not None:
                    self.assertEqual(content.content_hash(block["questions"]), block["content_hash"], row["file"])
                    checked += 1
        self.assertGreater(checked, 5)

    def test_timestamps_are_iso_utc_with_milliseconds(self):
        import datetime as dt

        value = dt.datetime(2026, 10, 11, 9, 0, 0, 123456, tzinfo=dt.timezone.utc)
        self.assertEqual(iso(value), "2026-10-11T09:00:00.123Z")
        self.assertTrue(iso_ms(iso(value)))
        tashkent = dt.timezone(dt.timedelta(hours=5))
        self.assertEqual(iso(dt.datetime(2026, 10, 11, 14, 0, tzinfo=tashkent)), "2026-10-11T09:00:00.000Z")
        self.assertIsNone(iso(None))

    def test_have_query_splits_each_item_on_its_first_colon(self):
        self.assertEqual(
            parse_have_query("301:sha256:abc,302:sha256:def, junk,:x,9:"),
            {"301": "sha256:abc", "302": "sha256:def"},
        )

    def test_sync_body_validation(self):
        body = parse_sync_body({"module_id": "301", "seq": 4, "answers": {"1": " B ", "2": None}, "flagged": [1, "1", 2]})
        self.assertEqual((body.module_id, body.seq), (301, 4))
        self.assertEqual(body.answers, {"1": "B", "2": ""})
        self.assertEqual(body.flagged, [1, 2])
        for bad in (
            [],
            {"seq": 1},
            {"module_id": True},
            {"module_id": 1, "answers": []},
            {"module_id": 1, "answers": {"x": "A"}},
            {"module_id": 1, "answers": {"1": 3}},
            {"module_id": 1, "answers": {"1": "A" * 40}},
            {"module_id": 1, "flagged": "1"},
        ):
            with self.assertRaises(V1Error, msg=repr(bad)) as ctx:
                parse_sync_body(bad)
            self.assertEqual(ctx.exception.http_status, 400)
            self.assertEqual(ctx.exception.body["code"], "bad_request")


@override_settings(DESKTOP_V1_ENABLED=False)
class KillSwitchTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_every_route_answers_503_desktop_v1_disabled_even_signed_out(self):
        for signed_in in (False, True):
            client = AppClient(make_student(username=f"s{int(signed_in)}") if signed_in else None)
            for method, path in V1_ROUTES + [("get", "no/such/path")]:
                res = getattr(client, method)(path)
                self.assertEqual(res.status_code, 503, f"{method} {path}: {res.content!r}")
                assert_shape(self, res.json(), fixture("error.503"))
                self.assertEqual(res.json()["code"], "desktop_v1_disabled")
                self.assertEqual(res["Retry-After"], "300")

    def test_the_website_desktop_routes_are_untouched_by_the_switch(self):
        res = APIClient().post("/api/desktop/auth/exchange/", {}, format="json")
        self.assertNotEqual(res.status_code, 503)


class AuthAndEnvelopeTests(V1TestCase):
    def test_signed_out_is_drf_401_not_the_v1_envelope(self):
        for method, path in V1_ROUTES:
            res = getattr(AppClient(None), method)(path)
            self.assertEqual(res.status_code, 401, f"{method} {path}")

    def test_unknown_v1_path_is_a_json_404(self):
        res = AppClient(make_student()).get("pastpapers/attempts/1/nonsense")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()["code"], "not_visible")

    def test_malformed_json_is_a_400_in_the_envelope(self):
        student = make_student()
        api = APIClient()
        api.force_authenticate(student)
        res = api.post(
            "/api/desktop/v1/pastpapers/1/open", data="{not json", content_type="application/json",
            HTTP_X_MASTERSAT_CLIENT=APP_HEADER,
        )
        self.assertEqual(res.status_code, 400)
        assert_shape(self, res.json(), fixture("error.400"))
        self.assertEqual(res.json()["code"], "bad_request")

    def test_writes_without_an_idempotency_key_are_refused(self):
        student = make_student()
        paper = make_paper(assign_to=student)
        client = AppClient(student)
        attempt_id = client.post(f"pastpapers/{paper.id}/open", {"start": True}).json()["attempt"]["id"]
        for action in ("start", "sync", "submit"):
            res = client.post(f"pastpapers/attempts/{attempt_id}/{action}", {"module_id": 1, "seq": 1})
            self.assertEqual(res.status_code, 400, action)
            self.assertEqual(res.json()["code"], "bad_request")


class WindowsBuildHeaderTests(V1TestCase):
    """``X-MasterSAT-Client: windows/<semver>``: a native client for CSRF, judged by the
    version gate; the 0.1.x app's bare ``desktop`` is still a native client and never judged."""

    def tearDown(self):
        forget_policy(PLATFORM_WINDOWS)
        super().tearDown()

    def test_header_parses_as_the_windows_platform(self):
        self.assertEqual(parse_client_header("windows/0.2.0"), (PLATFORM_WINDOWS, (0, 2, 0)))
        self.assertEqual(parse_client_header("windows/1.10.3 (win11)"), (PLATFORM_WINDOWS, (1, 10, 3)))
        self.assertIsNone(parse_client_header("desktop"))

    def test_is_native_client_accepts_windows_and_still_desktop_but_never_with_a_cookie(self):
        rf = RequestFactory()
        self.assertTrue(is_native_client(rf.get("/api/x", HTTP_X_MASTERSAT_CLIENT="windows/0.2.0")))
        self.assertTrue(is_native_client(rf.get("/api/x", HTTP_X_MASTERSAT_CLIENT="desktop")))
        with_cookie = rf.get("/api/x", HTTP_X_MASTERSAT_CLIENT="windows/0.2.0")
        with_cookie.COOKIES[ACCESS_COOKIE] = "browser-session"
        self.assertFalse(is_native_client(with_cookie))
        self.assertFalse(is_native_client(rf.get("/api/x")))

    def test_old_windows_build_gets_426_in_the_contract_shape(self):
        AppReleasePolicy.objects.create(platform=PLATFORM_WINDOWS, minimum_version="0.3.0", latest_version="0.3.1")
        forget_policy(PLATFORM_WINDOWS)
        student = make_student()
        res = AppClient(student, header="windows/0.2.0").get("home")
        self.assertEqual(res.status_code, 426)
        assert_shape(self, res.json(), fixture("error.426"))
        self.assertEqual(res.json()["minimum_version"], "0.3.0")
        self.assertEqual(res.json()["update_url"], "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe")
        # A current build passes; the 0.1.x app's bare "desktop" is never judged here (its
        # minimum is enforced by the lockdown proof instead).
        self.assertEqual(AppClient(student, header="windows/0.3.0").get("home").status_code, 200)
        self.assertEqual(AppClient(student, header="desktop").get("home").status_code, 200)

    def test_windows_policy_falls_back_to_the_site_installer(self):
        forget_policy(PLATFORM_WINDOWS)
        self.assertEqual(get_policy(PLATFORM_WINDOWS).update_url, "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe")
        AppReleasePolicy.objects.create(platform=PLATFORM_WINDOWS, update_url="https://example.org/setup.exe")
        forget_policy(PLATFORM_WINDOWS)
        self.assertEqual(get_policy(PLATFORM_WINDOWS).update_url, "https://example.org/setup.exe")
        forget_policy("ios")
        self.assertEqual(get_policy("ios").update_url, "")

    def test_bearer_token_write_needs_no_csrf_token(self):
        """The real path the app takes: Authorization: Bearer + the windows header, no cookie,
        no CSRF token — through the full middleware stack (no force_authenticate)."""
        student = make_student()
        paper = make_paper(assign_to=student)
        api = APIClient(enforce_csrf_checks=True)
        access = str(RefreshToken.for_user(student).access_token)
        res = api.post(
            f"/api/desktop/v1/pastpapers/{paper.id}/open", {"start": False}, format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}", HTTP_X_MASTERSAT_CLIENT=APP_HEADER,
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["attempt"]["kind"], "pastpaper")


class HostGuardTests(SimpleTestCase):
    @override_settings(ALLOWED_HOSTS=["*"])
    def test_apex_host_lets_v1_through(self):
        guard = SubdomainAPIGuardMiddleware(lambda request: HttpResponse("reached"))
        for path in ("/api/desktop/v1/home", "/api/desktop/v1/midterms/attempts/9/submit"):
            request = RequestFactory().get(path, HTTP_HOST="mastersat.uz")
            self.assertEqual(guard(request).content, b"reached", path)
