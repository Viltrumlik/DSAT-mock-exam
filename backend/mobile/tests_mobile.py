"""The native app's release policy, its version gate, and its crash reports."""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C

from .models import AppReleasePolicy, ClientDiagnostic
from .tasks import prune_diagnostics
from .versioning import evaluate, parse_client_header, parse_version

User = get_user_model()
ADMIN_HOST = "admin.mastersat.uz"


class VersioningTests(SimpleTestCase):
    def test_versions_compare_as_numbers_not_strings(self):
        # As strings 1.10.0 < 1.9.0; a gate built on that would lock out the NEWER app.
        self.assertLess(parse_version("1.9.0"), parse_version("1.10.0"))

    def test_lenient_parsing_matches_the_app(self):
        self.assertEqual(parse_version("1.4"), (1, 4, 0))
        self.assertEqual(parse_version("2"), (2, 0, 0))
        self.assertEqual(parse_version("2.1.0-rc1"), (2, 1, 0))
        self.assertEqual(parse_version("1.3 (40)"), (1, 3, 0))
        self.assertEqual(parse_version(" 1.2.3 "), (1, 2, 3))

    def test_unreadable_is_none(self):
        for raw in ("", None, "beta", "1..2", "1.", 5):
            self.assertIsNone(parse_version(raw), raw)

    def test_client_header(self):
        self.assertEqual(parse_client_header("ios/1.1.0"), ("ios", (1, 1, 0)))
        self.assertEqual(parse_client_header("ios/1.1.0 (2; iOS 26.3)"), ("ios", (1, 1, 0)))
        # The test client's marker and a browser's absence are not app builds.
        self.assertIsNone(parse_client_header("ios-test"))
        self.assertIsNone(parse_client_header(""))
        self.assertIsNone(parse_client_header(None))

    def test_evaluate(self):
        self.assertEqual(evaluate((1, 0, 0), minimum=(1, 1, 0), latest=(1, 2, 0)), "required")
        self.assertEqual(evaluate((1, 1, 5), minimum=(1, 1, 0), latest=(1, 2, 0)), "available")
        self.assertEqual(evaluate((1, 2, 0), minimum=(1, 1, 0), latest=(1, 2, 0)), "none")
        self.assertEqual(evaluate((9, 9, 9), minimum=None, latest=None), "none")
        # An unreadable build fails OPEN.
        self.assertEqual(evaluate(None, minimum=(9, 0, 0), latest=(9, 0, 0)), "none")


class _PolicyMixin:
    def setUp(self):
        super().setUp()
        cache.clear()

    def set_policy(self, *, minimum="", latest="", url="https://apps.apple.com/app/id1", message=""):
        AppReleasePolicy.objects.update_or_create(
            platform="ios",
            defaults={
                "minimum_version": minimum,
                "latest_version": latest,
                "update_url": url,
                "message": message,
            },
        )
        cache.clear()


class ConfigViewTests(_PolicyMixin, TestCase):
    url = "/api/mobile/config/"

    def test_no_policy_requires_nothing(self):
        res = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.0.0").get(self.url, {"platform": "ios"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["update"], "none")
        self.assertEqual(res.json()["minimum_version"], "")
        self.assertEqual(res["Cache-Control"], "no-store")

    def test_verdict_follows_the_declared_build(self):
        self.set_policy(minimum="1.1.0", latest="1.2.0", message="New maths tools")
        for header, expected in (("ios/1.0.0", "required"), ("ios/1.1.5", "available"), ("ios/1.2.0", "none")):
            res = APIClient(HTTP_X_MASTERSAT_CLIENT=header).get(self.url, {"platform": "ios"})
            self.assertEqual(res.status_code, 200, header)
            body = res.json()
            self.assertEqual(body["update"], expected, header)
            self.assertEqual(body["minimum_version"], "1.1.0")
            self.assertEqual(body["latest_version"], "1.2.0")
            self.assertEqual(body["update_url"], "https://apps.apple.com/app/id1")
            self.assertEqual(body["message"], "New maths tools")

    def test_query_version_is_the_fallback(self):
        self.set_policy(minimum="1.1.0")
        res = APIClient().get(self.url, {"platform": "ios", "version": "1.0.0"})
        self.assertEqual(res.json()["update"], "required")

    def test_a_stale_token_is_not_a_401(self):
        # The app attaches whatever token it holds. Expired or garbage must not 401 here, or
        # the app would refresh, fail, and sign the student out over a config read.
        client = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.0.0", HTTP_AUTHORIZATION="Bearer not-a-token")
        self.assertEqual(client.get(self.url).status_code, 200)

    def test_unknown_platform(self):
        self.assertEqual(APIClient().get(self.url, {"platform": "symbian"}).status_code, 400)


