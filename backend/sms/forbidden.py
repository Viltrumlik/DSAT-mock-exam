"""eskiz's word list, met on the first real run (2026-11-01): it refused "Shavkatova Xusnida" with
"Text is forbidden" — ``/message/sms/check`` named the keyword "shavkat". A student cannot change
their name, and the approved template around it never holds such a word, so the flagged word is
dropped from the NAME ("Shavkatova Xusnida," -> "Xusnida,") and the text checked again.

Never more than that: a flagged word outside the name, a name left empty, or eskiz still refusing
means the SMS is not sent (the caller counts it). An unanswered check sends the text as it is —
eskiz itself still has the last word, and a REJECTED send costs nothing."""

from __future__ import annotations

import re

_TRAIL = re.compile(r"[,.!?:;]+$")
_APOSTROPHES = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})


def _norm(word: str) -> str:
    return _TRAIL.sub("", word).translate(_APOSTROPHES).lower()


def _verdict(client, text):
    check = getattr(client, "check", None)
    verdict = check(text) if callable(check) else None
    return verdict if isinstance(verdict, dict) else None


def _drop(text: str, name: str, keys: list[str]) -> str | None:
    names = {_norm(w) for w in name.split() if _norm(w)}
    out: list[list] = []  # [token, is a kept name word]
    found = kept = dropped = 0
    for part in re.split(r"(\s+)", text):
        if not part:
            continue
        if part.isspace():
            out.append([part, False])
            continue
        n = _norm(part)
        if n not in names:
            out.append([part, False])
            continue
        found += 1
        if not any(k in n for k in keys):
            kept += 1
            out.append([part, True])
            continue
        dropped += 1
        if out and out[-1][0].isspace():
            out.pop()
        trail = _TRAIL.search(part)
        if trail:
            words = [t for t in out if not t[0].isspace()]
            if not words or not words[-1][1]:
                return None  # the punctuation has no name word before it to move to
            words[-1][0] += trail.group()
    if not found or not kept or not dropped:
        return None
    result = "".join(t for t, _ in out)
    return result if text[:1].isspace() else result.lstrip()


def scrub(client, text: str, name: str) -> tuple[str | None, list[str]]:
    """``(the text to send, the keywords eskiz flagged)``. The text is None when it must not be sent."""
    verdict = _verdict(client, text)
    if verdict is None or not verdict.get("forbidden"):
        return text, []
    keys = [str(k).lower() for k in verdict.get("keywords") or [] if str(k).strip()]
    cleaned = _drop(text, name, keys) if keys else None
    if cleaned is None:
        return None, keys
    again = _verdict(client, cleaned)
    if again is not None and again.get("forbidden"):
        return None, keys
    return cleaned, keys
