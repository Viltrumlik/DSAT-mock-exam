import itertools

import requests
from django.core.cache.backends.locmem import LocMemCache
from django.test import SimpleTestCase

from sms.eskiz import ACCEPTED, FAILED, REJECTED, TOKEN_KEY, UNCERTAIN, EskizClient, EskizError

_names = itertools.count()
REQUEST_ID = "59bf10a2-aba8-4694-8fd5-0be20102a580"


def fresh_cache():
    return LocMemCache(f"eskiz-test-{next(_names)}", {})


class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not JSON")
        return self._body


class StubSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def request(self, method, url, data=None, json=None, params=None, headers=None, timeout=None):
        self.requests.append({"method": method, "url": url, "data": dict(data or {}), "headers": dict(headers or {})})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def login_ok(token="jwt-1"):
    return FakeResponse(200, {"message": "token_generated", "data": {"token": token}, "token_type": "bearer"})


def waiting():
    return FakeResponse(200, {"id": REQUEST_ID, "message": "Waiting for SMS provider", "status": "waiting"})


def client(responses, cache=None, *, email="ops@example.uz", secret="key"):
    session = StubSession(responses)
    eskiz = EskizClient(
        base_url="https://eskiz.test/api", email=email, secret=secret, sender="4546",
        session=session, cache=cache or fresh_cache(), sleep=lambda seconds: None,
    )
    return eskiz, session


class SendTests(SimpleTestCase):
    def test_logs_in_then_sends_with_the_token(self):
        eskiz, session = client([login_ok(), waiting()])
        result = eskiz.send("998901234567", "Bu Eskiz dan test", user_sms_id="m1")
        self.assertEqual((result.outcome, result.request_id), (ACCEPTED, REQUEST_ID))
        login, send = session.requests
        self.assertEqual(login["url"], "https://eskiz.test/api/auth/login")
        self.assertEqual(login["data"], {"email": "ops@example.uz", "password": "key"})
        self.assertEqual(send["url"], "https://eskiz.test/api/message/sms/send")
        self.assertEqual(send["headers"]["Authorization"], "Bearer jwt-1")
        self.assertEqual(
            send["data"],
            {"mobile_phone": "998901234567", "message": "Bu Eskiz dan test", "from": "4546", "user_sms_id": "m1"},
        )

    def test_a_cached_token_means_no_login(self):
        # The account is shared with lc-up: every login we skip is one that cannot knock lc-up out.
        cache = fresh_cache()
        cache.set(TOKEN_KEY, "jwt-cached")
        eskiz, session = client([waiting()], cache)
        self.assertEqual(eskiz.send("998901234567", "x").outcome, ACCEPTED)
        self.assertEqual(len(session.requests), 1)
        self.assertEqual(session.requests[0]["headers"]["Authorization"], "Bearer jwt-cached")

    def test_an_expired_token_logs_in_again_and_sends_once(self):
        cache = fresh_cache()
        cache.set(TOKEN_KEY, "jwt-old")
        eskiz, session = client([FakeResponse(401, {"message": "Expired"}), login_ok("jwt-new"), waiting()], cache)
        self.assertEqual(eskiz.send("998901234567", "x").outcome, ACCEPTED)
        self.assertEqual(
            [r["url"].rsplit("/api", 1)[1] for r in session.requests],
            ["/message/sms/send", "/auth/login", "/message/sms/send"],
        )
        self.assertEqual(session.requests[2]["headers"]["Authorization"], "Bearer jwt-new")
        self.assertEqual(cache.get(TOKEN_KEY), "jwt-new")

    def test_the_old_backends_500_token_has_expired_counts_as_expired(self):
        cache = fresh_cache()
        cache.set(TOKEN_KEY, "jwt-old")
        eskiz, _ = client(
            [FakeResponse(500, {"message": "Token has expired", "status_code": 500}), login_ok("jwt-new"), waiting()],
            cache,
        )
        self.assertEqual(eskiz.send("998901234567", "x").outcome, ACCEPTED)

    def test_a_200_that_is_not_waiting_is_a_rejection(self):
        eskiz, _ = client([login_ok(), FakeResponse(200, {"status": "error", "message": "Text is not on moderation"})])
        result = eskiz.send("998901234567", "x")
        self.assertEqual(result.outcome, REJECTED)
        self.assertIn("moderation", result.error)

    def test_a_validation_error_is_a_rejection_that_does_not_quote_the_phone(self):
        body = {"status": "error", "message": {"mobile_phone": ["The mobile phone 998901234567 format is invalid."]}}
        eskiz, _ = client([login_ok(), FakeResponse(422, body)])
        result = eskiz.send("998901234567", "x")
        self.assertEqual(result.outcome, REJECTED)
        self.assertIn("mobile_phone", result.error)
        self.assertNotIn("998901234567", result.error)

    def test_a_read_timeout_is_uncertain_and_never_resent(self):
        eskiz, session = client([login_ok(), requests.ReadTimeout("slow")])
        self.assertEqual(eskiz.send("998901234567", "x").outcome, UNCERTAIN)
        self.assertEqual(len(session.requests), 2)

    def test_a_5xx_is_uncertain(self):
        eskiz, _ = client([login_ok(), FakeResponse(502, None)])
        self.assertEqual(eskiz.send("998901234567", "x").outcome, UNCERTAIN)

    def test_a_connect_timeout_is_a_failure(self):
        eskiz, _ = client([login_ok(), requests.ConnectTimeout("down")])
        self.assertEqual(eskiz.send("998901234567", "x").outcome, FAILED)

    def test_a_refused_login_fails_without_sending(self):
        cache = fresh_cache()
        eskiz, session = client([FakeResponse(401, {"message": "invalid_credentials"})], cache)
        result = eskiz.send("998901234567", "x")
        self.assertEqual(result.outcome, FAILED)
        self.assertIn("invalid_credentials", result.error)
        self.assertEqual(len(session.requests), 1)
        self.assertIsNone(cache.get(TOKEN_KEY))

    def test_a_login_timeout_fails_because_nothing_was_sent(self):
        eskiz, _ = client([requests.ReadTimeout("slow")])
        self.assertEqual(eskiz.send("998901234567", "x").outcome, FAILED)

    def test_unconfigured_fails_without_a_request(self):
        eskiz, session = client([], email="", secret="")
        self.assertEqual(eskiz.send("998901234567", "x").outcome, FAILED)
        self.assertEqual(session.requests, [])


