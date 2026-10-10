"""The Windows app's own endpoints: "Sign in with browser", and the browser exemptions.

Sign in with browser (RFC 7636 PKCE). Google refuses to sign in inside an embedded WebView and
Telegram's popup is unreliable there, so the app hands sign-in to the real browser:

    app      makes a verifier, opens  https://mastersat.uz/desktop/link?challenge=S256(verifier)
    browser  student signs in however they like, presses "Open the MasterSAT app"
             POST auth/code/ {challenge}          → a one-time code, CODE_TTL_SECONDS
             navigates to mastersat://auth?code=…
    app      POST auth/exchange/ {code, verifier} → the site's own auth cookies, in its WebView

A code is worthless without the verifier, which never left the app — so another program that
grabs the ``mastersat://`` link gets nothing, and a link an attacker sends cannot sign the app
into the attacker's account (their challenge was not this app's).
"""

from __future__ import annotations

import hmac
import logging
import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from midterms.views_teacher import IsTeacherOrStaff, _display_name
from users.auth_cookies import is_native_client, set_auth_cookies
from users.models import RefreshSession
from users.views import _console_refusal_for, _session_fingerprint

from .models import DesktopAuthCode, DesktopExemption
from .proof import new_secret, pkce_challenge, sha256_hex

logger = logging.getLogger(__name__)
User = get_user_model()

CODE_TTL_SECONDS = 120

#: RFC 7636: a challenge is base64url(sha256), 43 characters; a verifier is 43–128 unreserved.
_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_VERIFIER_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")


class AuthCodeView(APIView):
    """`POST /api/desktop/auth/code/ {challenge}` — signed in on the website, mint the app a code."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        challenge = str(request.data.get("challenge") or "").strip()
        if not _CHALLENGE_RE.match(challenge):
            return Response({"detail": "Invalid challenge."}, status=status.HTTP_400_BAD_REQUEST)
        code = new_secret()
        DesktopAuthCode.objects.create(
            code_hash=sha256_hex(code),
            challenge=challenge,
            user=request.user,
            expires_at=timezone.now() + timedelta(seconds=CODE_TTL_SECONDS),
        )
        # Housekeeping without a scheduler: codes live two minutes, so anything older than a day
        # is long dead. Cheap — the expiry column is indexed.
        DesktopAuthCode.objects.filter(expires_at__lt=timezone.now() - timedelta(days=1)).delete()
        return Response({"code": code, "expires_in": CODE_TTL_SECONDS})


class AuthExchangeView(APIView):
    """`POST /api/desktop/auth/exchange/ {code, verifier}` — the app redeems the code for cookies."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "desktop_auth"

    def post(self, request):
        code = str(request.data.get("code") or "").strip()
        verifier = str(request.data.get("verifier") or "").strip()
        if not code or not _VERIFIER_RE.match(verifier):
            return self._refused()
        with transaction.atomic():
            row = (
                DesktopAuthCode.objects.select_for_update()
                .select_related("user")
                .filter(code_hash=sha256_hex(code))
                .first()
            )
            if row is None or row.used_at is not None or row.expires_at < timezone.now():
                return self._refused()
            # Spent on the first try either way: a code is one guess.
            row.used_at = timezone.now()
            row.save(update_fields=["used_at"])
            if not hmac.compare_digest(pkce_challenge(verifier), row.challenge):
                logger.warning("[FORENSIC] desktop_auth_verifier_mismatch user_id=%s", row.user_id)
                return self._refused()
            user = row.user
        if not user.is_active:
            return self._refused()
        denied = _console_refusal_for(request, user)
        if denied is not None:
            return denied

        refresh = RefreshToken.for_user(user)
        access_str = str(refresh.access_token)
        refresh_str = str(refresh)
        # The native app holds the pair itself and sends `Authorization: Bearer`, so it gets the
        # tokens in the body and NO cookie — exactly as login and /api/auth/refresh/ treat native
        # clients. Planting a cookie would be worse than useless: the app's HTTP client keeps a
        # cookie jar, and a request that carries an auth cookie is no longer a native one, so every
        # POST after sign-in would hit the browser CSRF rule. A browser caller gets {"ok": True}
        # and the HttpOnly cookies, unchanged.
        if is_native_client(request):
            resp = Response({"ok": True, "access": access_str, "refresh": refresh_str})
        else:
            resp = Response({"ok": True})
            set_auth_cookies(
                response=resp,
                request=request,
                access=access_str,
                refresh=refresh_str,
                remember_me=True,
            )
        # Recorded like every other sign-in, so the laptop shows up in the student's session
        # list and "sign out everywhere" reaches it.
        try:
            ip, ua = _session_fingerprint(request)
            RefreshSession.objects.update_or_create(
                refresh_jti=str(refresh.get("jti") or ""),
                defaults={"user": user, "revoked_at": None, "ip": ip, "user_agent": ua},
            )
        except Exception:  # pragma: no cover - a missing session row must not undo a sign-in
            logger.exception("desktop_auth_session_row_failed user_id=%s", user.pk)
        return resp

    @staticmethod
    def _refused():
        return Response(
            {"detail": "This sign-in link has expired. Sign in again from the app."},
            status=status.HTTP_400_BAD_REQUEST,
        )


def _student_brief(user) -> dict:
    return {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "email": user.email,
    }


def _exemption_row(row: DesktopExemption) -> dict:
    return {
        "id": row.id,
        "student": _student_brief(row.student),
        "reason": row.reason,
        "granted_by": _display_name(row.granted_by) if row.granted_by_id else "",
        "created_at": row.created_at.isoformat(),
    }


class ExemptionListView(APIView):
    """`GET/POST /api/desktop/exemptions/` — students allowed to sit midterms in the browser."""

    permission_classes = [IsTeacherOrStaff]

    def get(self, request):
        rows = DesktopExemption.objects.filter(revoked_at__isnull=True).select_related("student", "granted_by")
        return Response({"results": [_exemption_row(r) for r in rows]})

    def post(self, request):
        student = get_object_or_404(User, pk=request.data.get("student_id"), role="student")
        reason = str(request.data.get("reason") or "").strip()[:200]
        live = DesktopExemption.objects.filter(student=student, revoked_at__isnull=True).first()
        if live is not None:
            return Response(_exemption_row(live), status=status.HTTP_200_OK)
        try:
            # A savepoint, so the race below leaves the request's transaction usable on Postgres.
            with transaction.atomic():
                row = DesktopExemption.objects.create(student=student, reason=reason, granted_by=request.user)
        except IntegrityError:
            # Two teachers pressed it at once; the other one's row is the live one.
            row = DesktopExemption.objects.get(student=student, revoked_at__isnull=True)
            return Response(_exemption_row(row), status=status.HTTP_200_OK)
        return Response(_exemption_row(row), status=status.HTTP_201_CREATED)


class ExemptionRevokeView(APIView):
    """`POST /api/desktop/exemptions/<id>/revoke/` — the student is back to the app."""

    permission_classes = [IsTeacherOrStaff]

    def post(self, request, pk: int):
        row = get_object_or_404(DesktopExemption, pk=pk)
        if row.revoked_at is None:
            row.revoked_at = timezone.now()
            row.revoked_by = request.user
            row.save(update_fields=["revoked_at", "revoked_by"])
        return Response({"ok": True})
