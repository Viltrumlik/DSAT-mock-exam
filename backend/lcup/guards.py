"""What the classes app asks of lc-up — imported lazily from its views, so ``classes`` keeps no
import-time dependency on this app.

A class paired with an lc-up group takes its students from lc-up (the owner's decision). Adding or
removing a student here by hand would be undone by the next sync — or worse, a removal here would
keep someone out whom lc-up still bills — so those edits are refused with a 409 that says where to
make them. The same holds for the class details lc-up writes (``LCUP_OWNED_CLASS_FIELDS``), its
teacher (``follow_teachers`` overwrites it) and the class's existence. TA seats are ours and stay open.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response

from .conf import lcup_enabled
from .models import AccountClaim, GroupLinkStatus, LcupGroupLink


def is_lcup_managed(classroom) -> bool:
    if not lcup_enabled() or classroom is None:
        return False
    # A deleted group's class no longer follows lc-up, so its roster is ours to edit again.
    return LcupGroupLink.objects.filter(
        classroom=classroom, status=GroupLinkStatus.CONFIRMED, deleted_in_lcup_at__isnull=True
    ).exists()


def lcup_managed_ids(classroom_ids) -> set[int]:
    """The classes among ``classroom_ids`` that follow lc-up — ``is_lcup_managed`` for many at once."""
    ids = [i for i in classroom_ids if i is not None]
    if not lcup_enabled() or not ids:
        return set()
    return set(
        LcupGroupLink.objects.filter(
            classroom_id__in=ids, status=GroupLinkStatus.CONFIRMED, deleted_in_lcup_at__isnull=True
        ).values_list("classroom_id", flat=True)
    )


#: What lc-up writes onto a paired class (lcup.follow.follow_details, archive_class, reopen_class) — changed
#: here, it would be undone within 15 minutes, and archiving would turn its students public at the next sync.
LCUP_OWNED_CLASS_FIELDS = (
    "name", "subject", "level", "lesson_days", "lesson_time", "lesson_hours", "branch", "room_number",
    "start_date", "is_active",
)


def _as_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value).strip()


def lcup_owned_changes(classroom, data) -> list[str]:
    """The lc-up-owned fields ``data`` would CHANGE on ``classroom`` — the same value sent again is no
    change, so a form that posts every field whole is not refused for the ones it left alone."""
    out = []
    for field in LCUP_OWNED_CLASS_FIELDS:
        if field not in data:
            continue
        current = classroom.branch_id if field == "branch" else getattr(classroom, field, None)
        raw = data[field]
        if field == "branch" and isinstance(raw, dict):
            raw = raw.get("id")
        if isinstance(current, bool):
            raw = str(raw).strip().lower() in ("1", "true", "yes", "on")
        if _as_text(current) != _as_text(raw):
            out.append(field)
    return out


def lcup_managed_response(fields: list[str] | None = None, detail: str | None = None) -> Response:
    """409 ``lcup_managed``. With no arguments it is the roster refusal, word for word as it always was;
    with ``fields`` it names what lc-up sets, so the form can say which of its fields to leave alone."""
    if not fields and not detail:
        body = {"detail": "This class's students come from lc-up. Add or remove students there.", "code": "lcup_managed"}
    else:
        body = {
            "detail": detail
            or "lc-up sets " + ", ".join(f.replace("_", " ") for f in fields) + " for this class. Change it in lc-up.",
            "code": "lcup_managed",
            "fields": list(fields or []),
        }
    return Response(body, status=status.HTTP_409_CONFLICT)


def pending_claim_user_ids(user_ids) -> set[int]:
    """Accounts the sync created whose owner has not signed in and chosen a password yet."""
    return set(
        AccountClaim.objects.filter(user_id__in=list(user_ids), password_set_at__isnull=True).values_list(
            "user_id", flat=True
        )
    )
