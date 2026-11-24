from __future__ import annotations

import re
import unicodedata
from decimal import Decimal


def _norm_text(x: object) -> str:
    if x is None:
        return ""
    s = str(x)
    # Normalize NFKC so full-width digits/letters from mobile IMEs (e.g. "４" or
    # "Ｔ") fold to their ASCII equivalents before matching.
    try:
        s = unicodedata.normalize("NFKC", s)
    except (TypeError, ValueError):
        pass
    return " ".join(s.strip().lower().split())


def _number_as_written_here(s: str) -> str:
    """Read a number the way students here write it.

    Uzbek schools write a decimal with a comma ("2,5"), and phones and pasted worksheets
    give the typographic minus sign ("−3"). Both are read as the plain ASCII number.
    Only a single comma with no point is a decimal comma; "2,5,0" stays unreadable.
    """
    s = s.replace("\u2212", "-")
    if s.count(",") == 1 and "." not in s:
        s = s.replace(",", ".")
    return s


# One letter (Latin or Cyrillic \u2014 "\u0445" from a Russian keyboard), "=", then the answer.
_LETTER_EQUALS = re.compile(r"^[^\W\d_]\s*=\s*")


def _numeric_answer_text(s: str) -> str:
    """A numeric answer as written on paper: "x=5" and "x = 12" are 5 and 12.

    Owner, 2026-11-24: an equation's answer typed as "x=5" must be accepted. Only one
    letter then "=" is read away; "2x=10" or "x=5 or x=-5" stay unreadable, so wrong.
    """
    return _number_as_written_here(_LETTER_EQUALS.sub("", s.strip(), count=1))


def _as_decimal(x: object) -> Decimal | None:
    if x is None or x == "":
        return None
    s = _numeric_answer_text(str(x))
    # Support simple fractions (SAT grid-in style), e.g. "1/2" == 0.5.
    if "/" in s:
        num, _, den = s.partition("/")
        try:
            denom = Decimal(num.strip()) / Decimal(den.strip())
            return denom
        except Exception:
            return None
    try:
        return Decimal(s)
    except Exception:
        return None


def grade_answer(*, question_type: str, correct_answer: object, answer: object, config: dict) -> bool:
    """
    Pure grading function: returns True/False.

    Supported types:
    - multiple_choice: compares normalized choice id (string)
    - boolean: compares boolean-ish
    - numeric: Decimal compare with optional tolerance (config.tolerance)
    - short_text: exact match after normalization; accepts list of acceptable strings
    """
    qt = str(question_type or "").strip()
    if qt == "multiple_choice":
        return _norm_text(answer) == _norm_text(correct_answer)

    if qt == "boolean":
        def _to_bool(v: object) -> bool | None:
            if isinstance(v, bool):
                return v
            s = _norm_text(v)
            if s in ("true", "t", "1", "yes", "y"):
                return True
            if s in ("false", "f", "0", "no", "n"):
                return False
            return None

        return _to_bool(answer) is not None and _to_bool(answer) == _to_bool(correct_answer)

    if qt == "numeric":
        a = _as_decimal(answer)
        if a is None:
            return False
        tol = _as_decimal((config or {}).get("tolerance"))
        # correct_answer may be a single value or a list of acceptable values
        # (SAT grid-in: 10.25 and 21/2 are both correct). Match if it equals ANY.
        targets = correct_answer if isinstance(correct_answer, list) else [correct_answer]
        for target in targets:
            c = _as_decimal(target)
            if c is None:
                continue
            if tol is None:
                if a == c:
                    return True
            elif abs(a - c) <= tol:
                return True
        return False

    # short_text (default)
    if isinstance(correct_answer, list):
        targets = [_norm_text(x) for x in correct_answer]
        return _norm_text(answer) in {t for t in targets if t}
    return _norm_text(answer) == _norm_text(correct_answer)

