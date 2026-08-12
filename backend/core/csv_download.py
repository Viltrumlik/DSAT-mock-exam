"""One way to hand a CSV back to a browser.

Shared by the exams and assessments question exports so the two downloads behave
identically — same encoding, same filename rules, same headers.
"""

from __future__ import annotations

import re
import unicodedata

from django.http import HttpResponse

#: Anything that is not a letter, digit, dash or underscore becomes a dash. A test title is
#: free text and routinely contains "/", ":" and quotes, all of which break either the
#: Content-Disposition header or the reader's filesystem.
_UNSAFE = re.compile(r"[^A-Za-z0-9_-]+")


def safe_filename_stem(raw: str, *, fallback: str = "export", limit: int = 80) -> str:
    """A filename stem that survives a header, a shell and a Windows filesystem.

    Non-ASCII is transliterated away rather than percent-encoded: the alternative is a
    ``filename*=UTF-8''…`` header that some clients still mishandle, and the stem is a
    convenience for the person downloading, not data.
    """
    ascii_only = (
        unicodedata.normalize("NFKD", str(raw or ""))
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    stem = _UNSAFE.sub("-", ascii_only).strip("-")[:limit].strip("-")
    return stem or fallback


def csv_download_response(text: str, filename_stem: str) -> HttpResponse:
    """A CSV attachment Excel opens correctly.

    ``utf-8-sig`` writes the BOM Excel needs to read the file as UTF-8; without it any
    non-ASCII question renders as mojibake, which defeats an export whose whole purpose is
    being read.
    """
    response = HttpResponse(
        text.encode("utf-8-sig"), content_type="text/csv; charset=utf-8"
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{safe_filename_stem(filename_stem)}.csv"'
    )
    # The browser must not serve a stale answer key from cache after a question is edited.
    response["Cache-Control"] = "no-store"
    return response
