"""The rows ``/ops/lcup`` reads. Plain dicts: every view here is a small admin read with a fixed
shape, and the client's types (frontend/src/features/lcup/lcupApi.ts) mirror these exactly."""

from __future__ import annotations


def user_ref(user) -> dict | None:
    if user is None:
        return None
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return {"id": user.pk, "name": name or (user.username or ""), "username": user.username, "phone": user.phone_number}


def room_ref(room) -> dict | None:
    return {"id": room.pk, "name": room.name} if room is not None else None


def run_row(run) -> dict:
    return {
        "id": run.pk,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "dry_run": run.dry_run,
        "ok": run.ok,
        "counts": run.counts,
        "errors": run.errors,
        "alerts": run.alerts,
    }


def group_row(link) -> dict:
    snapshot = link.snapshot or {}
    suggestion = None
    if link.suggestion_id:
        suggestion = {**room_ref(link.suggestion), "score": link.suggestion_score, "reasons": link.suggestion_reasons}
    return {
        "id": link.pk,
        "lcup_group_id": link.lcup_group_id,
        "name": link.name,
        "course": (snapshot.get("course") or {}).get("name") or "",
        "days": snapshot.get("days") or [],
        "start_time": str(snapshot.get("start_time") or "")[:5],
        "finish_time": str(snapshot.get("finish_time") or "")[:5],
        "teachers": [t.get("name") or "" for t in snapshot.get("teachers") or []],
        "status": link.status,
        "deleted": link.deleted_in_lcup_at is not None,
        "classroom": room_ref(link.classroom),
        "suggestion": suggestion,
        # Why nothing was suggested, when nothing was ("no matching class; …").
        "notes": [] if suggestion else list(link.suggestion_reasons or []),
        "member_count": getattr(link, "member_count", None),
    }


def person_row(link, *, lcup_id: int, groups=()) -> dict:
    return {
        "id": link.pk,
        "lcup_id": lcup_id,
        "name": link.name,
        "phone": link.phone,
        "status": link.status,
        "reason": link.match_reason,
        "candidates": link.candidates,
        "user": user_ref(link.user),
        "groups": list(groups),
        "deleted": link.deleted_in_lcup,
    }


def claim_state(claim, now) -> str:
    if claim.password_set_at:
        return "done"
    if claim.locked_at:
        return "locked"
    if claim.expires_at <= now:
        return "expired"
    if claim.first_login_at:
        return "signed_in"
    return "pending"


def claim_row(claim, now) -> dict:
    return {
        "user": user_ref(claim.user),
        "phone": claim.phone,
        "state": claim_state(claim, now),
        "expires_at": claim.expires_at,
        "failed_attempts": claim.failed_attempts,
        "first_login_at": claim.first_login_at,
        "password_set_at": claim.password_set_at,
        "reissued_count": claim.reissued_count,
    }
