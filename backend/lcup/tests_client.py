import itertools

import requests
from django.core.cache.backends.locmem import LocMemCache
from django.test import SimpleTestCase, override_settings

from lcup.conf import credentials
from lcup.client import (
    LOCK_KEY,
    SLOT_KEYS,
    TOKEN_KEY,
    LcupAuthError,
    LcupClient,
    LcupError,
    LcupUnavailable,
)

_cache_names = itertools.count()


def fresh_cache():
    return LocMemCache(f"lcup-client-test-{next(_cache_names)}", {})


class FakeResponse:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.headers = headers or {}

    def json(self):
        return self._body


class HtmlResponse(FakeResponse):
    def json(self):
        raise ValueError("not JSON")


class StubSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        self.requests.append(
            {"method": method, "url": url, "params": dict(params or {}), "json": json, "headers": dict(headers or {})}
        )
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def login_ok(token="1|tok"):
    return FakeResponse(200, {"status": True, "data": {"access_token": token, "user": {}}})


def ok(data=None):
    return FakeResponse(200, {"success": True, "data": data if data is not None else {"ok": 1}})


def page(rows, cursor=None):
    return FakeResponse(200, {"success": True, "data": rows, "meta": {"next_cursor": cursor}})


def make(responses, *, cache=None, clock=lambda: 1000.0, sleep=None):
    session = StubSession(responses)
    sleeps = []
    client = LcupClient(
        base_url="https://lcup.test/",
        domain="centre",
        mobile="998900000000",
        password="secret",
        session=session,
        cache=cache or fresh_cache(),
        sleep=sleep or sleeps.append,
        clock=clock,
    )
    return client, session, sleeps


class TokenTests(SimpleTestCase):
    def test_first_get_logs_in_once_and_sends_the_bearer_token(self):
        client, session, _ = make([login_ok("1|a"), ok({"x": 1})])
        self.assertEqual(client.get("/api/external/v1/me")["data"], {"x": 1})
        login, call = session.requests
        self.assertEqual(login["method"], "POST")
        self.assertEqual(login["url"], "https://lcup.test/api/dev/login")
        self.assertEqual(login["json"], {"mobile_number": "998900000000", "password": "secret", "domain": "centre"})
        self.assertNotIn("Authorization", login["headers"])
        self.assertEqual(call["headers"]["Authorization"], "Bearer 1|a")
        self.assertEqual(client.cache.get(TOKEN_KEY), "1|a")

    def test_a_second_client_reuses_the_cached_token(self):
        cache = fresh_cache()
        first, _, _ = make([login_ok("1|a"), ok()], cache=cache)
        first.get("/api/external/v1/me")
        second, session, _ = make([ok()], cache=cache)
        second.get("/api/external/v1/me")
        self.assertEqual([r["method"] for r in session.requests], ["GET"])

    def test_a_401_logs_in_again_once_and_retries(self):
        client, session, _ = make([login_ok("1|a"), FakeResponse(401), login_ok("2|b"), ok()])
        client.get("/api/external/v1/me")
        self.assertEqual([r["method"] for r in session.requests], ["POST", "GET", "POST", "GET"])
        self.assertEqual(session.requests[3]["headers"]["Authorization"], "Bearer 2|b")
        self.assertEqual(client.cache.get(TOKEN_KEY), "2|b")

    def test_a_second_consecutive_401_raises(self):
        client, _, _ = make([login_ok("1|a"), FakeResponse(401), login_ok("2|b"), FakeResponse(401)])
        with self.assertRaises(LcupAuthError):
            client.get("/api/external/v1/me")

    def test_a_refused_login_raises_and_caches_nothing(self):
        client, _, _ = make([FakeResponse(422, {"message": "invalid"})])
        with self.assertRaises(LcupAuthError):
            client.get("/api/external/v1/me")
        self.assertIsNone(client.cache.get(TOKEN_KEY))

    def test_a_refused_login_says_why_without_repeating_any_number(self):
        body = {"message": "The mobile number 998900000000 is invalid.", "errors": {"mobile_number": ["invalid"]}}
        client, _, _ = make([FakeResponse(422, body)])
        with self.assertRaises(LcupAuthError) as caught:
            client.get("/api/external/v1/me")
        text = str(caught.exception)
        self.assertIn("(422)", text)
        self.assertIn("is invalid", text)
        self.assertIn("mobile_number", text)
        self.assertNotIn("998900000000", text)

    def test_a_refused_login_with_no_json_body_still_raises_cleanly(self):
        client, _, _ = make([HtmlResponse(500)])
        with self.assertRaisesMessage(LcupAuthError, "lc-up refused the login (500)"):
            client.get("/api/external/v1/me")

    def test_waits_for_another_process_that_holds_the_login_lock(self):
        cache = fresh_cache()
        cache.add(LOCK_KEY, "1", timeout=30)
        client, session, _ = make([ok()], cache=cache, sleep=lambda _s: cache.set(TOKEN_KEY, "9|z"))
        client.get("/api/external/v1/me")
        self.assertEqual([r["method"] for r in session.requests], ["GET"])
        self.assertEqual(session.requests[0]["headers"]["Authorization"], "Bearer 9|z")


