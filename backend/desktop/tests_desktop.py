"""The Windows app's server half: the proof arithmetic, the midterm rule, sign-in, exemptions."""

from __future__ import annotations

import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C
from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt
from midterms.state_machine import STATE_COMPLETED
from mobile.models import AppReleasePolicy
from mobile.versioning import PLATFORM_WINDOWS
from users.auth_cookies import ACCESS_COOKIE, REFRESH_COOKIE

from .models import DesktopAuthCode, DesktopExemption, MidtermLockdown
from .proof import parse_keys, pkce_challenge, sign, verify

User = get_user_model()

KEY_ID = "test1"
KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
KEYS = {KEY_ID: KEY_HEX}
PRECHECK = json.dumps({"displays": 1, "remote": False, "vm": False, "closed": []})


class ProofVectorTests(SimpleTestCase):
    """Fixed vectors the Rust half (desktop/src-tauri/src/proof.rs) is tested against too."""

    def test_hmac_vector(self):
        # Cross-checked with: printf 'mastersat-lockdown-v1\n42\nnonce-abc\n0.1.0\n{"displays":1}'
        #   | openssl dgst -sha256 -mac HMAC -macopt hexkey:<KEY_HEX>
        mac = sign(secret_hex=KEY_HEX, attempt_id=42, nonce="nonce-abc", app_version="0.1.0", precheck='{"displays":1}')
        self.assertEqual(mac, "52b830843519923e56ce8086c59a9c20fe78e41d659bcb2d7bcf6dbd6a3ce18c")

    def test_pkce_rfc7636_vector(self):
        self.assertEqual(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        )

    def test_verify_refuses_any_changed_field(self):
        base = dict(attempt_id=42, nonce="n", app_version="0.1.0", precheck="{}")
        mac = sign(secret_hex=KEY_HEX, **base)
        self.assertTrue(verify(keys=KEYS, key_id=KEY_ID, mac=mac, **base))
        self.assertTrue(verify(keys=KEYS, key_id=KEY_ID, mac=mac.upper(), **base))
        for field, value in (("attempt_id", 43), ("nonce", "m"), ("app_version", "0.1.1"), ("precheck", '{"vm":true}')):
            self.assertFalse(verify(keys=KEYS, key_id=KEY_ID, mac=mac, **{**base, field: value}), field)
        self.assertFalse(verify(keys=KEYS, key_id="other", mac=mac, **base))
        self.assertFalse(verify(keys={KEY_ID: "not-hex"}, key_id=KEY_ID, mac=mac, **base))

    def test_parse_keys(self):
        self.assertEqual(parse_keys("a:00ff, b:AA11"), {"a": "00ff", "b": "aa11"})
        self.assertEqual(parse_keys("broken,c:zz,:00,d:"), {})
        self.assertEqual(parse_keys(None), {})


def _make_midterm_attempt(student) -> MidtermAttempt:
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=60)
    for i in range(3):
        Question.objects.create(
            module=module, question_type="MATH", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", score=10, order=i,
        )
    midterm = Midterm.objects.create(
        title="MT", subject=Midterm.MATH, scoring_scale="SCALE_100",
        duration_minutes=60, question_module=module, is_published=True,
    )
    ResourceAccessGrant.objects.create(
        user=student, resource_type=RT_MIDTERM_V2, resource_id=midterm.id,
        scope=ResourceAccessGrant.SCOPE_RESOURCE, status=ResourceAccessGrant.STATUS_ACTIVE,
    )
    return MidtermAttempt.objects.create(midterm=midterm, student=student)


