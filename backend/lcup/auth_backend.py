"""First sign-in for an account the lc-up sync created: login = phone, password = its last four
digits (the owner's choice).

The code is guessable by anyone who knows the phone, so it is only accepted while the claim is
open: no password chosen yet, fewer than five wrong tries, and within fourteen days. After that
the admin reissues it. It runs LAST in ``AUTHENTICATION_BACKENDS``, so an ordinary password is
always tried first, and it never lets in an account that already has a usable password.
"""

from __future__ import annotations

import hmac

from django.contrib.auth.backends import BaseBackend
from django.utils import timezone

from users.models import SecurityAuditEvent, User

from .conf import lcup_enabled
from .models import AccountClaim
from .phones import normalize_phone


def _audit(user, event_type: str, request, severity: str = SecurityAuditEvent.SEVERITY_INFO, **detail) -> None:
    meta = getattr(request, "META", None) or {}
    try:
        SecurityAuditEvent.objects.create(
            user=user,
            event_type=event_type,
            severity=severity,
            ip=str(meta.get("REMOTE_ADDR", ""))[:64],
            user_agent=str(meta.get("HTTP_USER_AGENT", ""))[:512],
            detail=detail,
        )
    except Exception:
        pass  # an audit failure must never decide a sign-in


class LcupClaimBackend(BaseBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if not lcup_enabled() or not password:
            return None
        phone = normalize_phone(username or kwargs.get(User.USERNAME_FIELD))
        if not phone:
            return None
        claim = AccountClaim.objects.select_related("user").filter(phone=phone).first()
        now = timezone.now()
        if claim is None or not claim.can_attempt(now):
            return None
        user = claim.user
        if not user.is_active or user.has_usable_password():
            return None
        if hmac.compare_digest(str(password), phone[-4:]):
            claim.record_success(now)
            _audit(user, "lcup_claim_login", request)
            return user
        claim.record_failure(now)
        _audit(
            user,
            "lcup_claim_failed",
            request,
            severity=SecurityAuditEvent.SEVERITY_WARNING,
            attempts=claim.failed_attempts,
            locked=claim.locked_at is not None,
        )
        return None

    def get_user(self, user_id):
        return User.objects.filter(pk=user_id, is_active=True).first()
