"""One place that knows which addresses are real.

Two kinds of address on ``User.email`` are placeholders rather than mailboxes:

* ``tg{telegram_id}@telegram.mastersat.local`` — minted for Telegram signups, which
  never supply an address. 72 of 387 production rows hold one.
* ``released-{pk}-{nonce}@released.mastersat.invalid`` — written when an address is
  taken off an account by the claim flow. ``User.email`` is the ``USERNAME_FIELD`` and
  ``NOT NULL``, so the row needs *something*; a placeholder keeps the schema honest
  without the auth-bypass and ~200-site churn that making the column nullable implies.

Both must never be mailed and never be shown as if they were a person's contact
address. Before this module each caller rebuilt the domain string inline, which is how
the two Telegram upserts drifted apart in the first place.
"""
from __future__ import annotations

import secrets

from django.conf import settings

# RFC 2606 reserves ``.invalid`` — guaranteed never to resolve anywhere.
RELEASED_EMAIL_DOMAIN = "released.mastersat.invalid"


def telegram_domain() -> str:
    """The configured synthetic domain for Telegram signups.

    Note the default is a ``.local`` name, which is mDNS-reserved and *can* resolve on
    a LAN — unlike ``.invalid``. Left as-is because 72 production rows already carry it
    and rewriting them is a data migration, not a constant change.
    """
    return getattr(settings, "TELEGRAM_SYNTHETIC_EMAIL_DOMAIN", "telegram.mastersat.local")


def synthetic_telegram_email(telegram_id) -> str:
    return f"tg{telegram_id}@{telegram_domain()}".lower()


def released_placeholder_email(user_pk) -> str:
    """A unique parking address for an account whose real one was claimed elsewhere.

    The nonce keeps it unique even if the same account is released twice, which the
    ``UNIQUE(lower(email))`` constraint requires.
    """
    return f"released-{user_pk}-{secrets.token_hex(4)}@{RELEASED_EMAIL_DOMAIN}".lower()


def is_synthetic_email(address: str | None) -> bool:
    """True when this is a placeholder rather than a mailbox someone reads."""
    addr = (address or "").strip().lower()
    if not addr:
        return True
    return addr.endswith(f"@{telegram_domain()}") or addr.endswith(f"@{RELEASED_EMAIL_DOMAIN}")


def is_deliverable_email(address: str | None) -> bool:
    """True when it is safe to send mail here. The send layer must gate on this."""
    addr = (address or "").strip()
    return bool(addr) and "@" in addr and not is_synthetic_email(addr)


def display_email(address: str | None) -> str:
    """An address to show a human, or ``""`` when there is nothing worth showing.

    Never render a placeholder: it reads as a real address to staff and, worse, some
    call sites fall back to the email as a person's *name*.
    """
    return "" if is_synthetic_email(address) else (address or "").strip()


def normalize_email(address: str | None) -> str:
    """Canonical form for comparison and storage. Lookups elsewhere use ``__iexact``."""
    return (address or "").strip().lower()


__all__ = [
    "RELEASED_EMAIL_DOMAIN",
    "display_email",
    "is_deliverable_email",
    "is_synthetic_email",
    "normalize_email",
    "released_placeholder_email",
    "synthetic_telegram_email",
    "telegram_domain",
]
