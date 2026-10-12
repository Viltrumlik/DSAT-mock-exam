"""Phones and names as lc-up writes them, made comparable with ours.

lc-up stores ``998901234567``; our ``User.phone_number`` holds whatever the person typed —
``+998 90 123 45 67``, ``901234567``. Comparing raw strings would miss nearly every match, so
both sides go through :func:`normalize_phone` first. A number that is not Uzbek (12 digits
starting 998, or a bare 9-digit local number) normalises to ``None`` and never matches anything.
"""

import re
import unicodedata

_NON_DIGIT = re.compile(r"\D+")
_APOSTROPHES = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})


def normalize_phone(raw) -> str | None:
    digits = _NON_DIGIT.sub("", str(raw or ""))
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) == 12 and digits.startswith("998"):
        return digits
    return None


def _clean(full) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(full or "")).translate(_APOSTROPHES).split())


def split_lcup_name(full) -> tuple[str, str]:
    """lc-up writes "Last First [Patronymic]"; ours keeps first and last apart."""
    parts = _clean(full).split(" ")
    if len(parts) < 2:
        return (parts[0], "")
    return (" ".join(parts[1:]), parts[0])


def name_tokens(full) -> frozenset[str]:
    return frozenset(t.casefold() for t in _clean(full).split(" ") if t)
