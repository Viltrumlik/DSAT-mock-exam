from __future__ import annotations

from datetime import timedelta

from django.conf import settings


ACCESS_COOKIE = "lms_access"
REFRESH_COOKIE = "lms_refresh"

# Session lifetime (1 week) — the browser drops the refresh cookie at ITS max_age, so
# this must not be shorter than SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"] or the session dies
# early: a student mid-exam then cannot renew their access token and every request 401s.
REFRESH_MAX_AGE = timedelta(weeks=1)
# "Don't remember me" is deliberately short-lived — a shared/lab machine.
REFRESH_MAX_AGE_SESSION_ONLY = timedelta(days=1)

# Header the native apps (iOS today, Android later) set on every request. The VALUE is
# informational — "ios/1.0.0" — and nothing authorizes off it.
NATIVE_CLIENT_HEADER = "X-MasterSAT-Client"


def is_native_client(request) -> bool:
    """
    True for a client that authenticates with ``Authorization: Bearer`` alone.

    Two conditions, BOTH required:
      * it declares itself with ``X-MasterSAT-Client``, and
      * it carries no auth cookie.

    The second is the load-bearing one. CSRF is an attack on *ambient* credentials: it
    exists because a browser attaches cookies to a cross-site request all by itself. A
    request with no auth cookie has nothing ambient to forge with, so there is no CSRF to
    prevent. If an auth cookie IS present the request is a browser's — whatever the header
    claims — and it stays under full CSRF enforcement.

    The header is not decoration either: a browser cannot send a custom header cross-site
    without a CORS preflight, and ``CORS_ALLOW_ALL_ORIGINS`` is False in production with a
    fixed ``CORS_ALLOWED_ORIGINS`` allowlist. An attacker's page fails the preflight, so
    the request is never sent. Requiring it keeps the exemption narrow: only a caller that
    deliberately opts in gets it, never a stray cookie-less browser fetch.
    """
    try:
        declared = bool(str(request.headers.get(NATIVE_CLIENT_HEADER) or "").strip())
    except Exception:
        return False
    if not declared:
        return False
    try:
        cookies = request.COOKIES or {}
    except Exception:
        cookies = {}
    return not (cookies.get(ACCESS_COOKIE) or cookies.get(REFRESH_COOKIE))


def cookie_domain_for_request(request) -> str | None:
    """
    Production: share across subdomains (admin/questions/main).
    Dev: host-only cookies.
    """
    if getattr(settings, "DEBUG", False):
        return None
    host = ""
    try:
        host = (request.get_host() or "").split(":")[0].lower()
    except Exception:
        host = ""
    if host.endswith("mastersat.uz"):
        return ".mastersat.uz"
    return None


def _cookie_common(request):
    return {
        "secure": not getattr(settings, "DEBUG", False),
        "httponly": True,
        # Strict blocks cross-site requests (CSRF) by not sending cookies.
        # Our consoles are on subdomains of the same site, so this remains compatible.
        # Lax is more resilient across redirects and subdomain navigations.
        "samesite": "Lax",
        "domain": cookie_domain_for_request(request),
        "path": "/",
    }

def _delete_cookie_common(request):
    """
    Django's ``HttpResponse.delete_cookie`` does not accept cookie flags like
    ``secure`` / ``httponly``. Only pass attributes that participate in cookie matching.
    """
    return {
        "samesite": "Lax",
        "domain": cookie_domain_for_request(request),
        "path": "/",
    }


def set_auth_cookies(
    *,
    response,
    request,
    access: str,
    refresh: str,
    remember_me: bool = True,
    refresh_max_age: timedelta | None = None,
):
    common = _cookie_common(request)
    # Access token should expire quickly; let browser drop cookie when expires is reached.
    response.set_cookie(
        ACCESS_COOKIE,
        access,
        max_age=int(timedelta(hours=3, minutes=10).total_seconds()),
        **common,
    )
    # Refresh cookie drives session lifetime.
    if refresh_max_age is None:
        refresh_max_age = REFRESH_MAX_AGE if remember_me else REFRESH_MAX_AGE_SESSION_ONLY
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=int(refresh_max_age.total_seconds()),
        **common,
    )


def set_access_cookie(*, response, request, access: str):
    common = _cookie_common(request)
    response.set_cookie(
        ACCESS_COOKIE,
        access,
        max_age=int(timedelta(hours=3, minutes=10).total_seconds()),
        **common,
    )


def clear_auth_cookies(*, response, request):
    common = _delete_cookie_common(request)
    response.delete_cookie(ACCESS_COOKIE, **common)
    response.delete_cookie(REFRESH_COOKIE, **common)