class RetryTests(SimpleTestCase):
    def test_429_honours_retry_after(self):
        client, _, sleeps = make([login_ok(), FakeResponse(429, headers={"Retry-After": "2"}), ok()])
        client.get("/api/external/v1/me")
        self.assertIn(2, sleeps)

    def test_four_503s_raise_unavailable(self):
        client, _, _ = make([login_ok()] + [FakeResponse(503, headers={"Retry-After": "1"})] * 4)
        with self.assertRaises(LcupUnavailable):
            client.get("/api/external/v1/me")

    def test_network_error_is_unavailable(self):
        client, _, _ = make([login_ok(), requests.ConnectionError("down")])
        with self.assertRaises(LcupUnavailable):
            client.get("/api/external/v1/me")

    def test_slots_are_released(self):
        client, _, _ = make([login_ok(), ok()])
        client.get("/api/external/v1/me")
        for key in SLOT_KEYS:
            self.assertIsNone(client.cache.get(key))


class PagingTests(SimpleTestCase):
    def test_follows_cursors_through_an_empty_middle_page(self):
        client, session, _ = make([login_ok(), page([{"id": 1}], "c1"), page([], "c2"), page([{"id": 2}])])
        self.assertEqual(client.fetch_all("/api/external/v1/students"), [{"id": 1}, {"id": 2}])
        self.assertEqual(session.requests[1]["params"], {"per_page": 200})
        self.assertEqual(session.requests[2]["params"], {"per_page": 200, "cursor": "c1"})
        self.assertEqual(session.requests[3]["params"], {"per_page": 200, "cursor": "c2"})

    def test_a_failing_page_raises_instead_of_returning_a_partial_list(self):
        client, _, _ = make([login_ok(), page([{"id": 1}], "c1"), FakeResponse(400)])
        with self.assertRaises(LcupError):
            client.fetch_all("/api/external/v1/students")


class SafetyTests(SimpleTestCase):
    def test_the_client_cannot_post_anything_but_the_login(self):
        self.assertFalse(hasattr(LcupClient, "post"))

    def test_paces_itself_below_the_per_minute_limit(self):
        cache = fresh_cache()
        cache.set("lcup:rpm:16", 55, timeout=120)  # clock 1000 s → minute 16, already at the cap
        client, _, sleeps = make([login_ok(), ok()], cache=cache)
        client.get("/api/external/v1/me")
        self.assertAlmostEqual(sleeps[0], 17 * 60 - 1000 + 0.05, places=2)


class CredentialsTests(SimpleTestCase):
    @override_settings(
        LCUP_BASE_URL="https://lcup.test/", LCUP_DOMAIN=" centre ", LCUP_MOBILE="+998 90 123-45-67", LCUP_PASSWORD=" p w "
    )
    def test_the_phone_goes_to_lcup_as_digits_only(self):
        # lc-up's login answers 422 to "+998…"; people write phones every which way.
        self.assertEqual(
            credentials(),
            {"base_url": "https://lcup.test", "domain": "centre", "mobile": "998901234567", "password": " p w "},
        )
