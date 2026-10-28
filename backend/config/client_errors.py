from __future__ import annotations

import json
import logging

from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger("frontend.client_error")

#: What the crash screen sends, and how much of each field is kept. Anything else is dropped.
FIELD_LIMITS = {
    "kind": 20,  # "stale" (a chunk from an older release) or "crash"
    "url": 500,
    "name": 100,
    "message": 1000,
    "digest": 100,
    "stack": 4000,
}


class ClientErrorReportView(APIView):
    """
    Sink for the frontend crash screen (`CrashScreen.tsx`): one line in the gunicorn log per
    crash a student actually saw, so "Application error" on someone's phone leaves a trace.

    Log-only, like the CSP sink beside it. Under /api/health/ because that prefix is already open
    on every console (`access/host_guard.py`) and skipped by the auth-correlation middleware; the
    crash screen may be the root layout's, with no CSRF token to send, so `csrf_api.py` lets this
    path through for a same-site Origin only.
    """

    # Anonymous by design — a crash on the login page has nobody signed in, and a stale JWT
    # cookie must not turn the report into a 401. Who it was is looked up best-effort below.
    authentication_classes: list = []
    permission_classes: list = []
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "client_error"
    MAX_BODY_BYTES = 16_384

    def post(self, request):
        if len(request.body or b"") > self.MAX_BODY_BYTES:
            return Response(status=413)
        body = request.data if isinstance(request.data, dict) else {}
        report = {
            key: str(body[key])[:limit]
            for key, limit in FIELD_LIMITS.items()
            if body.get(key) not in (None, "")
        }
        report["user_agent"] = (request.META.get("HTTP_USER_AGENT") or "")[:300]
        report["user_id"] = _user_id(request)
        logger.warning("client_error %s", json.dumps(report, sort_keys=True))
        return Response(status=204)


def _user_id(request) -> int | None:
    """The signed-in student, when the cookie or header still says so; None otherwise."""
    try:
        from users.authentication import CookieOrHeaderJWTAuthentication

        result = CookieOrHeaderJWTAuthentication().authenticate(request)
    except Exception:
        return None
    return result[0].pk if result else None
