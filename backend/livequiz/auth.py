"""Who is on the other end of a WebSocket.

The browser already holds an HttpOnly ``lms_access`` JWT cookie on ``.mastersat.uz`` and
sends it with the handshake, so the socket can reuse exactly the authentication the REST API
uses — ``CookieOrHeaderJWTAuthentication``, including its step-up check.

That convenience is also the danger. A cookie is attached by the browser to a WebSocket
handshake from ANY origin, and the same-origin policy does not apply to WebSockets: without
an origin check, any page on the internet could open a socket as a logged-in student and
play their game for them. :func:`livequiz_auth_stack` therefore wraps the router in
Channels' ``AllowedHostsOriginValidator``, which refuses a handshake whose ``Origin`` is not
one of ours. Do not unwrap it.
"""

from __future__ import annotations

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from channels.security.websocket import AllowedHostsOriginValidator
from channels.sessions import CookieMiddleware
from django.contrib.auth.models import AnonymousUser

ACCESS_COOKIE = "lms_access"


@database_sync_to_async
def _user_from_access_token(raw: str):
    """Resolve a raw access token to a user, or None. Never raises."""
    # Imported lazily: this module is loaded from asgi.py, which runs before the app
    # registry is necessarily ready.
    from users.authentication import CookieOrHeaderJWTAuthentication

    backend = CookieOrHeaderJWTAuthentication()
    try:
        validated = backend.get_validated_token(raw)
        user = backend.get_user(validated)
    except Exception:
        # An expired or forged token is an anonymous connection, not a 500. The consumer
        # closes it; there is nothing useful to say to a client that presented a bad token.
        return None
    if user is None or not getattr(user, "is_active", False):
        return None
    return user


class JWTCookieAuthMiddleware(BaseMiddleware):
    """Put ``scope["user"]`` in place from the ``lms_access`` cookie.

    Sits where ``AuthMiddlewareStack`` would, but reads the JWT cookie rather than a Django
    session, because that is how this platform authenticates a browser.
    """

    async def __call__(self, scope, receive, send):
        scope = dict(scope)
        raw = (scope.get("cookies") or {}).get(ACCESS_COOKIE)
        user = await _user_from_access_token(raw) if raw else None
        scope["user"] = user or AnonymousUser()
        return await super().__call__(scope, receive, send)


def livequiz_auth_stack(inner):
    """Origin check, then cookies, then the JWT. Order matters.

    ``AllowedHostsOriginValidator`` is outermost so a cross-origin handshake is refused
    before any database work happens on its behalf.
    """
    return AllowedHostsOriginValidator(CookieMiddleware(JWTCookieAuthMiddleware(inner)))
