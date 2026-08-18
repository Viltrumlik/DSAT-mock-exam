"""
API authentication + staff subject sanity checks.

JWT is validated here so `request.user` is populated before `SubdomainAPIGuardMiddleware`
(which must see roles for host-based API rules).

Authorization never uses browser cookies (e.g. ``lms_subject``): role, subject, and
permissions come only from the authenticated ``User`` row and ``access`` tables.
"""

from __future__ import annotations

from django.http import JsonResponse

from access.services import staff_must_have_subject, user_domain_subjects


class JWTUserMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ""
        if path.startswith("/api/") and not getattr(request.user, "is_authenticated", False):
            try:
                from users.authentication import CookieOrHeaderJWTAuthentication

                result = CookieOrHeaderJWTAuthentication().authenticate(request)
                if result:
                    user, token = result
                    request.user = user
                    request.auth = token
            except Exception:
                pass
        return self.get_response(request)


class StaffSubjectRequiredMiddleware:
    """Subject-scoped staff must cover at least one domain (global roles do not).

    The question here is "is this account configured?", not "which single subject is theirs?",
    and the difference is not academic — it locked a real member of staff out of the entire
    platform. This asked ``user_domain_subject(user) not in ALL_DOMAIN_SUBJECTS``, and that
    function returns ``None`` for a support teacher whose subject is ``"both"``, deliberately
    (see ``access.constants``: "both" is kept out of ``ALL_DOMAIN_SUBJECTS`` because every
    caller compares its result with ``==``). ``None`` is not in the tuple, so this middleware
    — which runs on **every** ``/api/`` request — answered 403 to every call a both-subject
    support teacher ever made. They could not open the teacher panel at all.

    ``user_domain_subjects`` is the plural companion that understands "both": a non-empty set
    is exactly the "configured" this gate means to test.
    """

    # Auth-bootstrap paths this gate must NEVER answer, no matter how the account is
    # configured. `/api/users/me/` is the identity probe the SPA calls on every boot to
    # decide "am I signed in?"; if a subject-misconfigured staff account gets a 403 here,
    # the client reads it as "not authenticated" and bounces to /login — then the login
    # succeeds, boots, probes `me`, is refused again, and loops forever with no way to even
    # SEE they are logged in, let alone be told their subject is unset. The host guard
    # already lets `/api/users/me/` (and the auth endpoints) through on every console for
    # exactly this reason; the subject gate has to honour the same boot exemption or it
    # re-introduces the lockout host_guard was careful to avoid. None of these paths expose
    # a work surface — subject scoping still guards every real endpoint below — so exempting
    # them widens nothing. A blank-subject account now boots into the portal and meets a
    # proper in-app error on its data calls instead of an invisible redirect.
    _BOOT_EXEMPT_PREFIXES = (
        "/api/auth/",
        "/api/users/me/",
        "/api/users/google/",
        "/api/users/telegram/",
        "/api/health/",
        "/api/schema/",
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ""
        if not path.startswith("/api/"):
            return self.get_response(request)
        if any(path.startswith(p) for p in self._BOOT_EXEMPT_PREFIXES):
            return self.get_response(request)
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return self.get_response(request)
        if staff_must_have_subject(user) and not user_domain_subjects(user):
            return JsonResponse(
                {"detail": "Staff account is missing a valid subject (math, english or both)."},
                status=403,
            )
        return self.get_response(request)
