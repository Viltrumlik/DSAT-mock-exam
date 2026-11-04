import itertools

import requests
from django.core.cache.backends.base import DEFAULT_TIMEOUT
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


def make(responses, *, cache=None, sleep=None):
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
        self.assertGreaterEqual(max(sleeps), 2)

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


class FakeClock:
    """Time that moves only when something waits or a request takes its time."""

    def __init__(self, now):
        self.now = now
        self.waits = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds


class ClockedCache(LocMemCache):
    """LocMemCache whose timeouts run on the fake clock."""

    def __init__(self, clock):
        super().__init__(f"lcup-client-test-{next(_cache_names)}", {"OPTIONS": {"MAX_ENTRIES": 100_000}})
        self.clock = clock

    def get_backend_timeout(self, timeout=DEFAULT_TIMEOUT):
        return None if timeout is None else self.clock() + timeout

    def _has_expired(self, key):
        expires = self._expire_info.get(key, -1)
        return expires is not None and expires <= self.clock()


class WindowedLcup:
    """lc-up's per-minute limit, as the model that best fits the four archive passes of 2026-11-04: its
    minute starts at our first request after the last one ended, and ``Retry-After`` is two whole-second
    clocks subtracted, so it can fall a fraction short. Inferred: no run has recorded lc-up's headers."""

    def __init__(self, clock, *, seconds_each=0.15):
        self.clock = clock
        self.seconds_each = seconds_each
        self.started = None
        self.used = 0
        self.refused = 0
        self.accepted_at = []

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        now = self.clock()
        if self.started is None or now >= self.started + 60:
            self.started, self.used = now, 0
        if self.used >= 60:
            self.refused += 1
            self.clock.now += 0.06
            return FakeResponse(429, headers={"Retry-After": str(int(self.started) + 60 - int(now))})
        self.used += 1
        self.accepted_at.append(now)
        self.clock.now += self.seconds_each
        return ok()


def against(lcup, clock, cache=None):
    client = LcupClient(
        base_url="https://lcup.test", domain="centre", mobile="998900000000", password="secret",
        session=lcup, cache=cache or ClockedCache(clock), sleep=clock.sleep,
    )
    client.cache.set(TOKEN_KEY, "1|tok", timeout=None)
    return client


def busiest_minute(moments):
    """The most requests in any 60 seconds, wherever those 60 seconds start."""
    return max(sum(start <= m < start + 60 for m in moments) for start in moments)


#: Seconds past a clock minute: on it, nearly on it, and the seconds prod's four passes began at.
START_SECONDS = (0.0, 1.635, 3.119, 17.494, 33.357, 59.9)


class MinuteLimitTests(SimpleTestCase):
    def test_a_pass_never_meets_lcups_minute_wherever_it_starts(self):
        for second in START_SECONDS:
            for seconds_each in (0.15, 0.5, 1.0):
                with self.subTest(second=second, seconds_each=seconds_each):
                    clock = FakeClock(1_000_020 * 60 + second)
                    lcup = WindowedLcup(clock, seconds_each=seconds_each)
                    client = against(lcup, clock)
                    for n in range(320):
                        client.get(f"/api/external/v1/students/{n}")
                    self.assertEqual(lcup.refused, 0)

    def test_no_sixty_seconds_reach_lcups_limit_even_if_its_window_slides(self):
        for second in START_SECONDS:
            with self.subTest(second=second):
                clock = FakeClock(1_000_020 * 60 + second)
                lcup = WindowedLcup(clock)
                client = against(lcup, clock)
                for n in range(240):
                    client.get(f"/api/external/v1/students/{n}")
                self.assertLess(busiest_minute(lcup.accepted_at), 60)

    def test_two_processes_share_one_allowance(self):
        clock = FakeClock(1_000_020 * 60 + 33.357)
        lcup = WindowedLcup(clock)
        cache = ClockedCache(clock)
        archive, sync = against(lcup, clock, cache), against(lcup, clock, cache)
        for n in range(240):
            (archive if n % 3 else sync).get(f"/api/external/v1/students/{n}")
        self.assertEqual(lcup.refused, 0)
        self.assertLess(busiest_minute(lcup.accepted_at), 60)

    def test_a_sync_alone_is_not_held_back(self):
        # The pushes come last in a sync, after its ~35 reads: pacing that spaced every request out
        # would send each of them half a minute later, every 15 minutes, for nothing.
        clock = FakeClock(1_000_020 * 60 + 33.357)
        client = against(WindowedLcup(clock), clock)
        for n in range(50):
            client.get(f"/api/external/v1/groups/{n}/students")
        self.assertEqual(clock.waits, [])


