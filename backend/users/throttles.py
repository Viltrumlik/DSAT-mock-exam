"""Throttles for the email verification flow.

Rates come from ``REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']`` (see settings); a ``None``
rate disables one. ``DEFAULT_THROTTLE_CLASSES`` is empty, so throttling is opt-in per
view — the same convention as ``classes.throttles`` and ``assessments.throttles``.
"""
from __future__ import annotations

import hashlib

from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


def _target_email(request) -> str:
    try:
        return str((request.data or {}).get("email") or "").strip().lower()
    except Exception:
        # request.data can raise on a malformed body; a throttle must never 500 the view.
        return ""


class EmailVerifyPerTargetThrottle(SimpleRateThrottle):
    """Caps how often a code may be sent to one address, whoever asks.

    Keyed on the *target mailbox*, not the requester. Per-user throttling caps one
    attacker account while the resource being consumed is someone else's inbox — N
    accounts each asking 5 times an hour at one victim is unbounded. Per-IP is wrong in
    both directions here: students share school NAT (over-blocks a whole class) and an
    attacker rotates addresses (under-blocks).
    """

    scope = "email_verify_target"

    def get_cache_key(self, request, view):
        email = _target_email(request)
        if not email:
            return None  # nothing to key on; the view rejects the empty body anyway
        # Normalize before hashing or "Foo@x.com" and "foo@x.com" get separate buckets.
        # Hashed because throttle keys land in a shared Redis that is not the place to
        # accumulate a plaintext list of every address anyone tried to verify.
        ident = hashlib.sha256(email.encode("utf-8")).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class EmailVerifyPerUserThrottle(UserRateThrottle):
    """Caps how many codes one account may request, across all target addresses.

    Stacked with the per-target throttle: that one protects mailboxes, this one stops a
    single account from walking a list of candidate addresses to find which exist.
    """

    scope = "email_verify_user"


class EmailConfirmThrottle(UserRateThrottle):
    """Caps code submissions per account.

    ``EmailClaim.attempts`` already burns a claim after 5 wrong guesses, but that is
    per-claim: without this an attacker could request a fresh code and keep guessing
    indefinitely. This bounds the total rate regardless of how many claims they open.
    """

    scope = "email_verify_confirm"