class VersionGateTests(_PolicyMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.student = User.objects.create_user("gate_student@t.com", "secret123", role=C.ROLE_STUDENT)
        self.token = str(RefreshToken.for_user(self.student).access_token)

    def _client(self, header):
        return APIClient(HTTP_X_MASTERSAT_CLIENT=header, HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def test_old_build_is_refused_with_426(self):
        self.set_policy(minimum="1.1.0", latest="1.2.0")
        res = self._client("ios/1.0.0").get("/api/users/me/")
        self.assertEqual(res.status_code, 426)
        body = res.json()
        self.assertEqual(body["code"], "update_required")
        self.assertEqual(body["minimum_version"], "1.1.0")
        self.assertEqual(body["update_url"], "https://apps.apple.com/app/id1")
        self.assertTrue(body["detail"])

    def test_old_build_post_is_told_to_update_not_bad_origin(self):
        self.set_policy(minimum="1.1.0")
        res = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.0.0").post(
            "/api/auth/login/", {"email": "gate_student@t.com", "password": "secret123"}, format="json"
        )
        self.assertEqual(res.status_code, 426)

    def test_current_build_passes(self):
        self.set_policy(minimum="1.1.0")
        self.assertEqual(self._client("ios/1.1.0").get("/api/users/me/").status_code, 200)

    def test_the_mobile_namespace_is_never_refused(self):
        # A refused build must still be able to read the policy and report its crashes.
        self.set_policy(minimum="9.0.0")
        self.assertEqual(self._client("ios/1.0.0").get("/api/mobile/config/").status_code, 200)

    def test_browsers_and_test_clients_are_never_judged(self):
        self.set_policy(minimum="9.0.0")
        browser = APIClient(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(browser.get("/api/users/me/").status_code, 200)
        self.assertEqual(self._client("ios-test").get("/api/users/me/").status_code, 200)

    def test_an_unreadable_version_passes(self):
        self.set_policy(minimum="9.0.0")
        self.assertEqual(self._client("ios/beta").get("/api/users/me/").status_code, 200)

    def test_no_policy_refuses_nobody(self):
        self.assertEqual(self._client("ios/0.1.0").get("/api/users/me/").status_code, 200)

    def test_raising_the_minimum_applies_after_the_cache_is_dropped(self):
        self.assertEqual(self._client("ios/1.0.0").get("/api/users/me/").status_code, 200)
        self.set_policy(minimum="1.1.0")
        self.assertEqual(self._client("ios/1.0.0").get("/api/users/me/").status_code, 426)


def _report(**overrides):
    report = {
        "id": str(uuid.uuid4()),
        "kind": "crash",
        "occurred_at": "2026-09-25T10:00:00Z",
        "app_version": "1.1.0",
        "build": "2",
        "os_version": "iOS 26.3",
        "device_model": "iPhone17,1",
        "signature": "crash · EXC_BAD_ACCESS/SIGSEGV · MasterSAT+123",
        "message": "Namespace SIGNAL, Code 0xb",
        "payload": {"callStackTree": {"callStacks": []}},
    }
    report.update(overrides)
    return report


@mock.patch("classes.alerting.notify_ops_critical")
class DiagnosticsUploadTests(_PolicyMixin, TestCase):
    url = "/api/mobile/diagnostics/"

    def setUp(self):
        super().setUp()
        self.install = str(uuid.uuid4())
        self.client = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.1.0")

    def post(self, reports, *, client=None, install=None):
        body = {"install_id": install or self.install, "platform": "ios", "reports": reports}
        return (client or self.client).post(self.url, body, format="json")

    def test_a_batch_is_stored_and_acknowledged(self, _alert):
        reports = [_report(), _report(kind="hang", signature="hang · hang 4 sec · MasterSAT+77")]
        res = self.post(reports)
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json()["accepted"], [r["id"] for r in reports])
        self.assertEqual(ClientDiagnostic.objects.count(), 2)
        crash = ClientDiagnostic.objects.get(kind="crash")
        self.assertEqual(crash.install_id, self.install)
        self.assertEqual(crash.app_version, "1.1.0")
        self.assertEqual(crash.payload, {"callStackTree": {"callStacks": []}})
        self.assertIsNone(crash.user)

    def test_a_retried_batch_is_acknowledged_and_stored_once(self, _alert):
        reports = [_report()]
        self.post(reports)
        res = self.post(reports)
        self.assertEqual(res.status_code, 202)
        # Listed again, so the phone clears it; stored once.
        self.assertEqual(res.json()["accepted"], [reports[0]["id"]])
        self.assertEqual(ClientDiagnostic.objects.count(), 1)

    def test_invalid_reports_are_skipped_not_fatal(self, _alert):
        good = _report()
        res = self.post([good, _report(kind="nonsense"), _report(signature=""), "not an object"])
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json()["accepted"], [good["id"]])

    def test_oversized_payload_is_dropped_not_the_report(self, _alert):
        big = _report(payload={"blob": "x" * (100 * 1024)})
        self.post([big])
        self.assertIsNone(ClientDiagnostic.objects.get().payload)

    def test_a_future_clock_is_clamped(self, _alert):
        self.post([_report(occurred_at=(timezone.now() + timedelta(days=400)).isoformat())])
        self.assertLessEqual(ClientDiagnostic.objects.get().occurred_at, timezone.now())

    def test_batch_limits(self, _alert):
        self.assertEqual(self.post([_report() for _ in range(11)]).status_code, 400)
        self.assertEqual(self.post([]).status_code, 400)
        self.assertEqual(self.post([_report()], install="short").status_code, 400)

    def test_signed_out_and_stale_tokens_still_upload(self, _alert):
        stale = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.1.0", HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.post([_report()], client=stale).status_code, 202)

    def test_a_valid_token_credits_the_student(self, _alert):
        student = User.objects.create_user("diag_student@t.com", "secret123", role=C.ROLE_STUDENT)
        token = str(RefreshToken.for_user(student).access_token)
        client = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.1.0", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.post([_report()], client=client)
        self.assertEqual(ClientDiagnostic.objects.get().user, student)

    def test_an_old_build_can_still_report(self, _alert):
        self.set_policy(minimum="9.0.0")
        self.assertEqual(self.post([_report()]).status_code, 202)

    def test_the_desk_hears_about_a_new_crash_once(self, alert):
        self.post([_report()])
        self.post([_report()])  # same signature, new report id
        self.assertEqual(alert.call_count, 1)
        self.post([_report(signature="crash · EXC_BREAKPOINT/SIGTRAP · MasterSAT+999")])
        self.assertEqual(alert.call_count, 2)
        # Hangs and errors are counted, not paged.
        self.post([_report(kind="error", signature="decoding /classes/:id/")])
        self.assertEqual(alert.call_count, 2)


