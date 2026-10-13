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
# Uzbek/Russian surname endings, matched case-insensitively and without apostrophes ("Azamato'va" is
# "-ova"). "-jonov", "-yeva" and the like already end in "-ov"/"-eva"; they are listed so the rule reads
# the way people describe it.
_SURNAME_SUFFIXES = (
    "ov", "ova", "ev", "eva", "yev", "yeva", "iy", "aya", "off", "jonov", "jonova", "xonov", "xonova",
)


def normalize_phone(raw) -> str | None:
    digits = _NON_DIGIT.sub("", str(raw or ""))
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) == 12 and digits.startswith("998"):
        return digits
    return None


def _clean(full) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(full or "")).translate(_APOSTROPHES).split())


def _has_surname_suffix(word: str) -> bool:
    return word.replace("'", "").casefold().endswith(_SURNAME_SUFFIXES)


def split_lcup_name(full) -> tuple[str, str]:
    """lc-up has no fixed order ("Karimova Malika", "Muhammadyor Holiqjonov"); ours keeps first and last apart.

    The surname is the one word with a surname ending, wherever it stands. When no word or several words
    have one, the first word is the surname. The other words, in their order, are the first name, so a
    patronymic ("Ali o'g'li", "qizi") stays with it.
    """
    parts = _clean(full).split(" ")
    if len(parts) < 2:
        return (parts[0], "")
    suffixed = [i for i, word in enumerate(parts) if _has_surname_suffix(word)]
    at = suffixed[0] if len(suffixed) == 1 else 0
    return (" ".join(parts[:at] + parts[at + 1:]), parts[at])


def name_tokens(full) -> frozenset[str]:
    return frozenset(t.casefold() for t in _clean(full).split(" ") if t)
