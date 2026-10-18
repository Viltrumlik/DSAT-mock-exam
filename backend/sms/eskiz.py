"""The only door to eskiz.uz, the SMS gateway (https://documenter.getpostman.com/view/663428/RzfmES4z).

**The eskiz account is shared with lc-up**, and whether a new login revokes the token lc-up holds is
not documented. So we log in as rarely as we can: one token in the shared cache (Redis in
production) for TOKEN_TTL — eskiz's live 30 days — and a new login only when there is none, or eskiz
refused the one we sent; then under a lock, so exactly one process logs in and the rest wait.

**A send is never retried once it may have reached eskiz.** ``/message/sms/send`` has no idempotency
key: a read timeout or a 5xx can mean "sent", and a second try would put the same SMS on a parent's
phone twice. Those come back UNCERTAIN. Only a refused token (401, or the older backend's 500
"Token has expired") is retried, once — eskiz did not take that request.

**A refused login is not repeated for LOGIN_BACKOFF.** A wrong or rotated key would otherwise be
tried once per SMS — 150 refused logins in a minute on an account lc-up shares.

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
LOGIN_REFUSED_KEY = "eskiz:login-refused"
#: After eskiz refuses our login (or a token it has just issued) nobody asks again for this long.
LOGIN_BACKOFF = 10 * 60
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
    # Only eskiz's own words: any other 500 may have come after it took the SMS.
    return resp.status_code == 500 and "token has expired" in _message(resp).lower()


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
        self._refused_fresh_token()
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
        self._refused_fresh_token()
        raise EskizAuthError("eskiz refused a freshly issued token")

    # ── token ─────────────────────────────────────────────────────────────

    def _token(self, stale: str | None = None) -> str:
        token = self.cache.get(TOKEN_KEY)
        if token and token != stale:
            return token
        if self.cache.get(LOGIN_REFUSED_KEY):
            raise EskizAuthError("eskiz refused our login a few minutes ago; not asking again yet")
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
            self.cache.set(LOGIN_REFUSED_KEY, "1", timeout=LOGIN_BACKOFF)
            raise EskizAuthError(_mask(f"eskiz refused the login ({resp.status_code}): {_message(resp)}"))
        self.cache.delete(LOGIN_REFUSED_KEY)
        return token

    def _refused_fresh_token(self) -> None:
        self.cache.delete(TOKEN_KEY)
        self.cache.set(LOGIN_REFUSED_KEY, "1", timeout=LOGIN_BACKOFF)

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
