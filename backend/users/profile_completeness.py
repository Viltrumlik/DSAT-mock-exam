"""What "your profile is complete" means, in one place.

The rule is deliberately structural — a field is missing when it is blank or shorter
than three characters, full stop. No "and it must not be the literal string Telegram",
no "and the last name must differ from the first".

That restraint is the whole design. A heuristic in the live predicate cannot be
satisfied by the person it fires on: someone genuinely named "Aziz Aziz" would fill the
form, submit, and still be told their profile is incomplete, forever, with no way to
learn why. Legacy rows carrying fabricated names are cleaned up once, in migration
0024, so the simple rule is enough afterwards.

Serializers and the frontend both read this. The frontend never recomputes it — it
renders whatever ``missing_fields`` says — so the two cannot drift.
"""
from __future__ import annotations

from users.email_utils import is_synthetic_email

#: Order matters: it is the order the completion form asks for them.
REQUIRED_PROFILE_FIELDS = ("first_name", "last_name", "username", "email")

#: Matches the min length the serializers already enforce on these fields.
MIN_IDENTITY_LEN = 3


def _too_short(value) -> bool:
    return len(str(value or "").strip()) < MIN_IDENTITY_LEN


def email_is_usable(user) -> bool:
    """A real, confirmed address — not a Telegram or released placeholder."""
    email = getattr(user, "email", "") or ""
    if not email.strip() or is_synthetic_email(email):
        return False
    return bool(getattr(user, "email_verified", False))


def missing_profile_fields(user) -> list[str]:
    """Required fields this account still needs, in a stable order. Empty ⇒ complete."""
    if user is None:
        return list(REQUIRED_PROFILE_FIELDS)

    missing: list[str] = []
    if _too_short(getattr(user, "first_name", "")):
        missing.append("first_name")
    if _too_short(getattr(user, "last_name", "")):
        missing.append("last_name")
    if _too_short(getattr(user, "username", "")):
        missing.append("username")
    if not email_is_usable(user):
        missing.append("email")
    return missing


def is_profile_complete(user) -> bool:
    return not missing_profile_fields(user)


__all__ = [
    "MIN_IDENTITY_LEN",
    "REQUIRED_PROFILE_FIELDS",
    "email_is_usable",
    "is_profile_complete",
    "missing_profile_fields",
]