@override_settings(ALLOWED_HOSTS=[ADMIN_HOST, "testserver"])
class ConsoleTests(_PolicyMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user("mob_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user("mob_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject="math")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_policy_round_trip_applies_at_once(self):
        res = self.client.put(
            "/api/mobile/admin/policy/",
            {"platform": "ios", "minimum_version": "1.1", "latest_version": "1.2.0", "update_url": "https://apps.apple.com/app/id1"},
            format="json",
            HTTP_HOST=ADMIN_HOST,
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["updated_by"], self.admin.email)
        # No stale minute: the cached policy is dropped on save.
        config = APIClient(HTTP_X_MASTERSAT_CLIENT="ios/1.0.0").get("/api/mobile/config/").json()
        self.assertEqual(config["update"], "required")

    def test_policy_validation(self):
        bad_version = self.client.put(
            "/api/mobile/admin/policy/", {"minimum_version": "one"}, format="json", HTTP_HOST=ADMIN_HOST
        )
        self.assertEqual(bad_version.status_code, 400)
        inverted = self.client.put(
            "/api/mobile/admin/policy/",
            {"minimum_version": "2.0.0", "latest_version": "1.5.0"},
            format="json",
            HTTP_HOST=ADMIN_HOST,
        )
        self.assertEqual(inverted.status_code, 400)
        self.assertIn("minimum_version", inverted.json())

    def test_staff_only(self):
        teacher = APIClient()
        teacher.force_authenticate(self.teacher)
        self.assertEqual(teacher.get("/api/mobile/admin/policy/").status_code, 403)
        self.assertEqual(teacher.get("/api/mobile/admin/diagnostics/").status_code, 403)

    def test_diagnostics_are_grouped_by_signature(self):
        install_a, install_b = str(uuid.uuid4()), str(uuid.uuid4())
        for install in (install_a, install_a, install_b):
            ClientDiagnostic.objects.create(
                install_id=install, report_id=str(uuid.uuid4()), kind="crash", signature="sig-A", app_version="1.1.0"
            )
        ClientDiagnostic.objects.create(
            install_id=install_b, report_id=str(uuid.uuid4()), kind="error", signature="sig-B", app_version="1.1.0",
            payload={"x": 1},
        )
        res = self.client.get("/api/mobile/admin/diagnostics/", HTTP_HOST=ADMIN_HOST)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["totals"]["crash"], 3)
        self.assertEqual(body["totals"]["error"], 1)
        top = body["groups"][0]
        self.assertEqual((top["signature"], top["count"], top["installs"]), ("sig-A", 3, 2))
        self.assertEqual(len(body["recent"]), 4)
        self.assertNotIn("payload", body["recent"][0])

        only_errors = self.client.get("/api/mobile/admin/diagnostics/", {"kind": "error"}, HTTP_HOST=ADMIN_HOST).json()
        self.assertEqual([g["signature"] for g in only_errors["groups"]], ["sig-B"])
        detail = self.client.get(f"/api/mobile/admin/diagnostics/{only_errors['groups'][0]['sample_id']}/", HTTP_HOST=ADMIN_HOST)
        self.assertEqual(detail.json()["payload"], {"x": 1})


class PruneTests(TestCase):
    def test_old_reports_are_pruned(self):
        old = ClientDiagnostic.objects.create(install_id="a" * 12, report_id="b" * 12, kind="crash", signature="s")
        ClientDiagnostic.objects.filter(pk=old.pk).update(received_at=timezone.now() - timedelta(days=91))
        ClientDiagnostic.objects.create(install_id="a" * 12, report_id="c" * 12, kind="crash", signature="s")
        self.assertEqual(prune_diagnostics(), 1)
        self.assertEqual(ClientDiagnostic.objects.count(), 1)
