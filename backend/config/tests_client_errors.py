"""The crash screen's report: one log line per crash a student saw, from any console."""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from access import constants as C
from users.auth_cookies import ACCESS_COOKIE

URL = "/api/health/client-error/"
CRASH = {
    "kind": "crash",
    "url": "https://mastersat.uz/leaderboard",
    "name": "TypeError",
    "message": "Cannot read properties of undefined (reading 'xp')",
    "stack": "TypeError: ...\n    at LeaderboardPage",
}


CONSOLES = ("admin.mastersat.uz", "questions.mastersat.uz", "teacher.mastersat.uz")


@override_settings(ALLOWED_HOSTS=[*CONSOLES, "testserver"])
class ClientErrorReportTests(TestCase):
    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def post(self, body, *, client=None, **headers):
        return (client or APIClient()).post(URL, body, format="json", **headers)

    def logged(self, **kwargs):
        with self.assertLogs("frontend.client_error", level="WARNING") as logs:
            res = self.post(CRASH, **kwargs)
        self.assertEqual(res.status_code, 204, res.content)
        line = logs.output[0]
        return json.loads(line[line.index("client_error ") + len("client_error "):])

    def test_logs_the_crash_with_the_browser(self):
        report = self.logged(HTTP_USER_AGENT="Telegram-Android/11.2.3")
        self.assertEqual(report["url"], CRASH["url"])
        self.assertEqual(report["message"], CRASH["message"])
        self.assertEqual(report["user_agent"], "Telegram-Android/11.2.3")
        self.assertIsNone(report["user_id"])

    def test_names_the_signed_in_student(self):
        student = get_user_model().objects.create_user(
            username="stu", email="stu@example.com", password="x", role=C.ROLE_STUDENT
        )
        client = APIClient(enforce_csrf_checks=True)
        client.cookies[ACCESS_COOKIE] = str(AccessToken.for_user(student))
        # The cookie makes the CSRF middleware look; a same-site Origin is all it asks here.
        report = self.logged(client=client, HTTP_ORIGIN="https://testserver")
        self.assertEqual(report["user_id"], student.pk)

    def test_a_stale_cookie_does_not_lose_the_report(self):
        client = APIClient(enforce_csrf_checks=True)
        client.cookies[ACCESS_COOKIE] = "stale"
        report = self.logged(client=client, HTTP_ORIGIN="https://testserver")
        self.assertIsNone(report["user_id"])

    def test_a_foreign_origin_with_a_cookie_is_refused(self):
        client = APIClient(enforce_csrf_checks=True)
        client.cookies[ACCESS_COOKIE] = "anything"
        res = self.post(CRASH, client=client, HTTP_ORIGIN="https://evil.example")
        self.assertEqual(res.status_code, 403)

    def test_fields_are_capped_and_unknown_ones_dropped(self):
        with self.assertLogs("frontend.client_error", level="WARNING") as logs:
            res = self.post({**CRASH, "message": "x" * 5000, "password": "secret"})
        self.assertEqual(res.status_code, 204)
        self.assertNotIn("secret", logs.output[0])
        self.assertIn("x" * 1000 + '"', logs.output[0])
        self.assertNotIn("x" * 1001, logs.output[0])

    def test_open_on_every_console(self):
        for host in CONSOLES:
            with self.subTest(host=host), self.assertLogs("frontend.client_error", level="WARNING"):
                res = self.post(CRASH, HTTP_HOST=host)
                self.assertEqual(res.status_code, 204, res.content)

    def test_rate_limited_per_ip(self):
        with self.assertLogs("frontend.client_error", level="WARNING"):
            codes = [self.post(CRASH).status_code for _ in range(31)]
        self.assertEqual(codes[:30], [204] * 30)
        self.assertEqual(codes[30], 429)
