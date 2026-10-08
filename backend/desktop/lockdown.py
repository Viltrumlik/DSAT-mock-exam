"""Binding a midterm sitting to the Windows app's locked-down window.

The rule, in one place:

* While ``MIDTERM_DESKTOP_REQUIRED`` is on, a midterm that has not started can only be started
  from the app, and once the app has opened a session on a sitting, every request about it —
  the snapshot that carries the questions, autosave, submit, the off-screen report — must carry
  that session's token in ``X-Lockdown-Session``. Chrome, a second laptop, a phone: none of them
  holds the token, so none of them sees a question.
* A student with a live ``DesktopExemption`` is outside the rule, read at request time — so a
  teacher can rescue a sitting whose laptop died by granting one mid-paper.
* Turning the flag off releases every sitting at once. It is the rollback lever, so it must not
  leave anybody locked to an app that is misbehaving.
* A sitting that started before the flag went on is left alone.

How the app gets a token (each step its own request, so a retried request never replays a
cached token — ``start`` sits behind an idempotency cache, which is why this is not in it):

    challenge  POST desktop_challenge/  → a nonce, good for CHALLENGE_TTL_SECONDS, once
    proof      the app, already locked down, signs (attempt, nonce, version, pre-check)
    session    POST desktop_session/    → verifies, replaces any older token, returns the new one

Reads of a sitting that has not started stay open: that snapshot has no questions, and it is
how the browser learns to say "open this in the app" instead of showing a Start button.
"""

from __future__ import annotations

import hmac
import json
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from midterms.state_machine import STATE_ACTIVE, STATE_MODULE_2_ACTIVE, STATE_NOT_STARTED
from mobile.policy import get_policy
from mobile.versioning import PLATFORM_WINDOWS, parse_version

from .models import DesktopExemption, MidtermLockdown
from .proof import MAX_PRECHECK_CHARS, new_secret, sha256_hex, verify

logger = logging.getLogger(__name__)

HEADER = "X-Lockdown-Session"
_HEADER_META = "HTTP_X_LOCKDOWN_SESSION"

CHALLENGE_TTL_SECONDS = 60

#: States in which a sitting's requests are policed. Once the paper is in (scoring, completed,
#: abandoned) there is nothing left to protect, and the result screen must load anywhere.
_LIVE_STATES = (STATE_NOT_STARTED, STATE_ACTIVE, STATE_MODULE_2_ACTIVE)
_RUNNING_STATES = (STATE_ACTIVE, STATE_MODULE_2_ACTIVE)

REASON_REQUIRED = "desktop_required"
REASON_SESSION_REPLACED = "desktop_session_replaced"
REASON_CHALLENGE = "desktop_challenge_invalid"
REASON_PROOF = "desktop_proof_invalid"
REASON_UPDATE = "desktop_update_required"
REASON_NOT_LIVE = "desktop_not_live"

_DETAIL = {
    REASON_REQUIRED: "This midterm can only be taken in the MasterSAT app for Windows.",
    REASON_SESSION_REPLACED: "This midterm was opened in another MasterSAT window. Continue there.",
    REASON_CHALLENGE: "The app's check expired. Try again.",
    REASON_PROOF: "The app could not prove it is locked down. Restart the MasterSAT app and try again.",
    REASON_UPDATE: "Update the MasterSAT app to take this midterm.",
    REASON_NOT_LIVE: "This midterm is no longer running.",
}


def rule_enabled() -> bool:
    return bool(getattr(settings, "MIDTERM_DESKTOP_REQUIRED", False))


def _keys() -> dict[str, str]:
    return dict(getattr(settings, "DESKTOP_PROOF_KEYS", {}) or {})


def is_exempt(student) -> bool:
    return DesktopExemption.objects.filter(student=student, revoked_at__isnull=True).exists()


def _lockdown_of(attempt) -> MidtermLockdown | None:
    return MidtermLockdown.objects.filter(attempt_id=attempt.pk).first()


def applies_to(attempt) -> bool:
    """Whether requests about this sitting must come from the app's locked-down window."""
    if not rule_enabled():
        return False
    if attempt.current_state not in _LIVE_STATES:
        return False
    if is_exempt(attempt.student):
        return False
    if attempt.current_state == STATE_NOT_STARTED:
        return True
    lockdown = _lockdown_of(attempt)
    return bool(lockdown and lockdown.required)


def _refuse(reason: str, *, http_status: int = status.HTTP_403_FORBIDDEN, **extra) -> Response:
    body = {"detail": _DETAIL[reason], "reason": reason, "desktop_required": True}
    body.update(extra)
    return Response(body, status=http_status)


