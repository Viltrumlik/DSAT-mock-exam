# eskiz.uz SMS — Debt Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On days 1–5 of every month at 10:00, send one SMS through eskiz.uz to each centre student whom the debt freeze will take on the 6th, to the phone lc-up holds for them.

**Architecture:** a new `backend/sms` app with three parts:
- an eskiz client that never raises and shares one token through the cache, the way `lcup/client.py` does;
- an `SmsMessage` log, whose unique (kind, day, key) row is the claim that stops a second SMS;
- the eskiz-approved template text.

`sms/debt_warnings.py` picks the recipients with the freeze's own rule, `lcup.finance.freezable`, extracted from `freeze_plan`. A Celery beat entry fires every day at 10:00 and the code decides whether it is a warning day. A second, hourly entry polls eskiz for delivery status. There is no HTTP endpoint and no UI.

**Tech Stack:** Django 6 / DRF, Celery beat (CELERY_TIMEZONE = Asia/Tashkent), `requests`, Redis cache in prod (LocMem locally and in tests).

**Spec:** there is none (the owner's rule: "spec = code"). The design was approved in chat on 2026-10-18 and is recorded in memory `eskiz-sms-integration.md`. The eskiz API reference is `eskiz-sms/eskiz-api-reference.md`, untracked in the primary checkout.

## Global Constraints

- The owner's words: *"oyning boshidan 5-chisigacha ogohlantirilsin 6-kun shunchaki muzlatilsin sms jo'natish shart emas 6-kuni. lekin 5kun yuborish kerak"*. So warnings go out on days 1..(LCUP_DEBT_FREEZE_DAY − 1). Nothing goes out on the freeze day or after.
- Send time is **10:00 Asia/Tashkent**.
- The recipient is the **lc-up phone** (`LcupStudentLink.phone`, already `998XXXXXXXXX`).
- **Already-frozen students get no warning**, for any freeze reason (the owner's choice).
- At most **one SMS per student per day**. When the template names nobody, at most one per phone per day.
- Nobody gets an SMS when:
  - `LCUP_DEBT_FREEZE_ENABLED` is off;
  - the student's `balance_seen_at` is older than 24 h;
  - no approved template is set;
  - more than 150 warnings would go out in one run.
- **The eskiz account is SHARED with lc-up.** Log in only when no token is cached or eskiz refused ours. The token is kept for 25 days.
- **Never resend after a request may have reached eskiz** (read timeout or 5xx). Such a send is recorded as UNCERTAIN.
- HTTP 200 counts as accepted ONLY when the body has `status == "waiting"` and an `id`.
- Settings:
  - `ESKIZ_BASE_URL` (default `https://notify.eskiz.uz/api`)
  - `ESKIZ_EMAIL`
  - `ESKIZ_SECRET_KEY`
  - `ESKIZ_FROM` (default `4546`)
  - `SMS_DEBT_WARNINGS_ENABLED` (literal "true", default off)
- No phone number reaches a log or an error string in full. Any run of 5+ digits is masked, and phones in reports print as `99890***4567`.
- Git author is `Viltrumlik <viltrumlik@gmail.com>`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test command (from `backend/`): `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 /Users/macbook/.pyenv/versions/3.12.2/bin/python3 manage.py test <label> --settings=config.settings_test_nomigrations -v 1`. Only a literal `OK` line counts as green.

## File Structure

| File | Responsibility |
|---|---|
| `backend/sms/__init__.py` | empty |
| `backend/sms/apps.py` | `SmsConfig` |
| `backend/sms/conf.py` | the only reader of `settings.ESKIZ_*` / `SMS_*` |
| `backend/sms/eskiz.py` | `EskizClient` (login/token, `send`, `status`, `templates`, `nicks`, `balance`) and `default_client()` |
| `backend/sms/templates.py` | `SmsTemplate`, `render`, `is_gsm_safe`, `DEBT_WARNING`, `SAMPLE_VALUES` |
| `backend/sms/models.py` | `SmsMessage` |
| `backend/sms/migrations/0001_initial.py` | generated |
| `backend/sms/delivery.py` | `deliver` (claim → send → record), `check_statuses`, `mask_phone` |
| `backend/sms/debt_warnings.py` | `plan`, `send` |
| `backend/sms/tasks.py` | Celery `sms.tasks.debt_warnings`, `sms.tasks.check_statuses` |
| `backend/sms/testing.py` | `FakeEskiz` for tests |
| `backend/sms/management/commands/eskiz_account.py` | balance, sender names, templates (read-only) |
| `backend/sms/management/commands/sms_test.py` | renders the template; `--send` sends one test SMS |
| `backend/sms/management/commands/sms_debt_warnings_report.py` | dry-run list, masked |
| `backend/sms/tests_*.py` (`eskiz`, `templates`, `models`, `delivery`, `debt_warnings`, `tasks`, `commands`) | tests |
| `backend/lcup/finance.py` | extract `freezable(link)` from `freeze_plan` (no behaviour change) |
| `backend/config/settings.py` | INSTALLED_APPS, ESKIZ/SMS settings, 2 beat entries |
| `backend/.env.example` | the new keys |

---

### Task 1: App skeleton, settings and the eskiz client

**Files:**
- Create: `backend/sms/__init__.py`, `backend/sms/apps.py`, `backend/sms/conf.py`, `backend/sms/eskiz.py`, `backend/sms/tests_eskiz.py`
- Modify:
  - `backend/config/settings.py`: INSTALLED_APPS (after `'lcup.apps.LcupConfig',`), and an ESKIZ block after the `LCUP_DEBT_FREEZE_DAY` line
  - `backend/.env.example`

**Interfaces:**
- Produces:
  - `sms.conf.credentials() -> dict` (keys `base_url, email, secret, sender`), `sms.conf.is_configured() -> bool`, `sms.conf.debt_warnings_enabled() -> bool`
  - `sms.eskiz.EskizClient(*, base_url, email, secret, sender, session=None, cache=None, sleep=time.sleep)`
  - `EskizClient.send(phone: str, text: str, *, user_sms_id: str = "") -> SendResult`. `SendResult(outcome, request_id="", error="")`; `outcome` is one of the module constants `ACCEPTED`, `REJECTED`, `FAILED`, `UNCERTAIN`.
  - `EskizClient.status(request_id: str) -> StatusResult(ok, status="", parts=None, error="")`
  - `EskizClient.templates() -> list[dict]`, `.nicks() -> list`, `.balance() -> int | None`. These three raise `EskizError`.
  - `sms.eskiz.default_client() -> EskizClient`, and the constants `TOKEN_KEY`, `LOCK_KEY`, `TOKEN_TTL`

- [ ] **Step 1: Create the app files and settings**

`backend/sms/__init__.py`: empty file.

`backend/sms/apps.py`:
```python
from django.apps import AppConfig


class SmsConfig(AppConfig):
    """SMS through eskiz.uz — today only the warning before the monthly debt freeze (``debt_warnings``)."""

    name = "sms"
    verbose_name = "SMS (eskiz.uz)"
```

`backend/sms/conf.py`:
```python
"""Where the SMS app reads its switches and credentials — one place, so nothing else touches
``settings.ESKIZ_*`` directly and a test can override them with ``override_settings``."""

from django.conf import settings

DEFAULT_BASE_URL = "https://notify.eskiz.uz/api"
DEFAULT_SENDER = "4546"


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "ESKIZ_BASE_URL", "") or DEFAULT_BASE_URL).strip().rstrip("/"),
        "email": (getattr(settings, "ESKIZ_EMAIL", "") or "").strip(),
        # The gateway secret key from the eskiz cabinet (SMS → gateway), not the cabinet password.
        "secret": getattr(settings, "ESKIZ_SECRET_KEY", "") or "",
        "sender": (getattr(settings, "ESKIZ_FROM", "") or DEFAULT_SENDER).strip(),
    }


def is_configured() -> bool:
    creds = credentials()
    return bool(creds["email"] and creds["secret"])


def debt_warnings_enabled() -> bool:
    return bool(getattr(settings, "SMS_DEBT_WARNINGS_ENABLED", False))
```

In `backend/config/settings.py`, add `'sms.apps.SmsConfig',` as the last entry of `INSTALLED_APPS` (after `'lcup.apps.LcupConfig',`). After `LCUP_DEBT_FREEZE_DAY = …`, add:
```python

# SMS through eskiz.uz (backend/sms, docs/superpowers/plans/2026-10-18-eskiz-sms-debt-warnings.md): days
# 1..LCUP_DEBT_FREEZE_DAY-1 at 10:00, everyone the freeze would take gets one SMS on their lc-up phone.
# The eskiz account is shared with lc-up. Off by default; literal "true" only.
ESKIZ_BASE_URL = os.getenv("ESKIZ_BASE_URL", "https://notify.eskiz.uz/api").strip()
ESKIZ_EMAIL = os.getenv("ESKIZ_EMAIL", "").strip()
ESKIZ_SECRET_KEY = os.getenv("ESKIZ_SECRET_KEY", "")
ESKIZ_FROM = os.getenv("ESKIZ_FROM", "4546").strip()
SMS_DEBT_WARNINGS_ENABLED = os.getenv("SMS_DEBT_WARNINGS_ENABLED", "False").lower() == "true"
```

Append to `backend/.env.example`:
```
# eskiz.uz SMS (backend/sms). The email + the gateway SECRET KEY from the cabinet (SMS -> gateway), not the cabinet password.
ESKIZ_EMAIL=
ESKIZ_SECRET_KEY=
ESKIZ_FROM=4546
SMS_DEBT_WARNINGS_ENABLED=False
```

- [ ] **Step 2: Write the failing client tests**

`backend/sms/tests_eskiz.py`:
```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 /Users/macbook/.pyenv/versions/3.12.2/bin/python3 manage.py test sms.tests_eskiz --settings=config.settings_test_nomigrations -v 1`
Expected: ERROR — `ModuleNotFoundError: No module named 'sms.eskiz'`

- [ ] **Step 4: Write the client**

`backend/sms/eskiz.py`:
```python
"""The only door to eskiz.uz, the SMS gateway (https://documenter.getpostman.com/view/663428/RzfmES4z).

**The eskiz account is shared with lc-up**, and whether a new login revokes the token lc-up holds is
not documented. So we log in as rarely as we can: one token in the shared cache (Redis in
production) for TOKEN_TTL — eskiz's live 30 days — and a new login only when there is none, or eskiz
refused the one we sent; then under a lock, so exactly one process logs in and the rest wait.

**A send is never retried once it may have reached eskiz.** ``/message/sms/send`` has no idempotency
key: a read timeout or a 5xx can mean "sent", and a second try would put the same SMS on a parent's
phone twice. Those come back UNCERTAIN. Only a refused token (401, or the older backend's 500
"Token has expired") is retried, once — eskiz did not take that request.

**HTTP 200 is not "accepted".** eskiz answers some refusals (text not an approved template, no
balance) with a 200; a send is accepted only when the body says ``status == "waiting"`` and has an
``id``, the request id its delivery status is read by.

``send`` and ``status`` never raise: an eskiz outage must not break the task that calls them. The
account reads (``templates``, ``nicks``, ``balance``) are for a person at a terminal and raise
:class:`EskizError`. Nothing here writes a phone number into an error: eskiz's messages quote it.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import requests
from django.core.cache import cache as default_cache

from . import conf

TOKEN_KEY = "eskiz:token"
LOCK_KEY = "eskiz:login-lock"
#: eskiz tokens live 30 days; ours is dropped earlier so it never runs out in the middle of a run.
TOKEN_TTL = 25 * 24 * 3600
TIMEOUT = (5, 20)
LOGIN_WAIT_SECONDS = 30
SEND_PATH = "/message/sms/send"
_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")

ACCEPTED = "accepted"
REJECTED = "rejected"
FAILED = "failed"
UNCERTAIN = "uncertain"


class EskizError(Exception):
    pass


class EskizAuthError(EskizError):
    """eskiz refused our email + secret key, or a token it had just issued."""


class _Unreached(EskizError):
    """The request never left: eskiz could not be connected to."""


class _MaybeReached(EskizError):
    """The request left and no answer came back: eskiz may have acted on it."""


@dataclass(frozen=True)
class SendResult:
    outcome: str
    request_id: str = ""
    error: str = ""


@dataclass(frozen=True)
class StatusResult:
    ok: bool
    status: str = ""
    parts: int | None = None
    error: str = ""


def _mask(text) -> str:
    return re.sub(r"\d{5,}", "…", str(text or ""))[:400]


def _json(resp):
    try:
        return resp.json()
    except ValueError:
        return None


def _body(resp) -> dict:
    body = _json(resp)
    return body if isinstance(body, dict) else {}


def _message(resp) -> str:
    message = _body(resp).get("message")
    if isinstance(message, dict):  # validation errors: {"mobile_phone": ["…"]}
        return "; ".join(
            f"{field}: {' '.join(map(str, errors if isinstance(errors, list) else [errors]))}"
            for field, errors in message.items()
        )
    return str(message or "")


def _expired(resp) -> bool:
    if resp.status_code == 401:
        return True
    return resp.status_code == 500 and "expired" in _message(resp).lower()


def _send_result(resp) -> SendResult:
    body = _body(resp)
    request_id = str(body.get("id") or "")
    if resp.status_code == 200 and str(body.get("status") or "").lower() == "waiting" and request_id:
        return SendResult(ACCEPTED, request_id=request_id)
    outcome = UNCERTAIN if resp.status_code >= 500 else REJECTED
    return SendResult(outcome, error=_mask(f"HTTP {resp.status_code}: {_message(resp)}"))


class EskizClient:
    def __init__(self, *, base_url, email, secret, sender, session=None, cache=None, sleep=time.sleep):
        self.base_url = (base_url or conf.DEFAULT_BASE_URL).rstrip("/")
        self.email = email or ""
        self.secret = secret or ""
        self.sender = sender or conf.DEFAULT_SENDER
        self.session = session or requests.Session()
        self.cache = cache or default_cache
        self.sleep = sleep

    # ── sending ───────────────────────────────────────────────────────────

    def send(self, phone: str, text: str, *, user_sms_id: str = "") -> SendResult:
        if not (self.email and self.secret):
            return SendResult(FAILED, error="eskiz is not configured")
        data = {"mobile_phone": phone, "message": text, "from": self.sender}
        if user_sms_id:
            data["user_sms_id"] = user_sms_id
        token = None
        for _ in range(2):
            try:
                token = self._token(stale=token)
            except EskizError as exc:  # the login, not the SMS: nothing was sent
                return SendResult(FAILED, error=_mask(exc))
            try:
                resp = self._send("POST", SEND_PATH, data=data, token=token)
            except _Unreached as exc:
                return SendResult(FAILED, error=str(exc))
            except EskizError as exc:
                return SendResult(UNCERTAIN, error=str(exc))
            if not _expired(resp):
                return _send_result(resp)
        return SendResult(FAILED, error="eskiz refused a freshly issued token")

    def status(self, request_id: str) -> StatusResult:
        if not _REQUEST_ID.match(str(request_id or "")):
            return StatusResult(False, error="not an eskiz request id")
        try:
            body = self._read("GET", f"/message/sms/status_by_id/{request_id}")
        except EskizError as exc:
            return StatusResult(False, error=_mask(exc))
        data = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), dict) else {}
        parts = data.get("parts_count")
        return StatusResult(
            True, status=str(data.get("status") or "").upper(), parts=parts if isinstance(parts, int) else None
        )

    # ── account reads (for a person at a terminal) ────────────────────────

    def templates(self) -> list[dict]:
        body = self._read("GET", "/user/templates")
        rows = body.get("result") if isinstance(body, dict) else None
        return rows if isinstance(rows, list) else []

    def nicks(self) -> list:
        body = self._read("GET", "/nick/me")
        if isinstance(body, dict):
            body = body.get("data", body)
        return body if isinstance(body, list) else [body]

    def balance(self) -> int | None:
        body = self._read("GET", "/user/get-limit")
        data = body.get("data") if isinstance(body, dict) else None
        try:
            return int(data.get("balance")) if isinstance(data, dict) else None
        except (TypeError, ValueError):
            return None

    def _read(self, method: str, path: str):
        if not (self.email and self.secret):
            raise EskizError("eskiz is not configured")
        token = None
        for _ in range(2):
            token = self._token(stale=token)
            resp = self._send(method, path, token=token)
            if not _expired(resp):
                if resp.status_code >= 400:
                    raise EskizError(_mask(f"HTTP {resp.status_code} on {path}: {_message(resp)}"))
                return _json(resp)
        raise EskizAuthError("eskiz refused a freshly issued token")

    # ── token ─────────────────────────────────────────────────────────────

    def _token(self, stale: str | None = None) -> str:
        token = self.cache.get(TOKEN_KEY)
        if token and token != stale:
            return token
        if self.cache.add(LOCK_KEY, "1", timeout=LOGIN_WAIT_SECONDS):
            try:
                # Another process may have logged in between our read and the lock.
                token = self.cache.get(TOKEN_KEY)
                if token and token != stale:
                    return token
                token = self._login()
                self.cache.set(TOKEN_KEY, token, timeout=TOKEN_TTL)
                return token
            finally:
                self.cache.delete(LOCK_KEY)
        for _ in range(LOGIN_WAIT_SECONDS):
            self.sleep(1)
            token = self.cache.get(TOKEN_KEY)
            if token and token != stale:
                return token
        raise EskizError("timed out waiting for another process to log in to eskiz")

    def _login(self) -> str:
        resp = self._send("POST", "/auth/login", data={"email": self.email, "password": self.secret}, token=None)
        data = _body(resp).get("data")
        token = data.get("token") if isinstance(data, dict) else None
        if resp.status_code != 200 or not isinstance(token, str) or not token:
            self.cache.delete(TOKEN_KEY)
            raise EskizAuthError(_mask(f"eskiz refused the login ({resp.status_code}): {_message(resp)}"))
        return token

    # ── transport ─────────────────────────────────────────────────────────

    def _send(self, method, path, *, token, data=None):
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            return self.session.request(method, self.base_url + path, data=data, headers=headers, timeout=TIMEOUT)
        except requests.ConnectTimeout:
            raise _Unreached("eskiz unreachable: ConnectTimeout") from None
        except requests.RequestException as exc:
            # The exception text can carry the URL and the form; the type is all the caller needs.
            raise _MaybeReached(f"eskiz did not answer: {type(exc).__name__}") from None


def default_client() -> EskizClient:
    return EskizClient(**conf.credentials())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: the command from Step 3. Expected: `OK` (18 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/sms/__init__.py backend/sms/apps.py backend/sms/conf.py backend/sms/eskiz.py backend/sms/tests_eskiz.py backend/config/settings.py backend/.env.example
git commit -m "feat(sms): an eskiz.uz client that logs in rarely and never sends twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Approved templates and how a value goes in

**Files:**
- Create: `backend/sms/templates.py`, `backend/sms/tests_templates.py`

**Interfaces:**
- Produces:
  - `SmsTemplate(key: str, text: str, slots: tuple[str, ...])`, with the property `names_a_student -> bool`
  - `render(template, values: dict) -> str`, which raises `TemplateError` (a `ValueError`)
  - `is_gsm_safe(text) -> bool`
  - `DEBT_WARNING: SmsTemplate | None = None`
  - `SAMPLE_VALUES: dict`
  - The value names a template may use: `first_name`, `last_name`, `debt`, `freeze_day`, `days_left`

- [ ] **Step 1: Write the failing tests**

`backend/sms/tests_templates.py`:
```python
from django.test import SimpleTestCase

from sms.templates import SmsTemplate, TemplateError, is_gsm_safe, render

WARN = SmsTemplate(
    "debt_warning",
    "Hurmatli ota-ona, %w ning %d so'm qarzi bor. %d-sanada akkaunt muzlatiladi.",
    ("first_name", "debt", "freeze_day"),
)
VALUES = {"first_name": "Aziz", "debt": 150000, "freeze_day": 6}


class RenderTests(SimpleTestCase):
    def test_fills_the_slots_in_order(self):
        self.assertEqual(
            render(WARN, VALUES),
            "Hurmatli ota-ona, Aziz ning 150000 so'm qarzi bor. 6-sanada akkaunt muzlatiladi.",
        )

    def test_a_word_slot_takes_one_word_with_an_ascii_apostrophe(self):
        text = render(WARN, dict(VALUES, first_name="Ra’no Karimova"))
        self.assertIn("Ra'no ning", text)

    def test_a_ranged_word_slot_takes_up_to_its_count(self):
        template = SmsTemplate("t", "Salom %w{1,2}!", ("first_name",))
        self.assertEqual(render(template, {"first_name": "Ali Vali Soli"}), "Salom Ali Vali!")

    def test_a_number_slot_refuses_anything_but_digits(self):
        with self.assertRaises(TemplateError):
            render(WARN, dict(VALUES, debt="150 000"))

    def test_an_empty_word_is_refused(self):
        with self.assertRaises(TemplateError):
            render(WARN, dict(VALUES, first_name="  "))

    def test_a_missing_value_is_refused(self):
        with self.assertRaises(TemplateError):
            render(WARN, {"first_name": "Aziz", "debt": 1})

    def test_slots_and_names_must_agree(self):
        with self.assertRaises(TemplateError):
            SmsTemplate("bad", "Salom %w, %d", ("first_name",))

    def test_names_a_student(self):
        self.assertTrue(WARN.names_a_student)
        self.assertFalse(SmsTemplate("n", "To'lov %d-sanagacha", ("freeze_day",)).names_a_student)


class GsmTests(SimpleTestCase):
    def test_an_ascii_apostrophe_is_gsm(self):
        self.assertTrue(is_gsm_safe("To'lov qiling"))

    def test_an_uzbek_okina_is_not(self):
        # One U+02BB turns the whole SMS into UCS-2: 70 characters a part, about twice the price.
        self.assertFalse(is_gsm_safe("Toʻlov qiling"))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: the Global Constraints test command with label `sms.tests_templates`.
Expected: ERROR — `No module named 'sms.templates'`

- [ ] **Step 3: Write the module**

`backend/sms/templates.py`:
```python
"""The texts eskiz has approved, and how a value goes into one.

eskiz sends only a text that matches a moderated template character for character. Its variable
parts are ``%d`` (a number), ``%w`` (one word) and ``%w{a,b}`` (a to b words). So a template here is
the cabinet's ``original_text`` copied VERBATIM — ``manage.py eskiz_account`` prints it with
``repr`` so a stray space or apostrophe shows — plus the names of the values filling its slots, in
order. Never retype one: a template that differs by a character is refused.

Values go in as plain ASCII words (``'`` for o'/g'). The template text itself is left as eskiz
approved it, but one ``ʻ`` or ``‘`` in it makes every SMS UCS-2 — 70 characters a part instead of
160, about twice the price — which is why ``is_gsm_safe`` is reported wherever a text is shown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SLOT = re.compile(r"%(d|w)(?:\{(\d+),(\d+)\})?")
_DIGITS = re.compile(r"^[0-9]+$")
_APOSTROPHES = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
#: Values that name one student: a template using one is sent per student, not per phone.
PERSONAL_VALUES = frozenset({"first_name", "last_name"})


class TemplateError(ValueError):
    pass


@dataclass(frozen=True)
class SmsTemplate:
    key: str
    text: str
    slots: tuple[str, ...]

    def __post_init__(self):
        found = len(SLOT.findall(self.text))
        if found != len(self.slots):
            raise TemplateError(f"{self.key}: the text has {found} slots and {len(self.slots)} values are named")

    @property
    def names_a_student(self) -> bool:
        return any(slot in PERSONAL_VALUES for slot in self.slots)


def is_gsm_safe(text) -> bool:
    """Plain ASCII — what keeps an SMS at 160 characters a part."""
    return all(ord(ch) < 128 for ch in str(text))


def render(template: SmsTemplate, values: dict) -> str:
    slots = iter(template.slots)

    def fill(match) -> str:
        name = next(slots)
        if name not in values:
            raise TemplateError(f"{template.key}: no value for {name}")
        value = str(values[name])
        if match.group(1) == "d":
            if not _DIGITS.match(value):
                raise TemplateError(f"{template.key}: {name} is not a whole number")
            return value
        words = value.translate(_APOSTROPHES).split()
        if not words:
            raise TemplateError(f"{template.key}: {name} is empty")
        return " ".join(words[: int(match.group(3)) if match.group(3) else 1])

    return SLOT.sub(fill, template.text)


#: The warning on days 1..LCUP_DEBT_FREEZE_DAY-1 (``debt_warnings``). None until the approved text is
#: copied in from ``manage.py eskiz_account`` (plan Task 7); while None nothing is sent.
DEBT_WARNING: SmsTemplate | None = None

#: What ``manage.py sms_test`` fills a template with.
SAMPLE_VALUES = {"first_name": "Test", "last_name": "Testov", "debt": 100000, "freeze_day": 6, "days_left": 1}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command from Step 2. Expected: `OK` (10 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/sms/templates.py backend/sms/tests_templates.py
git commit -m "feat(sms): approved eskiz templates, filled slot by slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The SMS log and delivery (claim, send, record, check)

**Files:**
- Create:
  - `backend/sms/models.py`
  - `backend/sms/migrations/__init__.py`
  - `backend/sms/migrations/0001_initial.py` (generated)
  - `backend/sms/delivery.py`
  - `backend/sms/testing.py`
  - `backend/sms/tests_models.py`
  - `backend/sms/tests_delivery.py`

**Interfaces:**
- Consumes: the `sms.eskiz` result types and outcome constants (Task 1).
- Produces:
  - `SmsMessage`, with `KIND_DEBT_WARNING`, `KIND_TEST`, the `STATUS_*` constants, and the fields `kind, run_on, dedupe_key, phone, text, user, lcup_student_id, status, request_id, eskiz_status, parts, error, sent_at, checked_at`
  - `deliver(client, *, kind, run_on, dedupe_key, phone, text, user=None, lcup_student_id=None) -> SmsMessage | None`
  - `check_statuses(client, now) -> dict`, and the constant `CHECK_WINDOW`
  - `mask_phone(phone) -> str`
  - `sms.testing.FakeEskiz(outcome=ACCEPTED, statuses=None)`; its `.sent` is a list of `(phone, text, user_sms_id)`

- [ ] **Step 1: Write the model**

`backend/sms/migrations/__init__.py`: empty file.

`backend/sms/models.py`:
```python
from django.conf import settings
from django.db import models


class SmsMessage(models.Model):
    """One SMS we asked eskiz to send: the log, and — by its unique (kind, day, key) — the claim that
    stops a second one. The row is written BEFORE the request leaves, so a run that dies half-way
    never sends the same SMS again on a re-run."""

    KIND_DEBT_WARNING = "debt_warning"
    KIND_TEST = "test"
    KIND_CHOICES = [(KIND_DEBT_WARNING, "Debt warning"), (KIND_TEST, "Test")]

    STATUS_PENDING = "PENDING"  # claimed; the request is about to leave
    STATUS_SENT = "SENT"  # eskiz took it; delivery not known yet
    STATUS_DELIVERED = "DELIVERED"
    STATUS_UNDELIVERED = "UNDELIVERED"  # the operator gave up: blacklist, phone off for 24 h, …
    STATUS_REJECTED = "REJECTED"  # eskiz refused it: not an approved text, a bad number, no balance
    STATUS_FAILED = "FAILED"  # eskiz was not reached; nothing was sent
    STATUS_UNCERTAIN = "UNCERTAIN"  # the request left and no answer came: it may have been sent
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENT, "Sent"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_UNDELIVERED, "Undelivered"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_FAILED, "Failed"),
        (STATUS_UNCERTAIN, "Uncertain"),
    ]

    kind = models.CharField(max_length=24, choices=KIND_CHOICES)
    #: The local day it went out on — one warning per student per day.
    run_on = models.DateField()
    #: Who the day's limit counts: "student:<lc-up id>", "phone:<998…>" or, for a test, "test:<random>".
    dedupe_key = models.CharField(max_length=64)
    phone = models.CharField(max_length=12)
    text = models.TextField()
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    lcup_student_id = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    #: eskiz's id for the request (a UUID) — what its delivery status is read by.
    request_id = models.CharField(max_length=64, blank=True, default="")
    #: eskiz's own last word on delivery (DELIVERED, EXPIRED, ACCEPTED, …).
    eskiz_status = models.CharField(max_length=32, blank=True, default="")
    parts = models.PositiveSmallIntegerField(null=True, blank=True)
    error = models.CharField(max_length=400, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    checked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sms_messages"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "run_on", "dedupe_key"], name="uniq_sms_per_day"),
        ]
        indexes = [models.Index(fields=["status", "sent_at"])]

    def __str__(self) -> str:
        return f"{self.kind} {self.run_on} {self.dedupe_key}: {self.status}"
