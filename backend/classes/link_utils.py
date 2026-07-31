"""Normalize + validate a homework's external links.

Homework (and a journal session's homework brief / classwork new-topic block) used to
carry a single ``external_url``. It now carries a LIST — ``external_urls``. The singular
field is kept as a mirror of the FIRST link so every existing reader (the student-facing
serializer, the release copy into ``classes.Assignment``, ``content_count`` /
``has_content``) keeps working untouched while new UI reads/writes the full list.

One helper normalizes both directions so the two fields can never drift.
"""

from __future__ import annotations

import json
from urllib.parse import urlparse

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator

_validate_url = URLValidator()


def normalize_one(value: str) -> str:
    """Normalize a single link; ``''`` if blank.

    Accepts a bare domain (``example.com/x.pdf``) by defaulting the scheme to https,
    mirroring the long-standing single-field behaviour. Raises ``DjangoValidationError``
    if the result is still not a valid URL.
    """
    value = (value or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    normalized = value if parsed.scheme else f"https://{value}"
    _validate_url(normalized)
    return normalized


def parse_external_urls(raw) -> list[str]:
    """Coerce a multipart/JSON payload value into a list of raw (un-normalized) links.

    Accepts a Python list, a JSON-encoded list string (how the frontend sends it, same as
    ``practice_test_ids``), or a single URL string. Blank entries are dropped; order is
    preserved. A lone URL is NEVER split on commas — query strings legitimately contain
    them — so single-link callers keep working.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        items = list(raw)
    elif isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        parsed = None
        if s[0] in "[\"":
            try:
                parsed = json.loads(s)
            except ValueError:
                parsed = None
        if isinstance(parsed, list):
            items = parsed
        elif isinstance(parsed, str):
            items = [parsed]
        else:
            items = [s]
    else:
        items = [raw]
    out: list[str] = []
    for it in items:
        t = ("" if it is None else str(it)).strip()
        if t:
            out.append(t)
    return out


def clean_external_urls(raw) -> list[str]:
    """Full pipeline: parse -> normalize each -> dedupe (order preserved).

    Raises ``DjangoValidationError`` (message names the offending link) on the first
    invalid URL, matching the single-field ``validate_external_url`` behaviour.
    """
    seen: set[str] = set()
    out: list[str] = []
    for entry in parse_external_urls(raw):
        try:
            norm = normalize_one(entry)
        except DjangoValidationError:
            raise DjangoValidationError(f"“{entry}” is not a valid link.")
        if norm and norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out


def first_url(urls) -> str:
    """The link stored on the legacy singular ``external_url`` mirror."""
    for u in urls or []:
        if u:
            return u
    return ""


def resolve_links(data, *, list_key: str = "external_urls", single_key: str = "external_url"):
    """Return ``(external_urls, external_url)`` from a request payload, or ``None`` if the
    payload carries neither key (so a partial PATCH that omits links leaves them untouched).

    Accepts whichever key the client sent and keeps the two representations consistent:
    the list is the source of truth; the single field mirrors its first entry.
    """
    has_list = _has_key(data, list_key)
    has_single = _has_key(data, single_key)
    if not has_list and not has_single:
        return None
    raw = _get(data, list_key) if has_list else _get(data, single_key)
    cleaned = clean_external_urls(raw)
    return cleaned, first_url(cleaned)


def resolve_video(data, *, key: str = "video_url"):
    """Return the normalized video URL from a payload, or ``None`` if the key is absent.

    A present-but-blank value returns ``""`` (clears the video). Raises
    ``DjangoValidationError`` on an invalid URL. Single value — a lesson has one video.
    """
    if not _has_key(data, key):
        return None
    return normalize_one(_get(data, key) or "")


def _has_key(data, key) -> bool:
    try:
        return key in data
    except TypeError:
        return hasattr(data, key)


def _get(data, key):
    getter = getattr(data, "get", None)
    return getter(key) if callable(getter) else getattr(data, key, None)
