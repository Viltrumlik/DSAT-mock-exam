"""The only door to lc-up.

**Every login revokes the previous tokens of the integration user.** Several gunicorn workers and
the Celery worker all talk to lc-up; if each logged in for itself they would knock each other's
tokens out all day. So the token lives in the shared cache (Redis in production) and a login
happens only when there is none, or the one we just sent was refused — and then under a lock, so
exactly one process logs in and the rest wait for its token.

**The limits are lc-up's, enforced on our side** so we never meet them: 60 requests a minute per
user (we stop at 55) and 2 requests at once per centre (two cache slots). 429/503 answers carry
``Retry-After`` and are honoured.

**There is no generic ``post()``.** The only write this client can make is the login. lc-up's
``POST /attendance`` charges a student's fee and messages their parents; nothing in this part of
the integration may be able to send it by accident.
"""

from __future__ import annotations

import re
import time

import requests
from django.core.cache import cache as default_cache

from . import conf

TOKEN_KEY = "lcup:token"
LOCK_KEY = "lcup:login-lock"
RPM_KEY = "lcup:rpm:{minute}"
SLOT_KEYS = ("lcup:slot:0", "lcup:slot:1")
REQUESTS_PER_MINUTE = 55
TIMEOUT = (5, 20)
MAX_RETRIES = 3
MAX_RETRY_AFTER = 60
LOGIN_WAIT_SECONDS = 30


class LcupError(Exception):
    pass


class LcupAuthError(LcupError):
    """lc-up refused our credentials, or refused a token it had just issued."""


class LcupUnavailable(LcupError):
    """lc-up could not be reached, or kept answering 5xx/429 after the retries."""


def _refusal_reason(resp) -> str:
    """lc-up's own words for a refused login, for the admin's run log. Any long number is masked:
    the message may quote back the phone we sent."""
    try:
        body = resp.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    message = body.get("message") if isinstance(body.get("message"), str) else ""
    fields = sorted(body["errors"]) if isinstance(body.get("errors"), dict) else []
    reason = re.sub(r"\d{5,}", "…", message.strip())[:160]
    if fields:
        reason = f"{reason} [{', '.join(fields)}]".strip()
    return f": {reason}" if reason else ""


def _retry_after(resp, attempt: int) -> float:
    raw = resp.headers.get("Retry-After")
    try:
        return min(int(raw), MAX_RETRY_AFTER)
    except (TypeError, ValueError):
        return min(2 ** attempt, MAX_RETRY_AFTER)


class LcupClient:
    def __init__(self, *, base_url, domain, mobile, password, session=None, cache=None, sleep=time.sleep, clock=time.time):
        self.base_url = (base_url or "").rstrip("/")
        self._creds = {"mobile_number": mobile, "password": password, "domain": domain}
        self.session = session or requests.Session()
        self.cache = cache or default_cache
        self.sleep = sleep
        self.clock = clock

    # ── public ────────────────────────────────────────────────────────────

    def get(self, path: str, params: dict | None = None) -> dict:
        token = self._token()
        refreshed = False
        for attempt in range(MAX_RETRIES + 1):
            resp = self._send("GET", path, params=params, token=token)
            if resp.status_code == 401:
                if refreshed:
                    raise LcupAuthError("lc-up refused a freshly issued token")
                token = self._token(stale=token)
                refreshed = True
                continue
            if resp.status_code in (409, 429) or resp.status_code >= 500:
                if attempt == MAX_RETRIES:
                    raise LcupUnavailable(f"lc-up answered {resp.status_code} on {path}")
                self.sleep(_retry_after(resp, attempt))
                continue
            if resp.status_code >= 400:
                raise LcupError(f"lc-up answered {resp.status_code} on {path}")
            return resp.json()
        raise LcupUnavailable(f"lc-up gave up on {path}")

    def fetch_all(self, path: str, params: dict | None = None) -> list[dict]:
        """Every row behind a cursor-paged list. Raises on any failed page: a partial list would
        read as "these are all the students", and the sync removes people on that basis."""
        params = dict(params or {}, per_page=200)
        rows: list[dict] = []
        while True:
            body = self.get(path, params)
            rows.extend(body.get("data") or [])
            cursor = (body.get("meta") or {}).get("next_cursor")
            if not cursor:
                return rows
            params["cursor"] = cursor

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
                self.cache.set(TOKEN_KEY, token, timeout=None)
                return token
            finally:
                self.cache.delete(LOCK_KEY)
        for _ in range(LOGIN_WAIT_SECONDS):
            self.sleep(1)
            token = self.cache.get(TOKEN_KEY)
            if token and token != stale:
                return token
        raise LcupUnavailable("timed out waiting for another process to log in to lc-up")

    def _login(self) -> str:
        resp = self._send("POST", "/api/dev/login", json=self._creds, token=None)
        if resp.status_code != 200:
            self.cache.delete(TOKEN_KEY)
            raise LcupAuthError(f"lc-up refused the login ({resp.status_code}){_refusal_reason(resp)}")
        token = ((resp.json() or {}).get("data") or {}).get("access_token")
        if not isinstance(token, str) or not token:
            raise LcupAuthError("lc-up login returned no access_token")
        return token

    # ── transport ─────────────────────────────────────────────────────────

    def _send(self, method, path, *, params=None, json=None, token):
        self._pace()
        slot = self._acquire_slot()
        try:
            headers = {"Accept": "application/json"}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            try:
                return self.session.request(
                    method, self.base_url + path, params=params, json=json, headers=headers, timeout=TIMEOUT
                )
            except requests.RequestException as exc:
                # The exception text can carry the URL; the type is all the caller needs.
                raise LcupUnavailable(f"lc-up unreachable: {type(exc).__name__}") from None
        finally:
            self.cache.delete(slot)

    def _pace(self) -> None:
        now = self.clock()
        minute = int(now // 60)
        key = RPM_KEY.format(minute=minute)
        self.cache.add(key, 0, timeout=120)
        try:
            count = self.cache.incr(key)
        except ValueError:  # evicted between add and incr
            self.cache.set(key, 1, timeout=120)
            count = 1
        if count > REQUESTS_PER_MINUTE:
            self.sleep((minute + 1) * 60 - now + 0.05)

    def _acquire_slot(self) -> str:
        for _ in range(240):
            for key in SLOT_KEYS:
                if self.cache.add(key, "1", timeout=30):
                    return key
            self.sleep(0.25)
        raise LcupUnavailable("no free lc-up request slot")


def default_client() -> LcupClient:
    return LcupClient(**conf.credentials())