```

- [ ] **Step 2: Generate the migration**

Run: `cd backend && SECRET_KEY=test-secret DEBUG=True /Users/macbook/.pyenv/versions/3.12.2/bin/python3 manage.py makemigrations sms`
Expected: `Migrations for 'sms': sms/migrations/0001_initial.py` and `+ Create model SmsMessage`.
Then open the file and check that it creates exactly `sms_messages` with the unique constraint and the index, and touches no other app.

- [ ] **Step 3: Write the test double and the failing tests**

`backend/sms/testing.py`:
```python
"""A stand-in for :class:`sms.eskiz.EskizClient` that records what would have been sent."""

from .eskiz import ACCEPTED, SendResult, StatusResult


class FakeEskiz:
    def __init__(self, outcome=ACCEPTED, statuses=None):
        self.outcome = outcome
        self.statuses = dict(statuses or {})
        self.sent = []

    def send(self, phone, text, *, user_sms_id=""):
        self.sent.append((phone, text, user_sms_id))
        if self.outcome == ACCEPTED:
            return SendResult(ACCEPTED, request_id=f"req-{len(self.sent)}")
        return SendResult(self.outcome, error="refused by the fake")

    def status(self, request_id):
        status = self.statuses.get(request_id)
        if status is None:
            return StatusResult(False, error="unknown to the fake")
        return StatusResult(True, status=status, parts=1)
