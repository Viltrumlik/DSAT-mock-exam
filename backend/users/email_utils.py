"""One place that knows whether an account has a usable address.

``User.email`` is nullable. NULL means the person has not supplied an address — a
Telegram signup arrives without one, and an account can lose its address to whoever
proves control of it. There is no placeholder value and no synthetic domain: earlier
revisions minted ``tg{id}@telegram.mastersat.local`` and a ``released-…`` address purely
because the column could not be empty, which forced every other part of the system to
learn how to decode them. NULL says it directly.

``""`` is deliberately not a valid state. Postgres treats NULLs as distinct under
``UNIQUE(lower(email))`` so any number of address-less accounts coexist, but two empty
strings collide — hence the CheckConstraint on the model and the coercion in
``User.clean``.
"""
from __future__ import annotations


def has_email(address: str | None) -> bool:
    """True when this account has an address at all."""
    return bool((address or "").strip())


def is_deliverable_email(address: str | None) -> bool:
    """True when it is safe to send mail here. The send layer must gate on this."""
    addr = (address or "").strip()
    return bool(addr) and "@" in addr


def display_email(address: str | None) -> str:
    """An address to show a human, or ``""`` when there is none.

    Several call sites fall back to the email as a person's *name* when no first or last
    name is set, so this must never return something that is not a real address.
    """
    return (address or "").strip()


def normalize_email(address: str | None) -> str | None:
    """Canonical form for comparison and storage; ``None`` for "no address".

    Never returns ``""`` — a blank would be written to the column and violate the
    not-blank constraint, and would match ``email__iexact=""`` rather than nothing.
    """
    normalized = (address or "").strip().lower()
    return normalized or None


__all__ = [
    "display_email",
    "has_email",
    "is_deliverable_email",
    "normalize_email",
]
