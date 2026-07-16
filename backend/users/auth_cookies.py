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