```

`backend/sms/tests_models.py`:
```python
from datetime import date

from django.db import IntegrityError, transaction
from django.test import TestCase

from sms.models import SmsMessage


def row(**extra):
    fields = dict(
        kind=SmsMessage.KIND_DEBT_WARNING, run_on=date(2026, 11, 1), dedupe_key="student:101",
        phone="998901234567", text="x",
    )
    fields.update(extra)
    return SmsMessage.objects.create(**fields)


class UniquePerDayTests(TestCase):
    def test_one_row_per_kind_day_and_key(self):
        row()
        with self.assertRaises(IntegrityError), transaction.atomic():
            row()

    def test_the_next_day_is_a_new_sms(self):
        row()
        row(run_on=date(2026, 11, 2))
        self.assertEqual(SmsMessage.objects.count(), 2)

    def test_another_kind_is_counted_apart(self):
        row()
        row(kind=SmsMessage.KIND_TEST)
        self.assertEqual(SmsMessage.objects.count(), 2)
```

`backend/sms/tests_delivery.py`:
```python
from datetime import date, datetime, timedelta

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from sms.delivery import check_statuses, deliver, mask_phone
from sms.eskiz import FAILED, REJECTED, UNCERTAIN
from sms.models import SmsMessage
from sms.testing import FakeEskiz

