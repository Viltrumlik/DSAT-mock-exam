"""Cleanup middleware for legacy per-subdomain auth/CSRF cookies.

Background:
    The platform briefly ran with ``DEBUG=True`` in production, during which Django
    issued ``csrftoken`` / session cookies without an explicit ``Domain`` attribute —
    meaning each subdomain (``mastersat.uz``, ``admin.mastersat.uz``,
    ``questions.mastersat.uz``) stored its own scoped copy.

    After switching to ``DEBUG=False``, Django started emitting the same cookies with
    ``Domain=.mastersat.uz``. Browsers KEEP both cookies side-by-side. Requests now
    carry e.g. ``Cookie: csrftoken=OLD; csrftoken=NEW``. Django's cookie parser keeps
    the LAST occurrence; ``js-cookie`` reads the FIRST occurrence. The mismatch fails
    every unsafe write with ``CSRF token from the 'X-CSRFToken' HTTP header incorrect``.

What this middleware does:
    On every response, it detects requests that arrived with multiple ``csrftoken``
    cookies (the smoking gun) and explicitly clears the per-subdomain variant by
    emitting ``Set-Cookie: csrftoken=; Domain=<host>; Path=/; Max-Age=0``. After one
    response per affected subdomain, the duplicate is gone and the issue is resolved
    without user action.

    It does the same for the JWT cookies (``lms_access``, ``lms_refresh``) for the
    same reason — the same DEBUG-period regression affected them.
"""

from __future__ import annotations

from typing import Iterable

from django.conf import settings
from django.http import HttpRequest, HttpResponse

# Cookie names we manage globally with Domain=.mastersat.uz in production.
_MANAGED_COOKIE_NAMES = ("csrftoken", "lms_access", "lms_refresh", "sessionid")

# Subdomains where a legacy scoped variant might exist and needs deletion.
_SUBDOMAINS_TO_CLEAN: tuple[str, ...] = (
    "mastersat.uz",
    "www.mastersat.uz",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
)


def _count_csrftoken_in_raw_cookie_header(raw_cookie: str) -> int:
    """Return how many ``csrftoken=`` segments appear in the raw Cookie header."""
    if not raw_cookie:
        return 0
    return sum(1 for chunk in raw_cookie.split(";") if chunk.strip().startswith("csrftoken="))


class LegacyCookieCleanupMiddleware:
    """Detect duplicate ``csrftoken``/auth cookies and emit deletion headers for the
    subdomain-scoped variant (so the only remaining one is ``Domain=.mastersat.uz``).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        raw_cookie = request.META.get("HTTP_COOKIE", "") or ""
        # Cheap check: only act when the smoking gun (multiple csrftoken) is present.
        # JWT-cookie duplicates are rarer but if csrftoken is duplicated, the others
        # likely are too — we'll clean them all in one pass.
        had_duplicate_csrf = _count_csrftoken_in_raw_cookie_header(raw_cookie) > 1

        response: HttpResponse = self.get_response(request)

        if not had_duplicate_csrf:
            return response

        host = (request.get_host() or "").split(":")[0].lower()
        if not host:
            return response

        # Only act on our managed subdomains. Don't touch random hosts.
        if host not in _SUBDOMAINS_TO_CLEAN:
            return response

        # Production cookies live at Domain=.mastersat.uz. The "legacy" duplicates are
        # scoped to the bare subdomain (no Domain attribute). To delete those we emit a
        # Set-Cookie with NO Domain and Max-Age=0.
        #
        # Critical: Python's SimpleCookie REUSES the existing Morsel when you re-assign
        # a value, so any Domain attribute set earlier in the middleware chain (Django's
        # CSRF middleware sets one with Domain=.mastersat.uz) survives. We delete the
        # morsel entirely and start fresh so our deletion really has NO Domain attribute.
        from http.cookies import Morsel

        for name in _MANAGED_COOKIE_NAMES:
            # Drop any inherited morsel (e.g. CsrfViewMiddleware's refreshed csrftoken).
            # On THIS response only — the .mastersat.uz cookie already exists in the
            # browser and stays valid via its long Max-Age; the next response will refresh
            # it normally.
            if name in response.cookies:
                del response.cookies[name]
            morsel = Morsel()
            morsel.set(name, "", "")
            morsel["max-age"] = 0
            morsel["expires"] = "Thu, 01 Jan 1970 00:00:00 GMT"
            morsel["path"] = "/"
            # Deliberately omit Domain — the deletion targets the bare-subdomain copy.
            morsel["samesite"] = "Lax"
            if not settings.DEBUG:
                morsel["secure"] = True
            if name != "csrftoken":
                morsel["httponly"] = True
            response.cookies[name] = morsel

        return response
