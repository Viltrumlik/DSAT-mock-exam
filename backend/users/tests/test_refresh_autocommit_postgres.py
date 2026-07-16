"""Refresh must work under PRODUCTION semantics: Postgres + autocommit.

REGRESSION (prod outage, ~2.5 months, found 2026-07-16). The session probe in
CookieTokenRefreshView called ``.select_for_update()`` outside any ``transaction.atomic()``.
Requests run in autocommit (ATOMIC_REQUESTS is not set), and:

  - SQLite   -> has_select_for_update = False -> the lock is a silent NO-OP -> tests pass
  - Postgres -> has_select_for_update = True  -> TransactionManagementError, raised at
                COMPILE time -> the bare ``except`` returned 401 "Session validation
                failed." for EVERY refresh, with no audit row and no log.

So the whole suite stayed green while refresh was 100% broken on prod: once a student's
3h access token expired mid-exam it could never be renewed, and every request 401'd —
which is why pastpaper modules could not be submitted.

TWO things conspired to hide it, and this module defeats BOTH:
  1. SQLite's has_select_for_update=False -> patched True here.
  2. Django's TestCase wraps each test in a transaction (autocommit off), which makes
     select_for_update legal -> TransactionTestCase is used so we run in autocommit.

The view is called through APIRequestFactory rather than the test client so this stays a
focused test of the view's DB semantics, not of CSRF/host middleware.
"""
from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from users.auth_cookies import REFRESH_COOKIE
from users.models import RefreshSession
from users.views import CookieTokenRefreshView

User = get_user_model()


def _postgres_lock_semantics():
    """Simulate Postgres' select_for_update ERROR behaviour on SQLite.

    Postgres sets has_select_for_update=True, which makes Django raise
    TransactionManagementError for a lock taken outside a transaction — the prod bug.
    Flipping the flag True unconditionally would also make Django emit real ``FOR UPDATE``
    SQL for the LEGITIMATE locked read inside ``transaction.atomic()``, which SQLite
    cannot parse ("near FOR: syntax error") — that would fail the test for the wrong
    reason and hide what we're actually asserting.

    So report True only OUTSIDE a transaction: that is precisely where Postgres raises
    and where a mis-scoped lock is a bug. Inside atomic() we report False, so the
    legitimate lock degrades to a no-op and SQLite can execute it.
    """
    return patch.object(
        type(connection.features),
        "has_select_for_update",
        property(lambda self: not connection.in_atomic_block),
    )


class RefreshUnderPostgresAutocommitTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user("refresh_pg@test.com", "secret123")
        self.factory = APIRequestFactory()

    def _issue_session(self) -> str:
        """Mint a real refresh token plus its server-side session row, as login does."""
        token = RefreshToken.for_user(self.user)
        RefreshSession.objects.create(
            user=self.user, refresh_jti=str(token["jti"]), ip="127.0.0.1", user_agent="test"
        )
        return str(token)

    def _refresh(self, raw: str):
        request = self.factory.post("/api/auth/refresh/", {}, format="json")
        request.COOKIES[REFRESH_COOKIE] = raw
        return CookieTokenRefreshView.as_view()(request)

    def test_refresh_succeeds_under_postgres_lock_semantics(self):
        raw = self._issue_session()
        with _postgres_lock_semantics():
            resp = self._refresh(raw)
        self.assertEqual(
            resp.status_code, 200,
            f"refresh must work on Postgres+autocommit; got {resp.status_code} {getattr(resp, 'data', None)!r}",
        )

    def test_refresh_rotates_the_session_under_postgres_semantics(self):
        raw = self._issue_session()
        with _postgres_lock_semantics():
            self._refresh(raw)
        # Rotation: the presented session is revoked, exactly one fresh session remains.
        self.assertEqual(
            RefreshSession.objects.filter(user=self.user, revoked_at__isnull=True).count(), 1
        )
        self.assertTrue(
            RefreshSession.objects.filter(user=self.user, revoked_at__isnull=False).exists()
        )

    def test_a_token_with_no_session_row_is_still_rejected(self):
        """The fix must not weaken the allowlist: no session row -> still 401."""
        token = RefreshToken.for_user(self.user)  # deliberately no RefreshSession
        with _postgres_lock_semantics():
            resp = self._refresh(str(token))
        self.assertEqual(resp.status_code, 401)