DAY = date(2026, 11, 1)
NOW = timezone.make_aware(datetime(2026, 11, 1, 11, 30))


def send(fake, key="student:101"):
    return deliver(
        fake, kind=SmsMessage.KIND_DEBT_WARNING, run_on=DAY, dedupe_key=key,
        phone="998901234567", text="Bu Eskiz dan test", lcup_student_id=101,
    )


class DeliverTests(TestCase):
    def test_an_accepted_sms_is_recorded_as_sent(self):
        fake = FakeEskiz()
        msg = send(fake)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.request_id), (SmsMessage.STATUS_SENT, "req-1"))
        self.assertIsNotNone(msg.sent_at)
        self.assertEqual(fake.sent, [("998901234567", "Bu Eskiz dan test", f"m{msg.pk}")])

    def test_the_same_key_on_the_same_day_is_never_sent_twice(self):
        fake = FakeEskiz()
        send(fake)
        self.assertIsNone(send(fake))
        self.assertEqual(len(fake.sent), 1)

    def test_outcomes_map_to_statuses(self):
        for outcome, status in (
            (REJECTED, SmsMessage.STATUS_REJECTED),
            (FAILED, SmsMessage.STATUS_FAILED),
            (UNCERTAIN, SmsMessage.STATUS_UNCERTAIN),
        ):
            msg = send(FakeEskiz(outcome), key=f"student:{outcome}")
            msg.refresh_from_db()
            self.assertEqual(msg.status, status)
            self.assertIsNone(msg.sent_at)
            self.assertEqual(msg.error, "refused by the fake")