class RateLimitRetryTests(SimpleTestCase):
    @staticmethod
    def refusing(clock, until, retry_after):
        """lc-up saying 429 until a moment; ``retry_after(now)`` is the header, None for no header."""

        class Refusing:
            attempts = 0

            def request(self, method, url, params=None, json=None, headers=None, timeout=None):
                self.attempts += 1
                now = clock()
                clock.now += 0.06
                if now >= until:
                    return ok()
                told = retry_after(now)
                return FakeResponse(429, headers={} if told is None else {"Retry-After": str(told)})

        return Refusing()

    def test_a_whole_second_retry_after_falling_short_is_not_the_end(self):
        # The window ends at 1060.9. Asked at 1050.1, lc-up says 10: waiting exactly that lands at 1060.1,
        # where it says 0, and three immediate retries are gone in a fifth of a second.
        clock = FakeClock(1050.1)
        lcup = self.refusing(clock, 1060.9, lambda now: 1060 - int(now))
        self.assertEqual(against(lcup, clock).get("/api/external/v1/attendance")["data"], {"ok": 1})
        self.assertEqual(lcup.attempts, 2)

    def test_a_429_with_no_retry_after_waits_out_the_minute(self):
        clock = FakeClock(1000.0)
        lcup = self.refusing(clock, 1050.0, lambda now: None)
        self.assertEqual(against(lcup, clock).get("/api/external/v1/attendance")["data"], {"ok": 1})

    def test_a_retry_after_that_keeps_being_wrong_still_outlasts_the_minute(self):
        clock = FakeClock(1000.0)
        lcup = self.refusing(clock, 1059.0, lambda now: 1)
        self.assertEqual(against(lcup, clock).get("/api/external/v1/attendance")["data"], {"ok": 1})

    def test_a_negative_retry_after_never_reaches_sleep(self):
        clock = FakeClock(1000.0)
        lcup = self.refusing(clock, 1000.1, lambda now: -5)
        against(lcup, clock).get("/api/external/v1/attendance")
        self.assertGreaterEqual(min(clock.waits), 0)

    def test_giving_up_says_what_lcup_said(self):
        clock = FakeClock(1000.0)
        refused = FakeResponse(429, headers={"Retry-After": "0", "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "0"})

        class AlwaysRefused:
            def request(self, *args, **kwargs):
                return refused

        with self.assertRaises(LcupUnavailable) as caught:
            against(AlwaysRefused(), clock).get("/api/external/v1/attendance")
        text = str(caught.exception)
        self.assertIn("answered 429 on /api/external/v1/attendance", text)
        self.assertIn("Retry-After 0", text)
        self.assertIn("X-RateLimit-Remaining 0", text)

    def test_each_refusal_is_logged_with_lcups_numbers(self):
        clock = FakeClock(1000.0)
        lcup = self.refusing(clock, 1000.1, lambda now: 3)
        with self.assertLogs("lcup.client", level="WARNING") as logs:
            against(lcup, clock).get("/api/external/v1/attendance")
        self.assertIn("429", logs.output[0])
        self.assertIn("Retry-After 3", logs.output[0])

    def test_other_refusals_keep_their_short_backoff(self):
        client, _, sleeps = make([login_ok(), FakeResponse(503), FakeResponse(503), ok()])
        client.get("/api/external/v1/me")
        self.assertEqual(sleeps, [1, 2])


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
