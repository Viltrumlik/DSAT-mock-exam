from __future__ import annotations

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


def _as_decimal(x: object) -> Decimal | None:
    if x is None or x == "":
        return None
    s = str(x).strip()
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