class CheckStatusesTests(TestCase):
    def sent(self, request_id, *, at=NOW - timedelta(hours=1)):
        return SmsMessage.objects.create(
            kind=SmsMessage.KIND_DEBT_WARNING, run_on=DAY, dedupe_key=f"student:{request_id}", phone="998901234567",
            text="x", status=SmsMessage.STATUS_SENT, request_id=request_id, sent_at=at,
        )

    def test_final_answers_are_recorded(self):
        delivered, expired, waiting = self.sent("a"), self.sent("b"), self.sent("c")
        fake = FakeEskiz(statuses={"a": "DELIVERED", "b": "EXPIRED", "c": "ACCEPTED"})
        check_statuses(fake, NOW)
        for msg in (delivered, expired, waiting):
            msg.refresh_from_db()
        self.assertEqual(delivered.status, SmsMessage.STATUS_DELIVERED)
        self.assertEqual(expired.status, SmsMessage.STATUS_UNDELIVERED)
        self.assertEqual((waiting.status, waiting.eskiz_status), (SmsMessage.STATUS_SENT, "ACCEPTED"))
        self.assertEqual(delivered.checked_at, NOW)

    def test_older_than_two_days_is_left_alone(self):
        old = self.sent("a", at=NOW - timedelta(hours=49))
        check_statuses(FakeEskiz(statuses={"a": "DELIVERED"}), NOW)
        old.refresh_from_db()
        self.assertEqual(old.status, SmsMessage.STATUS_SENT)

    def test_an_unanswered_check_changes_nothing(self):
        msg = self.sent("a")
        check_statuses(FakeEskiz(statuses={}), NOW)
        msg.refresh_from_db()
        self.assertEqual((msg.status, msg.checked_at), (SmsMessage.STATUS_SENT, None))


class MaskTests(SimpleTestCase):
    def test_mask_phone(self):
        self.assertEqual(mask_phone("998901234567"), "99890***4567")
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: the test command with labels `sms.tests_models sms.tests_delivery`.
Expected: ERROR — `No module named 'sms.delivery'`. `tests_models` alone would already pass.

- [ ] **Step 5: Write delivery**

`backend/sms/delivery.py`:
```python
"""Claim → send → record, and eskiz's later word on whether it arrived.

``deliver`` writes the day's row before the request leaves. The unique (kind, day, key) is the
lock: a second run the same day — the beat firing twice, a person re-running — finds the row and
sends nothing. Its outcome is recorded once and never retried (see ``sms.eskiz``).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from . import eskiz
from .models import SmsMessage

#: eskiz keeps a request's status readable by its UUID for 30 days; two are enough to see an SMS arrive.
CHECK_WINDOW = timedelta(hours=48)
DELIVERED = frozenset({"DELIVERED", "DELIVRD"})
UNDELIVERED = frozenset({"UNDELIVERED", "UNDELIV", "UNDELIVERABLE", "EXPIRED", "REJECTED", "REJECTD", "DELETED"})

_STATUS_OF = {
    eskiz.ACCEPTED: SmsMessage.STATUS_SENT,
    eskiz.REJECTED: SmsMessage.STATUS_REJECTED,
    eskiz.FAILED: SmsMessage.STATUS_FAILED,
    eskiz.UNCERTAIN: SmsMessage.STATUS_UNCERTAIN,
}


def mask_phone(phone) -> str:
    phone = str(phone or "")
    return f"{phone[:5]}***{phone[-4:]}" if len(phone) >= 9 else "***"


def deliver(client, *, kind, run_on, dedupe_key, phone, text, user=None, lcup_student_id=None) -> SmsMessage | None:
    """The SMS, once. None when today's row for this key is already there."""
    try:
        with transaction.atomic():
            msg = SmsMessage.objects.create(
                kind=kind, run_on=run_on, dedupe_key=dedupe_key, phone=phone, text=text,
                user=user, lcup_student_id=lcup_student_id,
            )
    except IntegrityError:
        return None
    result = client.send(phone, text, user_sms_id=f"m{msg.pk}")
    msg.status = _STATUS_OF[result.outcome]
    msg.request_id = result.request_id
    msg.error = result.error[:400]
    msg.sent_at = timezone.now() if result.outcome == eskiz.ACCEPTED else None
    msg.save(update_fields=["status", "request_id", "error", "sent_at", "updated_at"])
    return msg


def check_statuses(client, now) -> dict:
    """Ask eskiz about what went out in the last CHECK_WINDOW and is not settled yet."""
    counts = defaultdict(int)
    rows = SmsMessage.objects.filter(
        status=SmsMessage.STATUS_SENT, sent_at__gte=now - CHECK_WINDOW
    ).exclude(request_id="")
    for msg in rows:
        result = client.status(msg.request_id)
        if not result.ok:
            counts["unanswered"] += 1
            continue
        msg.eskiz_status = result.status[:32]
        msg.parts = result.parts
        msg.checked_at = now
        if result.status in DELIVERED:
            msg.status = SmsMessage.STATUS_DELIVERED
        elif result.status in UNDELIVERED:
            msg.status = SmsMessage.STATUS_UNDELIVERED
        msg.save(update_fields=["status", "eskiz_status", "parts", "checked_at", "updated_at"])
        counts[msg.status.lower()] += 1
    return dict(counts)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: the command from Step 4. Expected: `OK` (10 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/sms/models.py backend/sms/migrations backend/sms/delivery.py backend/sms/testing.py backend/sms/tests_models.py backend/sms/tests_delivery.py
git commit -m "feat(sms): one row per SMS per day, written before it leaves; delivery read back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Who is warned — the freeze's own rule, the days before

**Files:**
- Modify: `backend/lcup/finance.py` (add `freezable` after `owes`, and use it in `freeze_plan`)
- Create: `backend/sms/debt_warnings.py`, `backend/sms/tests_debt_warnings.py`

**Interfaces:**
- Consumes:
  - `deliver` (Task 3)
  - `T.DEBT_WARNING`, `T.render`, `T.TemplateError` (Task 2)
  - `lcup.conf.debt_freeze_enabled`, `lcup.conf.debt_freeze_day`
  - `lcup.phones.normalize_phone`, `lcup.phones.split_lcup_name`
- Produces:
  - `lcup.finance.freezable(link) -> bool`
  - `sms.debt_warnings.plan(now, *, today=None) -> Plan`, where `Plan(warnings, skipped: dict, blocked: str)` and each warning is `Warning(link, phone, text, dedupe_key)`
  - `sms.debt_warnings.send(client, now) -> dict`
  - the constants `STALE_AFTER`, `MAX_PER_RUN`

- [ ] **Step 1: Extract `freezable` in `lcup/finance.py`**

After `def owes(link)`, add:
```python
def freezable(link) -> bool:
    """Whether the freeze takes this linked learner on a freezing day: they owe, they are not frozen
    (for any reason), no admin exempted them, and lc-up still lists them. ``sms.debt_warnings`` warns
    exactly these people on the days before."""
    return (
        not link.user.is_frozen
        and link.debt_freeze_exempt_at is None
        and not link.deleted_in_lcup
        and owes(link)
    )
```
In `freeze_plan`, replace
```python
        elif freezing_days and not user.is_frozen and not exempt and not link.deleted_in_lcup and owes(link):
```
with
```python
        elif freezing_days and freezable(link):