class ReadTests(SimpleTestCase):
    def setUp(self):
        self.cache = fresh_cache()
        self.cache.set(TOKEN_KEY, "jwt-cached")

    def test_status_reads_the_message_status(self):
        body = {"status": "success", "data": {"status": "DELIVERED", "parts_count": 1}}
        eskiz, session = client([FakeResponse(200, body)], self.cache)
        result = eskiz.status(REQUEST_ID)
        self.assertEqual((result.ok, result.status, result.parts), (True, "DELIVERED", 1))
        self.assertTrue(session.requests[0]["url"].endswith(f"/message/sms/status_by_id/{REQUEST_ID}"))

    def test_status_refuses_a_strange_id_before_any_request(self):
        eskiz, session = client([], self.cache)
        self.assertFalse(eskiz.status("../auth/user").ok)
        self.assertEqual(session.requests, [])

    def test_status_of_an_unreachable_eskiz_is_not_ok(self):
        eskiz, _ = client([requests.ConnectionError("down")], self.cache)
        self.assertFalse(eskiz.status(REQUEST_ID).ok)

    def test_templates_come_back_as_eskiz_lists_them(self):
        rows = [{"id": 7, "template": "", "original_text": "Salom %w", "status": "service"}]
        eskiz, _ = client([FakeResponse(200, {"success": True, "result": rows})], self.cache)
        self.assertEqual(eskiz.templates(), rows)

    def test_balance(self):
        eskiz, _ = client([FakeResponse(200, {"data": {"balance": 125000}, "status": "success"})], self.cache)
        self.assertEqual(eskiz.balance(), 125000)

    def test_a_failed_read_raises(self):
        eskiz, _ = client([FakeResponse(404, {"message": "Not found"})], self.cache)
        with self.assertRaises(EskizError):
            eskiz.nicks()
