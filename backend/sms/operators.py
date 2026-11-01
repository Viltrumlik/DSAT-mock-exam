"""Which mobile operator a number belongs to, from the two digits after 998.

The panel's charts and the journal's filter group SMS by operator: on 2026-11-01 Uzmobile turned
down 8 of the first 16 debt warnings of a fast burst while the others took them, and that only
shows when the numbers are split this way. A code not listed here (a new operator, a typo) is
"Other", never a guess.
"""

from __future__ import annotations

from django.db.models import Q

OPERATORS: dict[str, tuple[str, ...]] = {
    "Beeline": ("90", "91"),
    "Ucell": ("93", "94", "50"),
    "Uzmobile": ("95", "99", "77"),
    "Mobiuz": ("97", "88"),
    "Perfectum": ("98",),
    "Humans": ("33",),
}
NAMES: tuple[str, ...] = tuple(OPERATORS)
OTHER = "Other"
_BY_CODE = {code: name for name, codes in OPERATORS.items() for code in codes}


def operator_of(phone) -> str:
    """The operator of a ``998XXXXXXXXX`` phone (as ``normalize_phone`` writes it), else "Other"."""
    return _BY_CODE.get(str(phone or "")[3:5], OTHER)


def operator_q(name: str) -> Q | None:
    """The rows whose phone is ``name``'s; None for a name not in OPERATORS."""
    codes = OPERATORS.get(name)
    if not codes:
        return None
    q = Q()
    for code in codes:
        q |= Q(phone__startswith=f"998{code}")
    return q
