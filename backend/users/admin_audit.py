"""Who changed an account from /ops, and what (plan 2026-10-15-ops-detail-pages).

Each edit an admin makes to another account is a ``SecurityAuditEvent`` on the TARGET account with the
admin in ``detail``: the model has no actor column, and a new table is not worth a migration. A password
is recorded as changed, never by value. The person page's History reads these back.
"""

from __future__ import annotations

from .security_audit import log_security_event

ADMIN_UPDATE = "admin_user_update"
ADMIN_FREEZE = "admin_freeze"
ADMIN_UNFREEZE = "admin_unfreeze"
ADMIN_REVOKE_SESSIONS = "admin_revoke_sessions"
ADMIN_EVENT_TYPES = (ADMIN_UPDATE, ADMIN_FREEZE, ADMIN_UNFREEZE, ADMIN_REVOKE_SESSIONS)

#: The fields whose before and after are kept.
TRACKED = ("first_name", "last_name", "username", "email", "phone_number", "role", "subject", "is_frozen")


def snapshot(user) -> dict:
    return {f: getattr(user, f, None) for f in TRACKED}


def actor_of(request) -> dict:
    a = getattr(request, "user", None)
    name = f"{getattr(a, 'first_name', '') or ''} {getattr(a, 'last_name', '') or ''}".strip()
    return {"actor_id": getattr(a, "pk", None), "actor": name or getattr(a, "username", "") or ""}


def log_admin_update(*, request, user, before: dict, password_changed: bool) -> None:
    after = snapshot(user)
    changes = {f: [before.get(f), after[f]] for f in TRACKED if before.get(f) != after[f]}
    if not changes and not password_changed:
        return
    detail = {**actor_of(request), "changes": changes}
    if password_changed:
        detail["password_changed"] = True
    log_security_event(user_id=user.pk, event_type=ADMIN_UPDATE, request=request, detail=detail)


def log_admin_action(*, request, user_id: int, event_type: str, **extra) -> None:
    log_security_event(user_id=user_id, event_type=event_type, request=request, detail={**actor_of(request), **extra})