```
Run: the test command with label `lcup.tests_finance`. Expected: `OK`. The freeze behaves exactly as before.

- [ ] **Step 2: Write the failing tests**

`backend/sms/tests_debt_warnings.py`:
```python
"""The SMS before the debt freeze. Owner, 2026-10-18: days 1–5 every day, nothing on the 6th. Every
date is fixed: the rule reads the day of the month, so a test must never read the clock."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.models import LcupStudentLink, LinkStatus
from sms import debt_warnings
from sms.models import SmsMessage
from sms.templates import SmsTemplate
from sms.testing import FakeEskiz
from users.models import User

WARN = SmsTemplate(
    "debt_warning",
    "Hurmatli ota-ona, %w ning %d so'm qarzi bor. %d-sanada akkaunt muzlatiladi.",
    ("first_name", "debt", "freeze_day"),
)
NO_NAME = SmsTemplate("debt_warning", "Markazga qarzingiz bor. %d-sanagacha to'lang.", ("freeze_day",))
AZIZ_TEXT = "Hurmatli ota-ona, Aziz ning 150000 so'm qarzi bor. 6-sanada akkaunt muzlatiladi."


def at(day, month=11, hour=10):
    return timezone.make_aware(datetime(2026, month, day, hour, 0))


@override_settings(LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6)
@mock.patch("sms.templates.DEBT_WARNING", WARN)
class DebtWarningTests(TestCase):
    def learner(self, lcup_id, username, *, balance, phone="998901234567", seen=None, **link_extra):
        user = User.objects.create_user(
            None, password=None, username=username, role="student", first_name=username.title(), last_name="Testov"
        )
        link = LcupStudentLink.objects.create(
            lcup_student_id=lcup_id, name=f"Testov {username.title()}", user=user, status=LinkStatus.CONFIRMED,
            phone=phone, balance=Decimal(balance), balance_seen_at=seen or at(1, hour=9), **link_extra,
        )
        return user, link

    def test_a_debtor_is_warned_every_day_from_the_1st_to_the_5th(self):
        _, link = self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        for day in range(1, 6):
            LcupStudentLink.objects.filter(pk=link.pk).update(balance_seen_at=at(day, hour=9))
            debt_warnings.send(fake, at(day))
        self.assertEqual([(phone, text) for phone, text, _ in fake.sent], [("998901234567", AZIZ_TEXT)] * 5)
        self.assertEqual(SmsMessage.objects.filter(status=SmsMessage.STATUS_SENT).count(), 5)

    def test_nothing_on_the_freeze_day_or_after(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        for day in (6, 7, 28):
            self.assertEqual(debt_warnings.send(fake, at(day))["blocked"], "not a warning day")
        self.assertEqual(fake.sent, [])

    def test_once_a_day(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        debt_warnings.send(fake, at(1))
        counts = debt_warnings.send(fake, at(1, hour=11))
        self.assertEqual(len(fake.sent), 1)
        self.assertEqual(counts["already_sent"], 1)

    def test_who_is_not_warned(self):
        self.learner(101, "paid", balance=0)
        frozen, _ = self.learner(102, "frozen", balance=-1000)
        User.objects.filter(pk=frozen.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.learner(103, "exempt", balance=-1000, debt_freeze_exempt_at=at(1, month=10))
        self.learner(104, "left", balance=-1000, deleted_in_lcup=True)
        self.learner(105, "stale", balance=-1000, seen=at(1) - timedelta(hours=25))
        self.learner(106, "nophone", balance=-1000, phone="")
        LcupStudentLink.objects.create(lcup_student_id=107, name="No Account", phone="998907777777", balance=Decimal(-1000))
        fake = FakeEskiz()
        counts = debt_warnings.send(fake, at(1))
        self.assertEqual(fake.sent, [])
        self.assertEqual(counts["skipped"], {"not_freezable": 3, "stale_balance": 1, "no_phone": 1})

    @override_settings(LCUP_DEBT_FREEZE_ENABLED=False)
    def test_nothing_while_the_freeze_is_off(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "the debt freeze is switched off")
        self.assertEqual(fake.sent, [])

    def test_nothing_without_an_approved_template(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        with mock.patch("sms.templates.DEBT_WARNING", None):
            self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "no approved template yet")
        self.assertEqual(fake.sent, [])

    def test_siblings_on_one_phone_get_one_each_when_the_text_names_them(self):
        self.learner(101, "aziz", balance=-150000)
        self.learner(102, "malika", balance=-90000)
        fake = FakeEskiz()
        debt_warnings.send(fake, at(1))
        self.assertEqual(len(fake.sent), 2)

    def test_siblings_on_one_phone_get_one_between_them_when_it_does_not(self):
        self.learner(101, "aziz", balance=-150000)
        self.learner(102, "malika", balance=-90000)
        fake = FakeEskiz()
        with mock.patch("sms.templates.DEBT_WARNING", NO_NAME):
            counts = debt_warnings.send(fake, at(1))
        self.assertEqual(fake.sent, [("998901234567", "Markazga qarzingiz bor. 6-sanagacha to'lang.", mock.ANY)])
        self.assertEqual(counts["skipped"], {"same_phone": 1})

    def test_too_many_at_once_wait_for_a_person(self):
        self.learner(101, "aziz", balance=-150000, phone="998901111111")
        self.learner(102, "malika", balance=-90000, phone="998902222222")
        fake = FakeEskiz()
        with mock.patch("sms.debt_warnings.MAX_PER_RUN", 1):
            counts = debt_warnings.send(fake, at(1))
        self.assertIn("more than 1", counts["blocked"])
        self.assertEqual(fake.sent, [])

    def test_a_preview_of_another_day(self):
        self.learner(101, "aziz", balance=-150000, seen=at(18, month=10, hour=9))
        planned = debt_warnings.plan(at(18, month=10), today=date(2026, 11, 1))
        self.assertEqual(planned.blocked, "")
        self.assertEqual([w.link.lcup_student_id for w in planned.warnings], [101])
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: the test command with label `sms.tests_debt_warnings`.
Expected: ERROR — `cannot import name 'debt_warnings' from 'sms'`

- [ ] **Step 4: Write the module**

`backend/sms/debt_warnings.py`:
```python
"""The SMS before the debt freeze (owner, 2026-10-18).

"oyning boshidan 5-chisigacha ogohlantirilsin 6-kun shunchaki muzlatilsin sms jo'natish shart emas
6-kuni. lekin 5kun yuborish kerak": on every day of the month before ``debt_freeze_day()`` (1–5),
at 10:00, everyone the freeze would take that day gets one SMS on the phone lc-up holds for them —
usually a parent's. On the freeze day and after: nothing.

Who: exactly :func:`lcup.finance.freezable` — a linked learner who owes, is not frozen (an
already-frozen student is not warned: owner), is not exempt and is still in lc-up. Nobody, when:

* the freeze is switched off — the SMS would promise a freeze that is not coming;
* there is no approved template yet (``sms.templates.DEBT_WARNING``);
* more than MAX_PER_RUN would get one — lc-up answering with wrong balances; a person looks first.

And not a student whose balance is older than STALE_AFTER: lc-up's sync stopped, and they may have
paid. One SMS per student per day; when the text names nobody, one per phone, so siblings sharing
a parent's phone do not get the same words twice.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta

from django.utils import timezone

from access import constants as C
from lcup.conf import debt_freeze_day, debt_freeze_enabled
from lcup.finance import freezable
from lcup.models import LcupStudentLink
from lcup.phones import normalize_phone, split_lcup_name

from . import templates as T
from .delivery import deliver
from .models import SmsMessage

logger = logging.getLogger("sms.debt_warnings")

STALE_AFTER = timedelta(hours=24)
#: 221 linked learners on 2026-10-18; more warnings than this in one morning means lc-up's numbers are wrong.
MAX_PER_RUN = 150


@dataclass
class Warning:
    link: LcupStudentLink
    phone: str
    text: str
    dedupe_key: str


@dataclass
class Plan:
    warnings: list = field(default_factory=list)
    skipped: dict = field(default_factory=dict)
    blocked: str = ""


def _values(link, today) -> dict:
    first, last = split_lcup_name(link.name)
    return {
        "first_name": first or link.user.first_name,
        "last_name": last or link.user.last_name,
        "debt": int(abs(link.balance)),
        "freeze_day": debt_freeze_day(),
        "days_left": debt_freeze_day() - today.day,
    }


def plan(now, *, today=None) -> Plan:
    """Who would be warned at ``now``. ``today`` previews another day's list (the report command);
    the balance's age is always measured from ``now``."""
    today = today or timezone.localdate(now)
    template = T.DEBT_WARNING
    if template is None:
        return Plan(blocked="no approved template yet")
    if not debt_freeze_enabled():
        return Plan(blocked="the debt freeze is switched off")
    if today.day >= debt_freeze_day():
        return Plan(blocked="not a warning day")
    links = (
        LcupStudentLink.objects.filter(user__isnull=False, user__role__in=C.LEARNER_ROLES, balance__lt=0)
        .select_related("user")
        .order_by("lcup_student_id")
    )
    warnings, skipped, taken = [], defaultdict(int), set()
    for link in links:
        if not freezable(link):
            skipped["not_freezable"] += 1
            continue
        if link.balance_seen_at is None or link.balance_seen_at < now - STALE_AFTER:
            skipped["stale_balance"] += 1
            continue
        phone = normalize_phone(link.phone)
        if not phone:
            skipped["no_phone"] += 1
            continue
        key = f"student:{link.lcup_student_id}" if template.names_a_student else f"phone:{phone}"
        if key in taken:
            skipped["same_phone"] += 1
            continue
        try:
            text = T.render(template, _values(link, today))
        except T.TemplateError:
            logger.warning("debt warning for lc-up student %s: the text could not be filled", link.lcup_student_id)
            skipped["bad_text"] += 1
            continue
        taken.add(key)
        warnings.append(Warning(link, phone, text, key))
    result = Plan(warnings, dict(skipped))
    if len(warnings) > MAX_PER_RUN:
        result.blocked = f"{len(warnings)} warnings is more than {MAX_PER_RUN}: a person checks lc-up's balances first"
    return result


def send(client, now) -> dict:
    planned = plan(now)
    counts = {"skipped": planned.skipped}
    if planned.blocked:
        if planned.warnings:
            logger.warning("debt warnings held back: %s", planned.blocked)
        counts["blocked"] = planned.blocked
        return counts
    run_on = timezone.localdate(now)
    for warning in planned.warnings:
        msg = deliver(
            client, kind=SmsMessage.KIND_DEBT_WARNING, run_on=run_on, dedupe_key=warning.dedupe_key,
            phone=warning.phone, text=warning.text, user=warning.link.user,
            lcup_student_id=warning.link.lcup_student_id,
        )
        outcome = "already_sent" if msg is None else msg.status.lower()
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: the test command with labels `sms.tests_debt_warnings lcup.tests_finance`. Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/lcup/finance.py backend/sms/debt_warnings.py backend/sms/tests_debt_warnings.py
git commit -m "feat(sms): warn on days 1-5 everyone the debt freeze would take on the 6th

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Celery tasks and the beat schedule

