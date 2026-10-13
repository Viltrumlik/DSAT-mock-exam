"""What the classes app asks of lc-up — imported lazily from its views, so ``classes`` keeps no
import-time dependency on this app.

A class paired with an lc-up group takes its students from lc-up (the owner's decision). Adding or
removing a student here by hand would be undone by the next sync — or worse, a removal here would
keep someone out whom lc-up still bills — so those edits are refused with a 409 that says where to
make them. Staff changes (TA, teacher) are ours and stay open.
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


def lcup_managed_response() -> Response:
    return Response(
        {"detail": "This class's students come from lc-up. Add or remove students there.", "code": "lcup_managed"},
        status=status.HTTP_409_CONFLICT,
    )


def pending_claim_user_ids(user_ids) -> set[int]:
    """Accounts the sync created whose owner has not signed in and chosen a password yet."""
    return set(
        AccountClaim.objects.filter(user_id__in=list(user_ids), password_set_at__isnull=True).values_list(
            "user_id", flat=True
        )
    )
