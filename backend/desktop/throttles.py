"""Throttles for the Windows app's password sign-in (``DesktopPasswordLoginView``).

Two, stacked. Per address (``ScopedRateThrottle``, scope ``desktop_login``) with headroom for a
whole class signing in at once from behind one school NAT — and this one, per account, which is
what actually bounds guessing one student's password: an attacker can change addresses, not the
account they are after.
"""

from __future__ import annotations

import hashlib
import re

from rest_framework.throttling import SimpleRateThrottle

from users.backends import _phone_username

_RATE_RE = re.compile(r"^\s*(\d+)\s*/\s*(\d*)\s*([smhd])\w*\s*$")
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def login_identifier(request) -> str:
    """The identifier the app typed (``identifier``, or ``email`` as an alias), stripped."""
    try:
        data = request.data or {}
        raw = data.get("identifier")
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            raw = data.get("email")
    except Exception:
        # request.data can raise on a malformed body; a throttle must never 500 the view.
        return ""
    return raw.strip() if isinstance(raw, str) else ""


class DesktopLoginPerIdentifierThrottle(SimpleRateThrottle):
    """Caps sign-in tries against one account, whoever asks and from wherever.

    Keyed on the account the identifier names, normalised the way login reads it: case does not
    matter, and a phone typed as "+998 90 123-45-67" or "901234567" is the same account as
    "998901234567" — otherwise every way of typing a phone would be a fresh bucket of guesses.
    Hashed, like ``users.throttles.EmailVerifyPerTargetThrottle``, so the shared cache does not
    collect a plaintext list of every login anyone tried.

    The rate takes a multiple of the unit ("10/15m"), which DRF's own parser does not.
    """

    scope = "desktop_login_identifier"

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        match = _RATE_RE.match(str(rate))
        if not match:
            return super().parse_rate(rate)
        num, multiple, unit = match.groups()
        return (int(num), int(multiple or 1) * _UNIT_SECONDS[unit])

    def get_cache_key(self, request, view):
        typed = login_identifier(request)
        if not typed:
            return None  # nothing to key on; the view refuses the empty body anyway
        key = _phone_username(typed) or typed.lower()
        ident = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}