**Files:**
- Create: `backend/sms/tasks.py`, `backend/sms/tests_tasks.py`
- Modify: `backend/config/settings.py` (`CELERY_BEAT_SCHEDULE`: two entries after `"lcup-sync"`)

**Interfaces:**
- Consumes: `sms.debt_warnings.send(client, now)`, `sms.delivery.check_statuses(client, now)`, `sms.delivery.CHECK_WINDOW`, `sms.eskiz.default_client()`, `sms.conf`.
- Produces: the Celery tasks `sms.tasks.debt_warnings` and `sms.tasks.check_statuses`.

- [ ] **Step 1: Write the failing tests**

`backend/sms/tests_tasks.py`:
```python
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from sms import tasks

CONFIGURED = {"ESKIZ_EMAIL": "ops@example.uz", "ESKIZ_SECRET_KEY": "key"}


class DebtWarningsTaskTests(TestCase):
    def setUp(self):
        cache.delete(tasks.RUNNING_KEY)

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=False, **CONFIGURED)
    def test_off_by_default(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "disabled"})
        send.assert_not_called()

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, ESKIZ_EMAIL="", ESKIZ_SECRET_KEY="")
    def test_on_but_without_credentials(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "eskiz is not configured"})
        send.assert_not_called()

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, **CONFIGURED)
    def test_on_runs_the_warnings(self):
        with mock.patch("sms.debt_warnings.send", return_value={"sent": 2}) as send:
            self.assertEqual(tasks.debt_warnings(), {"sent": 2})
        send.assert_called_once()

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, **CONFIGURED)
    def test_a_run_already_going_is_not_doubled(self):
        cache.add(tasks.RUNNING_KEY, "1")
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "already running"})
        send.assert_not_called()
        cache.delete(tasks.RUNNING_KEY)


class CheckStatusesTaskTests(TestCase):
    @override_settings(ESKIZ_EMAIL="", ESKIZ_SECRET_KEY="")
    def test_without_credentials(self):
        self.assertEqual(tasks.check_statuses(), {"skipped": "eskiz is not configured"})

    @override_settings(**CONFIGURED)
    def test_nothing_to_check_means_no_request(self):
        with mock.patch("sms.eskiz.default_client") as client:
            self.assertEqual(tasks.check_statuses(), {"skipped": "nothing to check"})
        client.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: the test command with label `sms.tests_tasks`.
Expected: ERROR — `cannot import name 'tasks' from 'sms'`

- [ ] **Step 3: Write the tasks and the beat entries**

`backend/sms/tasks.py`:
```python
from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from . import conf

#: Beat fires once at 10:00; a person re-running it while it is still going is not doubled.
RUNNING_KEY = "sms:debt-warnings-running"


@shared_task(name="sms.tasks.debt_warnings")
def debt_warnings() -> dict:
    """Days 1..LCUP_DEBT_FREEZE_DAY-1: the warning SMS (``sms.debt_warnings``). Every other day the
    plan says "not a warning day" and nothing is sent — the day rule lives in one place, the code."""
    if not conf.debt_warnings_enabled():
        return {"skipped": "disabled"}
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    if not cache.add(RUNNING_KEY, "1", timeout=30 * 60):
        return {"skipped": "already running"}
    try:
        from . import debt_warnings as warnings
        from . import eskiz

        return warnings.send(eskiz.default_client(), timezone.now())
    finally:
        cache.delete(RUNNING_KEY)


@shared_task(name="sms.tasks.check_statuses")
def check_statuses() -> dict:
    """eskiz's word on what went out in the last two days. With nothing to ask about, no request at
    all — and so no login on an account lc-up shares."""
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    from . import eskiz
    from .delivery import CHECK_WINDOW
    from .delivery import check_statuses as check
    from .models import SmsMessage

    now = timezone.now()
    if not SmsMessage.objects.filter(status=SmsMessage.STATUS_SENT, sent_at__gte=now - CHECK_WINDOW).exists():
        return {"skipped": "nothing to check"}
    return check(eskiz.default_client(), now)
