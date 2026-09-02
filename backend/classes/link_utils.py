"""Normalize + validate a homework's external links.

Homework (and a journal session's homework brief / classwork new-topic block) used to
carry a single ``external_url``. It now carries a LIST — ``external_urls``. The singular
field is kept as a mirror of the FIRST link so every existing reader (the student-facing
serializer, the release copy into ``classes.Assignment``, ``content_count`` /
``has_content``) keeps working untouched while new UI reads/writes the full list.

One helper normalizes both directions so the two fields can never drift.

A link may also carry a NAME — "Chapter 3 worksheet" instead of a bare
``https://drive.google.com/…``. The names live in a parallel list,
``external_url_labels``, aligned to ``external_urls`` by index rather than inside it:
``external_urls`` is a ``list[str]`` in the student serializer, in the release copy, in
the homework email and in the iOS client, and turning its entries into objects would
break every one of them. The two lists are always produced together by
:func:`clean_link_pairs`, so an entry can never lose its name to a dedupe or a blank
row. A missing / blank name is not an error: the UI falls back to showing the link.
"""

from __future__ import annotations

import json
from urllib.parse import urlparse

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator

_validate_url = URLValidator()

#: A link name is a label, not prose — long enough for "Chapter 3 practice worksheet".
LABEL_MAX_LENGTH = 120


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


def parse_link_labels(raw) -> list[str]:
    """Coerce a payload value into a list of raw (un-normalized) link NAMES.

    Same accepted shapes as :func:`parse_external_urls`, with one deliberate difference:
    blanks are KEPT. A name is optional per link, so dropping the empty ones would shift
    every later name onto the wrong URL — the list is positional, not a set.
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
    return [("" if it is None else str(it)).strip()[:LABEL_MAX_LENGTH] for it in items]


def clean_link_pairs(raw_urls, raw_labels=None) -> list[tuple[str, str]]:
    """Full pipeline: parse -> normalize each -> dedupe, carrying each link's name along.

    ``raw_urls`` may be a plain list of URL strings (with the names supplied separately in
    ``raw_labels``, index-aligned) **or** a list of ``{"url": ..., "label": ...}`` objects —
    the shape a client that knows about names finds natural to send. Both are accepted so a
    caller never has to send two lists that could arrive out of step.

    Raises ``DjangoValidationError`` (message names the offending link) on the first invalid
    URL, matching the single-field ``validate_external_url`` behaviour. A duplicate link
    keeps the FIRST occurrence's name unless that one was blank, in which case a later name
    for the same link fills it in — dropping a name the author actually typed would be the
    one lossy outcome here.
    """
    labels = parse_link_labels(raw_labels)
    entries: list[tuple[object, str]] = []
    if isinstance(raw_urls, (list, tuple)):
        for idx, item in enumerate(raw_urls):
            if isinstance(item, dict):
                entries.append((item.get("url"), str(item.get("label") or "").strip()[:LABEL_MAX_LENGTH]))
            else:
                entries.append((item, labels[idx] if idx < len(labels) else ""))
    else:
        # A JSON-encoded list / bare string: parse it the way the URL-only path always has,
        # then pair positionally with whatever names came alongside.
        parsed = parse_external_urls(raw_urls)
        entries = [(u, labels[idx] if idx < len(labels) else "") for idx, u in enumerate(parsed)]

    seen: dict[str, int] = {}
    out: list[list[str]] = []
    for raw_entry, label in entries:
        text = ("" if raw_entry is None else str(raw_entry)).strip()
        if not text:
            continue
        try:
            norm = normalize_one(text)
        except DjangoValidationError:
            raise DjangoValidationError(f"“{text}” is not a valid link.")
        if not norm:
            continue
        if norm in seen:
            row = out[seen[norm]]
            if not row[1] and label:
                row[1] = label
            continue
        seen[norm] = len(out)
        out.append([norm, label])
    return [(u, l) for u, l in out]


def clean_external_urls(raw) -> list[str]:
    """URL-only pipeline, kept for callers that have no names to carry."""
    return [u for u, _label in clean_link_pairs(raw)]


def first_url(urls) -> str:
    """The link stored on the legacy singular ``external_url`` mirror."""
    for u in urls or []:
        if u:
            return u
    return ""


def resolve_links(
    data,
    *,
    list_key: str = "external_urls",
    single_key: str = "external_url",
    label_key: str = "external_url_labels",
):
    """Return ``(external_urls, external_url, external_url_labels)`` from a request payload,
    or ``None`` if the payload carries none of the keys (so a partial PATCH that omits links
    leaves them untouched).

    Accepts whichever key the client sent and keeps the three representations consistent:
    the list is the source of truth, the single field mirrors its first entry, and the names
    stay index-aligned to the list because they are produced from the same pass over it.
    """
    has_list = _has_key(data, list_key)
    has_single = _has_key(data, single_key)
    has_labels = _has_key(data, label_key)
    # Names alone are not a link edit. They are positional against a list this payload did
    # not send, so there is nothing to align them to — and treating the absent list as an
    # empty one would DELETE every link the lesson has. A client renaming a link sends both.
    if not has_list and not has_single:
        return None
    raw = _get(data, list_key) if has_list else _get(data, single_key)
    pairs = clean_link_pairs(raw, _get(data, label_key) if has_labels else None)
    urls = [u for u, _l in pairs]
    return urls, first_url(urls), [l for _u, l in pairs]


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


def labels_for(urls, labels) -> list[str]:
    """The stored name list padded / trimmed to line up with ``urls``.

    Every read path goes through this rather than indexing the raw column: the two lists
    are written together, but a row saved before names existed has ``[]`` and an import can
    carry a list of the wrong length. Reading through one helper means a mismatch shows up
    as "this link has no name", never as an IndexError or as a name on the wrong link.
    """
    urls = list(urls or [])
    labels = list(labels or [])
    return [
        (str(labels[i]).strip() if i < len(labels) and labels[i] else "")
        for i in range(len(urls))
    ]


def link_pairs(urls, labels) -> list[tuple[str, str]]:
    """``[(url, name)]`` for rendering — the read-side twin of :func:`clean_link_pairs`."""
    return list(zip(list(urls or []), labels_for(urls, labels)))


def link_text(url: str, label: str) -> str:
    """What a human should see for one link: its name, or the link itself when unnamed."""
    label = (label or "").strip()
    return label or url
