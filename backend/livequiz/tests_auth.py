"""Who a live-quiz socket belongs to: the browser's cookie, or the iOS app's Bearer header."""

from __future__ import annotations

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as C

from .auth import JWTCookieAuthMiddleware

User = get_user_model()


def _resolve(scope):
    """Run the middleware over one handshake scope and return the user it settled on."""
    seen = {}

    async def inner(scope, receive, send):
        seen["user"] = scope["user"]

    async def receive():
        return {"type": "websocket.connect"}

    async def send(message):
        pass

    async_to_sync(JWTCookieAuthMiddleware(inner))(scope, receive, send)
    return seen["user"]


class SocketAuthTests(TransactionTestCase):
    def setUp(self):
        self.student = User.objects.create_user("lq_auth@t.com", "secret123", role=C.ROLE_STUDENT)
        self.token = str(RefreshToken.for_user(self.student).access_token)

    def scope(self, *, cookies=None, headers=()):
        return {"type": "websocket", "path": "/ws/livequiz/1/", "cookies": cookies or {}, "headers": list(headers)}

    def test_the_browser_cookie_still_works(self):
        self.assertEqual(_resolve(self.scope(cookies={"lms_access": self.token})), self.student)

    def test_the_app_authenticates_with_a_bearer_header(self):
        user = _resolve(self.scope(headers=[(b"authorization", f"Bearer {self.token}".encode())]))
        self.assertEqual(user, self.student)

    def test_a_bad_bearer_is_anonymous_not_an_error(self):
        user = _resolve(self.scope(headers=[(b"authorization", b"Bearer not-a-token")]))
        self.assertFalse(user.is_authenticated)

    def test_no_credentials_is_anonymous(self):
        self.assertFalse(_resolve(self.scope()).is_authenticated)