```

In `backend/config/settings.py`, inside `CELERY_BEAT_SCHEDULE`, add after the `"lcup-sync"` entry:
```python
    # SMS before the debt freeze (backend/sms): fires every day at 10:00 (CELERY_TIMEZONE is Tashkent)
    # and the code decides — days 1..LCUP_DEBT_FREEZE_DAY-1 it warns, other days it sends nothing.
    # Returns at once while SMS_DEBT_WARNINGS_ENABLED is off.
    "sms-debt-warnings": {
        "task": "sms.tasks.debt_warnings",
        "schedule": crontab(hour=10, minute=0),
    },
    # eskiz's delivery status for what went out in the last 48 h. Nothing sent, no request.
    "sms-check-statuses": {
        "task": "sms.tasks.check_statuses",
        "schedule": crontab(minute=30),
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command from Step 2. Expected: `OK` (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/sms/tasks.py backend/sms/tests_tasks.py backend/config/settings.py
git commit -m "feat(sms): 10:00 beat for the debt warnings, hourly delivery check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Commands for the rollout — account, test SMS, dry-run list

**Files:**
- Create:
  - `backend/sms/management/__init__.py`
  - `backend/sms/management/commands/__init__.py`
  - `backend/sms/management/commands/eskiz_account.py`
  - `backend/sms/management/commands/sms_test.py`
  - `backend/sms/management/commands/sms_debt_warnings_report.py`
  - `backend/sms/tests_commands.py`

**Interfaces:**
- Consumes: `default_client`, `deliver`, `mask_phone`, `plan`, `T.render`, `T.SAMPLE_VALUES`, `T.is_gsm_safe`, `normalize_phone`.
- Produces:
  - `manage.py eskiz_account`
  - `manage.py sms_test --phone P [--send]`
  - `manage.py sms_debt_warnings_report [--day YYYY-MM-DD]`

- [ ] **Step 1: Write the failing tests**

`backend/sms/tests_commands.py`:
```python
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.models import LcupStudentLink, LinkStatus
from sms.models import SmsMessage
from sms.templates import SmsTemplate
from sms.testing import FakeEskiz
from users.models import User

WARN = SmsTemplate("debt_warning", "Hurmatli ota-ona, %w ning %d so'm qarzi bor.", ("first_name", "debt"))
CONFIGURED = {"ESKIZ_EMAIL": "ops@example.uz", "ESKIZ_SECRET_KEY": "key"}


def run(*args):
    out = StringIO()
    call_command(*args, stdout=out)
    return out.getvalue()


class FakeAccount(FakeEskiz):
    def balance(self):
        return 125000

    def nicks(self):
        return ["MasterSAT"]

    def templates(self):
        return [
            {"id": 7, "original_text": "Qarz %d so'm", "status": "service"},
            {"id": 8, "original_text": "Qarz %d soʻm", "status": "service"},
        ]


@override_settings(**CONFIGURED)
class EskizAccountTests(TestCase):
    def test_prints_balance_names_and_templates_verbatim(self):
        with mock.patch("sms.management.commands.eskiz_account.default_client", return_value=FakeAccount()):
            out = run("eskiz_account")
        self.assertIn("balance: 125000", out)
        self.assertIn("MasterSAT", out)
        self.assertIn('#7 [service]\n"Qarz %d so\'m"', out)
        self.assertIn("#8 [service]  ! not plain ASCII", out)

    @override_settings(ESKIZ_EMAIL="")
    def test_refuses_without_credentials(self):
        with self.assertRaises(CommandError):
            run("eskiz_account")


@override_settings(**CONFIGURED)
@mock.patch("sms.templates.DEBT_WARNING", WARN)
class SmsTestTests(TestCase):
    def test_without_send_only_prints(self):
        fake = FakeEskiz()
        with mock.patch("sms.management.commands.sms_test.default_client", return_value=fake):
            out = run("sms_test", "--phone", "+998 90 123 45 67")
        self.assertIn("Hurmatli ota-ona, Test ning 100000 so'm qarzi bor.", out)
        self.assertIn("not sent", out)
        self.assertEqual(fake.sent, [])

    def test_send_sends_one_test_sms(self):
        fake = FakeEskiz()
        with mock.patch("sms.management.commands.sms_test.default_client", return_value=fake):
            run("sms_test", "--phone", "998901234567", "--send")
        self.assertEqual(len(fake.sent), 1)
        msg = SmsMessage.objects.get()
        self.assertEqual(
            (msg.kind, msg.status, msg.phone), (SmsMessage.KIND_TEST, SmsMessage.STATUS_SENT, "998901234567")
        )

    def test_a_bad_phone_is_refused(self):
        with self.assertRaises(CommandError):
            run("sms_test", "--phone", "12345")


@override_settings(LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6)
@mock.patch("sms.templates.DEBT_WARNING", WARN)
class ReportTests(TestCase):
    def test_lists_who_would_be_warned_masked_and_changes_nothing(self):
        user = User.objects.create_user(None, password=None, username="aziz", role="student", first_name="Aziz")
        LcupStudentLink.objects.create(
            lcup_student_id=101, name="Testov Aziz", user=user, status=LinkStatus.CONFIRMED, phone="998901234567",
            balance=Decimal(-150000), balance_seen_at=timezone.now(),
        )
        out = run("sms_debt_warnings_report", "--day", "2026-11-01")
        self.assertIn("99890***4567", out)
        self.assertNotIn("998901234567", out)
        self.assertIn("Aziz ning 150000", out)
        self.assertEqual(SmsMessage.objects.count(), 0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: the test command with label `sms.tests_commands`.
Expected: ERROR — `ModuleNotFoundError` for the patch target or `Unknown command: 'eskiz_account'`

- [ ] **Step 3: Write the commands**

`backend/sms/management/__init__.py` and `backend/sms/management/commands/__init__.py`: empty files.

`backend/sms/management/commands/eskiz_account.py`:
```python
import json

from django.core.management.base import BaseCommand, CommandError

from sms import conf
from sms.eskiz import EskizError, default_client
from sms.templates import is_gsm_safe


class Command(BaseCommand):
    help = (
        "eskiz.uz: the balance, the approved sender names and every template, exactly as eskiz holds it "
        "(repr, so a stray space shows). Read-only. Logs in only when no token is cached — the account "
        "is shared with lc-up."
    )

    def handle(self, *args, **options):
        if not conf.is_configured():
            raise CommandError("ESKIZ_EMAIL / ESKIZ_SECRET_KEY are not set")
        client = default_client()
        try:
            balance, nicks, templates = client.balance(), client.nicks(), client.templates()
        except EskizError as exc:
            raise CommandError(str(exc))
        self.stdout.write(f"balance: {balance}")
        self.stdout.write(f"sender names: {json.dumps(nicks, ensure_ascii=False)}")
        for row in templates:
            text = str(row.get("original_text") or row.get("template") or "")
            warning = "" if is_gsm_safe(text) else "  ! not plain ASCII: 70 characters a part, about twice the price"
            self.stdout.write(f"#{row.get('id')} [{row.get('status')}]{warning}\n{text!r}")
```

`backend/sms/management/commands/sms_test.py`:
```python
import uuid

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from lcup.phones import normalize_phone
from sms import conf
from sms import templates as T
from sms.delivery import deliver
from sms.eskiz import default_client
from sms.models import SmsMessage


class Command(BaseCommand):
    help = "The debt warning filled with sample values; with --send, one real SMS to --phone (logged as a test)."

    def add_arguments(self, parser):
        parser.add_argument("--phone", required=True)
        parser.add_argument("--send", action="store_true", help="really send it; without this only print it")

    def handle(self, *args, **options):
        phone = normalize_phone(options["phone"])
        if not phone:
            raise CommandError("not an Uzbek phone number (998XXXXXXXXX)")
        if T.DEBT_WARNING is None:
            raise CommandError("no approved template yet: copy it in from manage.py eskiz_account")
        text = T.render(T.DEBT_WARNING, T.SAMPLE_VALUES)
        plain = "plain" if T.is_gsm_safe(text) else "NOT plain"
        self.stdout.write(f"{text}\n({len(text)} characters, {plain} ASCII)")
        if not options["send"]:
            self.stdout.write("not sent: add --send")
            return
        if not conf.is_configured():
            raise CommandError("ESKIZ_EMAIL / ESKIZ_SECRET_KEY are not set")
        msg = deliver(
            default_client(), kind=SmsMessage.KIND_TEST, run_on=timezone.localdate(),
            dedupe_key=f"test:{uuid.uuid4().hex[:16]}", phone=phone, text=text,
        )
        self.stdout.write(f"{msg.status} {msg.request_id} {msg.error}".strip())
```

`backend/sms/management/commands/sms_debt_warnings_report.py`:
```python
import json
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from sms.debt_warnings import plan
from sms.delivery import mask_phone


class Command(BaseCommand):
    help = "Who the debt warning would reach (today, or --day), phones masked. Sends nothing, changes nothing."

    def add_arguments(self, parser):
        parser.add_argument("--day", help="preview another day, YYYY-MM-DD (balances are still judged as of now)")

    def handle(self, *args, **options):
        try:
            day = date.fromisoformat(options["day"]) if options["day"] else None
        except ValueError:
            raise CommandError("--day must be YYYY-MM-DD")
        planned = plan(timezone.now(), today=day)
        report = {
            "blocked": planned.blocked,
            "skipped": planned.skipped,
            "warnings": [
                {
                    "lcup_student_id": w.link.lcup_student_id,
                    "name": w.link.name,
                    "phone": mask_phone(w.phone),
                    "debt": int(abs(w.link.balance)),
                    "text": w.text,
                }
                for w in planned.warnings
            ],
        }
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command from Step 2. Expected: `OK` (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/sms/management backend/sms/tests_commands.py
git commit -m "feat(sms): commands for the rollout: eskiz account, a test SMS, the dry-run list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification, PR, and the rollout (the approved template comes in last)

**Files:**
- Modify (rollout only, after the owner has added the keys): `backend/sms/templates.py` (`DEBT_WARNING`), `backend/sms/tests_templates.py` (a test for the real text)

- [ ] **Step 1: The whole new app, plus the lc-up suite the refactor touches**

Run: the test command with labels `sms lcup`. Expected: `OK`. Copy the test count and the `OK` line into the PR.

- [ ] **Step 2: The migration on real Postgres** (memory `local-postgres-verify-orm-sql`: a throwaway cluster in the scratchpad, TCP port 55432)

Run: `cd backend && DATABASE_URL=postgres://dsat_probe@127.0.0.1:55432/postgres SECRET_KEY=test-secret DEBUG=True <python with psycopg2> manage.py migrate sms`
Expected: `Applying sms.0001_initial... OK`.

Then run `manage.py test sms` the same way. Expected: `Creating test database for alias 'default' ('test_postgres')`, then `OK`.

- [ ] **Step 3: Graph, push, PR**

```bash
graphify update .
git push -u origin HEAD:refs/heads/feat/eskiz-sms-debt-warnings
gh pr create --base main --title "SMS through eskiz.uz: the warning before the debt freeze (days 1-5)" --body "<summary, test evidence, the rollout below>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Rollout** (each step only after the owner's go-ahead)

1. **Deploy with zero downtime.** There is a migration, so migrate first, then do the blue-green switch (memory `zero-downtime-full-release-switch`). Celery beat must restart to pick up the two new entries.
2. **Keys.** The owner adds `ESKIZ_EMAIL` and `ESKIZ_SECRET_KEY` to `/var/www/satapp/shared/backend.env`, plus `ESKIZ_FROM` if `eskiz_account` shows an approved name. Reload gunicorn and the celery worker and beat so they read the env.
3. **First login.** Run `manage.py eskiz_account` on prod. **Right after it, the owner sends one SMS from lc-up.** If lc-up fails, STOP and do not log in again.
4. **Template.** Copy the debt-warning template into `DEBT_WARNING` exactly as printed: the text between the `repr` quotes, with the slot names in order. Add a test that renders it with `SAMPLE_VALUES`. Commit, then hot-patch: code-only, no migration (memory `zero-downtime-code-only-hotpatch`).
5. **Test SMS.** Run `manage.py sms_test --phone 998880032508 --send` (the owner's test number). The owner confirms it arrived.
6. **Dry run.** Run `manage.py sms_debt_warnings_report --day 2026-11-01` and show the owner the masked list.
7. **Switch on.** On the owner's yes, set `SMS_DEBT_WARNINGS_ENABLED=True` in `backend.env` and reload the celery worker. The first real run is **2026-11-01 10:00**. Check `SmsMessage` that morning, and again at 11:30 for delivery.