@override_settings(MIDTERM_DESKTOP_REQUIRED=True, DESKTOP_PROOF_KEYS=KEYS)
class LockdownRuleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.student = User.objects.create_user(
            username="stu", email="stu@example.com", password="x", role="student"
        )
        self.attempt = _make_midterm_attempt(self.student)
        self.client = APIClient()
        self.client.force_authenticate(self.student)
        self.base = f"/api/midterms/attempts/{self.attempt.pk}"

    # ── helpers ──────────────────────────────────────────────────────────────
    def _challenge(self) -> str:
        res = self.client.post(f"{self.base}/desktop_challenge/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data["nonce"]

    def _proof(self, nonce, *, version="0.1.0", precheck=PRECHECK, key_id=KEY_ID, attempt_id=None):
        mac = sign(
            secret_hex=KEY_HEX, attempt_id=attempt_id or self.attempt.pk, nonce=nonce,
            app_version=version, precheck=precheck,
        )
        return {"nonce": nonce, "key_id": key_id, "mac": mac, "app_version": version, "precheck": precheck}

    def _session(self, **kwargs):
        return self.client.post(f"{self.base}/desktop_session/", self._proof(self._challenge(), **kwargs), format="json")

    def _token(self) -> str:
        res = self._session()
        self.assertEqual(res.status_code, 200, res.content)
        return res.data["lockdown_session"]

    def _with(self, token):
        return {"HTTP_X_LOCKDOWN_SESSION": token}

    def _start(self, **headers):
        return self.client.post(f"{self.base}/start/", {}, format="json", **headers)

    # ── the browser ──────────────────────────────────────────────────────────
    def test_browser_sees_the_paper_belongs_to_the_app_before_start(self):
        res = self.client.get(f"{self.base}/status/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["desktop_required"])

    def test_browser_cannot_start(self):
        res = self._start()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["reason"], "desktop_required")
        self.attempt.refresh_from_db()
        self.assertEqual(self.attempt.current_state, MidtermAttempt.STATE_NOT_STARTED)

    # ── the app ──────────────────────────────────────────────────────────────
    def test_app_starts_and_every_running_endpoint_needs_its_token(self):
        token = self._token()
        self.assertEqual(self._start(**self._with(token)).status_code, 200)
        self.assertEqual(self.client.get(f"{self.base}/status/", **self._with(token)).status_code, 200)
        self.assertEqual(self.client.get(f"{self.base}/", **self._with(token)).status_code, 200)

        # The same student, a second device, no token: nothing about the running paper.
        for method, path in (
            ("get", "/status/"), ("get", "/"), ("post", "/save_attempt/"),
            ("post", "/submit_module/"), ("post", "/offscreen/"),
        ):
            if method == "post":
                res = self.client.post(f"{self.base}{path}", {}, format="json")
            else:
                res = self.client.get(f"{self.base}{path}")
            self.assertEqual(res.status_code, 403, path)
            self.assertEqual(res.data["reason"], "desktop_required", path)
            self.assertNotIn("questions", json.dumps(res.data), path)

        # The app's own writes go through.
        res = self.client.post(f"{self.base}/save_attempt/", {"answers": {}}, format="json", **self._with(token))
        self.assertEqual(res.status_code, 200)
        res = self.client.post(f"{self.base}/offscreen/", {}, format="json", **self._with(token))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["violations"], 1)

    def test_reopening_the_app_replaces_the_old_token(self):
        old = self._token()
        self._start(**self._with(old))
        new = self._token()
        res = self.client.get(f"{self.base}/status/", **self._with(old))
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["reason"], "desktop_session_replaced")
        self.assertEqual(self.client.get(f"{self.base}/status/", **self._with(new)).status_code, 200)
        self.assertEqual(MidtermLockdown.objects.get(attempt=self.attempt).sessions_opened, 2)

    def test_lockdown_records_the_precheck_and_build(self):
        self._token()
        row = MidtermLockdown.objects.get(attempt=self.attempt)
        self.assertTrue(row.required)
        self.assertEqual(row.app_version, "0.1.0")
        self.assertEqual(row.precheck["displays"], 1)

    # ── the proof ────────────────────────────────────────────────────────────
    def test_a_nonce_is_spent_by_its_first_use(self):
        proof = self._proof(self._challenge())
        self.assertEqual(self.client.post(f"{self.base}/desktop_session/", proof, format="json").status_code, 200)
        res = self.client.post(f"{self.base}/desktop_session/", proof, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["reason"], "desktop_challenge_invalid")

    def test_a_wrong_proof_also_spends_the_nonce(self):
        nonce = self._challenge()
        bad = {**self._proof(nonce), "mac": "0" * 64}
        res = self.client.post(f"{self.base}/desktop_session/", bad, format="json")
        self.assertEqual(res.data["reason"], "desktop_proof_invalid")
        res = self.client.post(f"{self.base}/desktop_session/", self._proof(nonce), format="json")
        self.assertEqual(res.data["reason"], "desktop_challenge_invalid")

    def test_an_expired_nonce_is_refused(self):
        nonce = self._challenge()
        MidtermLockdown.objects.filter(attempt=self.attempt).update(
            nonce_expires_at=timezone.now() - timedelta(seconds=1)
        )
        res = self.client.post(f"{self.base}/desktop_session/", self._proof(nonce), format="json")
        self.assertEqual(res.data["reason"], "desktop_challenge_invalid")

    def test_proof_for_another_sitting_is_refused(self):
        res = self.client.post(
            f"{self.base}/desktop_session/", self._proof(self._challenge(), attempt_id=self.attempt.pk + 1), format="json"
        )
        self.assertEqual(res.data["reason"], "desktop_proof_invalid")

    def test_unknown_key_and_unreadable_precheck_are_refused(self):
        self.assertEqual(self._session(key_id="retired").data["reason"], "desktop_proof_invalid")
        self.assertEqual(self._session(precheck="not json").data["reason"], "desktop_proof_invalid")

    def test_a_build_below_the_windows_minimum_is_told_to_update(self):
        AppReleasePolicy.objects.create(platform=PLATFORM_WINDOWS, minimum_version="0.2.0", latest_version="0.2.0")
        cache.clear()
        res = self._session(version="0.1.0")
        self.assertEqual(res.status_code, 426)
        self.assertEqual(res.data["reason"], "desktop_update_required")
        self.assertEqual(self._session(version="0.2.0").status_code, 200)

    def test_cannot_challenge_another_students_sitting(self):
        other = User.objects.create_user(username="o", email="o@example.com", password="x", role="student")
        client = APIClient()
        client.force_authenticate(other)
        self.assertEqual(client.post(f"{self.base}/desktop_challenge/", {}, format="json").status_code, 404)

    # ── who is outside the rule ──────────────────────────────────────────────
    def test_an_exempt_student_uses_the_browser(self):
        DesktopExemption.objects.create(student=self.student, reason="MacBook")
        self.assertFalse(self.client.get(f"{self.base}/status/").data["desktop_required"])
        self.assertEqual(self._start().status_code, 200)

    def test_an_exemption_granted_mid_paper_rescues_the_sitting(self):
        token = self._token()
        self._start(**self._with(token))
        self.assertEqual(self.client.get(f"{self.base}/status/").status_code, 403)
        DesktopExemption.objects.create(student=self.student, reason="laptop died")
        self.assertEqual(self.client.get(f"{self.base}/status/").status_code, 200)

    def test_turning_the_flag_off_releases_every_sitting(self):
        token = self._token()
        self._start(**self._with(token))
        with self.settings(MIDTERM_DESKTOP_REQUIRED=False):
            self.assertEqual(self.client.get(f"{self.base}/status/").status_code, 200)

    def test_a_sitting_started_before_the_flag_is_left_alone(self):
        with self.settings(MIDTERM_DESKTOP_REQUIRED=False):
            self.assertEqual(self._start().status_code, 200)
        res = self.client.get(f"{self.base}/status/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["desktop_required"])

    def test_a_finished_paper_loads_anywhere(self):
        token = self._token()
        self._start(**self._with(token))
        MidtermAttempt.objects.filter(pk=self.attempt.pk).update(current_state=STATE_COMPLETED)
        self.assertEqual(self.client.get(f"{self.base}/status/").status_code, 200)

    def test_flag_off_the_app_still_works_and_binds_nothing(self):
        with self.settings(MIDTERM_DESKTOP_REQUIRED=False):
            res = self._session()
            self.assertEqual(res.status_code, 200)
            self.assertFalse(res.data["required"])
            self.assertEqual(self._start().status_code, 200)


class SignInWithBrowserTests(TestCase):
    VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

    def setUp(self):
        cache.clear()
        self.student = User.objects.create_user(
            username="stu", email="stu@example.com", password="x", role="student"
        )

    def _code(self) -> str:
        client = APIClient()
        client.force_authenticate(self.student)
        res = client.post("/api/desktop/auth/code/", {"challenge": pkce_challenge(self.VERIFIER)}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data["code"]

    def _exchange(self, code, verifier=None):
        return APIClient().post(
            "/api/desktop/auth/exchange/", {"code": code, "verifier": verifier or self.VERIFIER}, format="json"
        )

    def test_a_code_needs_a_signed_in_browser(self):
        res = APIClient().post("/api/desktop/auth/code/", {"challenge": pkce_challenge(self.VERIFIER)}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_a_malformed_challenge_is_refused(self):
        client = APIClient()
        client.force_authenticate(self.student)
        self.assertEqual(client.post("/api/desktop/auth/code/", {"challenge": "short"}, format="json").status_code, 400)

    def test_exchange_signs_the_app_in_with_the_sites_cookies(self):
        res = self._exchange(self._code())
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn(ACCESS_COOKIE, res.cookies)
        self.assertIn(REFRESH_COOKIE, res.cookies)
        self.assertNotIn("access", res.data)

    def test_a_code_works_once(self):
        code = self._code()
        self.assertEqual(self._exchange(code).status_code, 200)
        self.assertEqual(self._exchange(code).status_code, 400)

    def test_the_wrong_verifier_gets_nothing_and_burns_the_code(self):
        code = self._code()
        res = self._exchange(code, verifier="x" * 43)
        self.assertEqual(res.status_code, 400)
        self.assertNotIn(ACCESS_COOKIE, res.cookies)
        self.assertEqual(self._exchange(code).status_code, 400)

    def test_an_expired_code_is_refused(self):
        code = self._code()
        DesktopAuthCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self._exchange(code).status_code, 400)

    def test_a_deactivated_account_gets_nothing(self):
        code = self._code()
        User.objects.filter(pk=self.student.pk).update(is_active=False)
        self.assertEqual(self._exchange(code).status_code, 400)


TEACHER_HOST = "teacher.mastersat.uz"


@override_settings(ALLOWED_HOSTS=[TEACHER_HOST, "testserver"])
class ExemptionApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username="t", email="t@example.com", password="x", role=C.ROLE_TEACHER, subject="math"
        )
        self.student = User.objects.create_user(
            username="s", email="s@example.com", password="x", role="student"
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def test_a_student_cannot_manage_exemptions(self):
        client = APIClient()
        client.force_authenticate(self.student)
        self.assertEqual(client.get("/api/desktop/exemptions/").status_code, 403)

    def test_grant_list_revoke_regrant(self):
        res = self.client.post("/api/desktop/exemptions/", {"student_id": self.student.pk, "reason": "MacBook"}, format="json")
        self.assertEqual(res.status_code, 201)
        first_id = res.data["id"]
        again = self.client.post("/api/desktop/exemptions/", {"student_id": self.student.pk}, format="json")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data["id"], first_id)

        listed = self.client.get("/api/desktop/exemptions/").data["results"]
        self.assertEqual([r["student"]["id"] for r in listed], [self.student.pk])
        self.assertEqual(listed[0]["reason"], "MacBook")

        self.assertEqual(self.client.post(f"/api/desktop/exemptions/{first_id}/revoke/").status_code, 200)
        self.assertEqual(self.client.get("/api/desktop/exemptions/").data["results"], [])
        row = DesktopExemption.objects.get(pk=first_id)
        self.assertEqual(row.revoked_by, self.teacher)

        regrant = self.client.post("/api/desktop/exemptions/", {"student_id": self.student.pk}, format="json")
        self.assertEqual(regrant.status_code, 201)
        self.assertNotEqual(regrant.data["id"], first_id)

    def test_only_students_can_be_exempted(self):
        res = self.client.post("/api/desktop/exemptions/", {"student_id": self.teacher.pk}, format="json")
        self.assertEqual(res.status_code, 404)

    def _portal_client(self) -> APIClient:
        # The host guard reads the user from the JWT cookie in middleware, before DRF — so
        # force_authenticate is invisible to it. Sign in the way the portal does.
        client = APIClient()
        client.cookies[ACCESS_COOKIE] = str(RefreshToken.for_user(self.teacher).access_token)
        return client

    def test_reachable_from_the_teacher_portal(self):
        res = self._portal_client().get("/api/desktop/exemptions/", HTTP_HOST=TEACHER_HOST)
        self.assertEqual(res.status_code, 200, res.content)

    def test_sign_in_endpoints_are_not_on_the_teacher_portal(self):
        res = self._portal_client().get("/api/desktop/auth/code/", HTTP_HOST=TEACHER_HOST)
        self.assertEqual(res.status_code, 403)
        self.assertIn("not available on the teacher portal", res.json()["detail"])
