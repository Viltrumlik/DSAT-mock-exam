"""Refuse app builds older than the release policy's minimum — with a 426 the app understands.

The app checks the policy itself at launch and whenever it comes back to the foreground, so in
practice a student sees the update screen before this ever fires. This is the guarantee behind
that courtesy: a build that is still open when the minimum is raised, or that never learned to
check, cannot keep writing to endpoints whose shape it no longer matches.

It is deliberately narrow:

* only requests that declare an app build (`X-MasterSAT-Client: ios/<version>`) — browsers and
  test clients are never judged;
* only `/api/`, and never `/api/mobile/`, so a refused build can still read the policy that
  refused it and still report the crash that made the minimum go up;
* an unreadable version passes (see `versioning`): failing closed would lock out students for a
  header they did not write.

It sits before the CSRF middleware so an old build's POST is told "update" rather than a
misleading "Bad origin".
"""

from __future__ import annotations

from django.http import JsonResponse

from users.auth_cookies import NATIVE_CLIENT_HEADER

from .policy import get_policy
from .versioning import UPDATE_REQUIRED, format_version, parse_client_header

_HEADER_META = "HTTP_" + NATIVE_CLIENT_HEADER.upper().replace("-", "_")
_EXEMPT_PREFIXES = ("/api/mobile/",)

UPDATE_REQUIRED_DETAIL = "This version of the MasterSAT app is no longer supported. Update it to keep going."


class NativeClientVersionGateMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        refusal = self._refusal(request)
        if refusal is not None:
            return refusal
        return self.get_response(request)

    def _refusal(self, request):
        path = request.path_info or ""
        if not path.startswith("/api/") or path.startswith(_EXEMPT_PREFIXES):
            return None
        declared = parse_client_header(request.META.get(_HEADER_META))
        if declared is None:
            return None
        platform, version = declared
        try:
            policy = get_policy(platform)
        except Exception:
            # The policy table being unreadable is not a reason to refuse every phone.
            return None
        if policy.verdict(version) != UPDATE_REQUIRED:
            return None
        return JsonResponse(
            {
                "detail": policy.message or UPDATE_REQUIRED_DETAIL,
                "code": "update_required",
                "minimum_version": format_version(policy.minimum),
                "latest_version": format_version(policy.latest),
                "update_url": policy.update_url,
            },
            status=426,
        )
