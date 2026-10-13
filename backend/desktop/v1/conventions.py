"""What every /api/desktop/v1/ endpoint shares: the kill switch, the error envelope, the clock
format, and the parsing of the sync/submit body.

Wire rules (``desktop-native/contracts/v1/README.md``):

* every body carries ``"schema": 1``; errors are ``{"code", "detail", ...}`` — lockdown refusals
  keep their existing ``{detail, reason, desktop_required}`` shape and DRF's 401/429 stay DRF's;
* timestamps are ISO-8601 UTC with milliseconds and a ``Z``; durations are milliseconds;
* ids used as JSON object keys are decimal strings.
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field

from django.conf import settings
from django.http import Http404
from rest_framework import exceptions as drf_exceptions
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from config.reliability import idempotency_key_from_request
from mobile.versioning import PLATFORM_WINDOWS, Version, parse_client_header

SCHEMA = 1

#: How long the app waits before asking for a result again while the paper is being scored.
POLL_AFTER_MS = 2000

#: Longest idempotency key the key tables can hold (``AttemptIdempotencyKey.key``).
MAX_IDEMPOTENCY_KEY = 128

#: An answer is a letter or a grid-in string. Generous on purpose — the website accepts what it
#: accepts and v1 must never refuse a student's answer over its spelling — but bounded, so a
#: crafted body cannot park megabytes in an attempt row.
MAX_ANSWER_CHARS = 32
MAX_ANSWERS_PER_MODULE = 500

_DIGITS = re.compile(r"^[0-9]{1,12}$")


# ── settings ─────────────────────────────────────────────────────────────────────────────
def enabled() -> bool:
    return bool(getattr(settings, "DESKTOP_V1_ENABLED", False))


def ship_module_2() -> bool:
    return bool(getattr(settings, "DESKTOP_V1_SHIP_MODULE_2", True))


def pastpaper_media_ttl() -> int:
    return max(60, int(getattr(settings, "DESKTOP_MEDIA_URL_TTL_SECONDS", 21600) or 21600))


def midterm_media_ttl() -> int:
    return max(60, int(getattr(settings, "DESKTOP_MIDTERM_MEDIA_URL_TTL_SECONDS", 900) or 900))


# ── clock ────────────────────────────────────────────────────────────────────────────────
def iso(value: _dt.datetime | None) -> str | None:
    """``2026-10-11T09:00:00.000Z`` — the one timestamp format v1 speaks."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=_dt.timezone.utc)
    value = value.astimezone(_dt.timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def iso_from_string(raw: str | None) -> str | None:
    """Re-format a timestamp another view already rendered with ``isoformat()``."""
    if not raw:
        return None
    try:
        return iso(_dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")))
    except ValueError:
        return str(raw)


def iso_date(value: _dt.date | None) -> str | None:
    return value.isoformat() if value is not None else None


def ms(delta: _dt.timedelta) -> int:
    return int(delta.total_seconds() * 1000)


# ── errors ───────────────────────────────────────────────────────────────────────────────
class V1Error(Exception):
    """An error answer in the v1 envelope. Raised anywhere under a ``V1APIView``."""

    def __init__(self, http_status: int, body: dict, *, headers: dict | None = None):
        super().__init__(body.get("detail") or body.get("code") or str(http_status))
        self.http_status = int(http_status)
        self.body = body
        self.headers = headers or {}

    def response(self) -> Response:
        return Response(self.body, status=self.http_status, headers=self.headers)


def error(http_status: int, code: str, detail: str, **extra) -> V1Error:
    body = {"code": code, "detail": detail}
    body.update(extra)
    return V1Error(http_status, body)


NOT_VISIBLE_DETAIL = "This test is not available to you."


def not_visible(detail: str = NOT_VISIBLE_DETAIL) -> V1Error:
    return error(status.HTTP_404_NOT_FOUND, "not_visible", detail)


def bad_request(detail: str) -> V1Error:
    return error(status.HTTP_400_BAD_REQUEST, "bad_request", detail)


def forbidden(detail: str, **extra) -> V1Error:
    return error(status.HTTP_403_FORBIDDEN, "forbidden", detail, **extra)


def state_conflict(attempt_lite: dict, detail: str = "The attempt is no longer in that state.") -> V1Error:
    return error(status.HTTP_409_CONFLICT, "state_conflict", detail, attempt=attempt_lite)


def lockdown_refusal(response: Response) -> V1Error:
    """A ``desktop.lockdown`` refusal, passed through with its body untouched: lockdown
    refusals keep ``{detail, reason, desktop_required}`` (no ``code``) on every surface, so
    the app has one re-bind flow for the website's endpoints and v1's alike."""
    return V1Error(int(response.status_code), dict(response.data or {}))


def disabled() -> V1Error:
    return V1Error(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        {"code": "desktop_v1_disabled", "detail": "The desktop API is switched off."},
        # The app's outbox honours Retry-After on a 503; a switched-off API is not coming back
        # in a second, so don't let a classroom of laptops hammer it.
        headers={"Retry-After": "300"},
    )


class V1APIView(APIView):
    """Base view: the kill switch first, then auth, then the v1 error envelope."""

    def initial(self, request, *args, **kwargs):
        # Before authentication: a switched-off API says so to everyone, signed in or not.
        if not enabled():
            raise disabled()
        super().initial(request, *args, **kwargs)
        # The app is the learning center's; a learner who left it keeps their tokens until the
        # next sign-in, so every v1 call asks again (plan 2026-10-13).
        from users.audience import NATIVE_APP_REFUSAL, is_public_learner

        if is_public_learner(request.user):
            raise forbidden(NATIVE_APP_REFUSAL)

    def handle_exception(self, exc):
        if isinstance(exc, V1Error):
            return exc.response()
        if isinstance(exc, (Http404, drf_exceptions.NotFound)):
            return not_visible().response()
        if isinstance(exc, drf_exceptions.ParseError):
            return bad_request("The body must be valid JSON.").response()
        if isinstance(exc, drf_exceptions.UnsupportedMediaType):
            return bad_request("Send the body as application/json.").response()
        if isinstance(exc, drf_exceptions.PermissionDenied) and not isinstance(
            exc, (drf_exceptions.NotAuthenticated, drf_exceptions.AuthenticationFailed)
        ):
            # Signed in but not allowed (e.g. an account without the test-taking permission).
            # 401s and 429s stay DRF's own: the app refreshes on the one and honours
            # Retry-After on the other.
            return forbidden(str(getattr(exc, "detail", "") or "You do not have permission to do this.")).response()
        return super().handle_exception(exc)


def ok(body: dict, *, http_status: int = status.HTTP_200_OK, headers: dict | None = None) -> Response:
    payload = {"schema": SCHEMA}
    payload.update(body)
    return Response(payload, status=http_status, headers=headers)


# ── request parsing ──────────────────────────────────────────────────────────────────────
def require_idempotency_key(request) -> str:
    key = idempotency_key_from_request(request)
    if not key:
        raise bad_request("The Idempotency-Key header is required.")
    if len(key) > MAX_IDEMPOTENCY_KEY:
        raise bad_request("The Idempotency-Key header is too long.")
    return key


def client_version(request) -> Version | None:
    """The build in ``X-MasterSAT-Client: windows/<semver>``; None for anything else."""
    declared = parse_client_header(request.META.get("HTTP_X_MASTERSAT_CLIENT"))
    if declared is None or declared[0] != PLATFORM_WINDOWS:
        return None
    return declared[1]


def _as_int(value, name: str) -> int:
    if isinstance(value, bool):
        raise bad_request(f"{name} must be an integer.")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and _DIGITS.match(value.strip()):
        return int(value.strip())
    raise bad_request(f"{name} must be an integer.")


@dataclass(frozen=True)
class SyncBody:
    """``{module_id, seq, answers: {qid: value}, flagged: [qid]}`` — sync and submit share it."""

    module_id: int
    seq: int
    answers: dict[str, str] = field(default_factory=dict)
    flagged: list[int] = field(default_factory=list)

    def answers_for(self, question_ids: set[int]) -> dict[str, str]:
        """Only the answers to this module's questions; ``""`` (cleared) entries kept."""
        return {k: v for k, v in self.answers.items() if int(k) in question_ids}

    def flagged_for(self, question_ids: set[int]) -> list[int]:
        return [q for q in self.flagged if q in question_ids]


def parse_sync_body(data) -> SyncBody:
    if not isinstance(data, dict):
        raise bad_request("The body must be a JSON object.")
    module_id = _as_int(data.get("module_id"), "module_id")
    seq = _as_int(data.get("seq", 0), "seq")
    raw_answers = data.get("answers")
    raw_answers = {} if raw_answers is None else raw_answers
    if not isinstance(raw_answers, dict):
        raise bad_request("answers must be an object of question id to answer.")
    if len(raw_answers) > MAX_ANSWERS_PER_MODULE:
        raise bad_request("Too many answers.")
    answers: dict[str, str] = {}
    for key, value in raw_answers.items():
        if not _DIGITS.match(str(key)):
            raise bad_request("answers keys must be question ids.")
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise bad_request("Each answer must be a string.")
        value = value.strip()
        if len(value) > MAX_ANSWER_CHARS:
            raise bad_request("An answer is too long.")
        answers[str(int(key))] = value
    raw_flagged = data.get("flagged")
    raw_flagged = [] if raw_flagged is None else raw_flagged
    if not isinstance(raw_flagged, list) or len(raw_flagged) > MAX_ANSWERS_PER_MODULE:
        raise bad_request("flagged must be a list of question ids.")
    flagged: list[int] = []
    for item in raw_flagged:
        qid = _as_int(item, "flagged")
        if qid not in flagged:
            flagged.append(qid)
    return SyncBody(module_id=module_id, seq=seq, answers=answers, flagged=flagged)


def parse_have(raw) -> dict[str, str]:
    """``have`` from a body: ``{"301": "sha256:…"}``. Anything malformed is simply ignored."""
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if _DIGITS.match(str(k)) and isinstance(v, str)}


def parse_have_query(raw: str | None) -> dict[str, str]:
    """``?have=301:sha256:…,302:sha256:…`` — each item splits on its FIRST colon."""
    out: dict[str, str] = {}
    for item in (raw or "").split(","):
        mid, sep, digest = item.strip().partition(":")
        if sep and _DIGITS.match(mid) and digest:
            out[mid] = digest
    return out