def refusal(request, attempt, *, reading: bool = False) -> Response | None:
    """A 403 for a request about a bound sitting that lacks its live token; ``None`` to proceed."""
    if reading and attempt.current_state not in _RUNNING_STATES:
        return None
    if not applies_to(attempt):
        return None
    presented = str(request.META.get(_HEADER_META) or "").strip()
    lockdown = _lockdown_of(attempt)
    expected = lockdown.session_hash if lockdown else ""
    if presented and expected and hmac.compare_digest(sha256_hex(presented), expected):
        return None
    if presented and expected:
        # A token that WAS this sitting's: a newer session replaced it — the app was reopened,
        # or the paper was opened on another machine.
        return _refuse(REASON_SESSION_REPLACED)
    return _refuse(REASON_REQUIRED)


def issue_challenge(attempt) -> Response:
    if attempt.current_state not in _LIVE_STATES:
        return _refuse(REASON_NOT_LIVE, http_status=status.HTTP_409_CONFLICT)
    nonce = new_secret()
    lockdown, _ = MidtermLockdown.objects.get_or_create(attempt=attempt)
    MidtermLockdown.objects.filter(pk=lockdown.pk).update(
        nonce_hash=sha256_hex(nonce),
        nonce_expires_at=timezone.now() + timedelta(seconds=CHALLENGE_TTL_SECONDS),
    )
    return Response({"nonce": nonce, "expires_in": CHALLENGE_TTL_SECONDS})


def _parse_precheck(raw: str) -> dict | None:
    if len(raw) > MAX_PRECHECK_CHARS:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def open_session(attempt, data) -> Response:
    """Verify the app's proof and hand it this sitting's (new) session token."""
    if attempt.current_state not in _LIVE_STATES:
        return _refuse(REASON_NOT_LIVE, http_status=status.HTTP_409_CONFLICT)
    nonce = str(data.get("nonce") or "")
    key_id = str(data.get("key_id") or "")
    mac = str(data.get("mac") or "")
    app_version = str(data.get("app_version") or "")[:32]
    precheck_raw = data.get("precheck")
    precheck_raw = precheck_raw if isinstance(precheck_raw, str) else ""

    with transaction.atomic():
        lockdown = MidtermLockdown.objects.select_for_update().filter(attempt_id=attempt.pk).first()
        if lockdown is None:
            return _refuse(REASON_CHALLENGE)
        fresh = (
            bool(nonce)
            and bool(lockdown.nonce_hash)
            and lockdown.nonce_expires_at is not None
            and lockdown.nonce_expires_at >= timezone.now()
            and hmac.compare_digest(sha256_hex(nonce), lockdown.nonce_hash)
        )
        # Spent on any answer, right or wrong: a nonce is one guess, not a target to retry at.
        lockdown.nonce_hash = ""
        lockdown.nonce_expires_at = None
        if not fresh:
            lockdown.save(update_fields=["nonce_hash", "nonce_expires_at", "updated_at"])
            return _refuse(REASON_CHALLENGE)

        minimum = get_policy(PLATFORM_WINDOWS).minimum
        declared = parse_version(app_version)
        if minimum is not None and declared is not None and declared < minimum:
            lockdown.save(update_fields=["nonce_hash", "nonce_expires_at", "updated_at"])
            return _refuse(REASON_UPDATE, http_status=426)

        precheck = _parse_precheck(precheck_raw)
        proven = precheck is not None and verify(
            keys=_keys(),
            key_id=key_id,
            mac=mac,
            attempt_id=attempt.pk,
            nonce=nonce,
            app_version=app_version,
            precheck=precheck_raw,
        )
        if not proven:
            lockdown.save(update_fields=["nonce_hash", "nonce_expires_at", "updated_at"])
            logger.warning(
                "[FORENSIC] desktop_proof_rejected attempt_id=%s key_id=%s app_version=%s",
                attempt.pk, key_id[:32], app_version,
            )
            return _refuse(REASON_PROOF)

        token = new_secret()
        lockdown.session_hash = sha256_hex(token)
        lockdown.session_opened_at = timezone.now()
        lockdown.sessions_opened = int(lockdown.sessions_opened or 0) + 1
        lockdown.app_version = app_version
        lockdown.key_id = key_id[:32]
        lockdown.precheck = precheck
        # Bound for good once the rule applied at the moment the app took the paper; a session
        # opened while the flag was off is the app being used by choice, and binds nothing.
        lockdown.required = bool(lockdown.required or applies_to(attempt))
        lockdown.save()

    return Response({"lockdown_session": token, "required": lockdown.required})
