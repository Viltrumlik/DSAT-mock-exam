"""Whose account an actor may change from the admin console.

``UserSerializer`` ranks the role being GIVEN: nobody hands out a role above their own. This ranks the
account being CHANGED. Without it an admin could set the owner's password or phone, demote, freeze or
delete them, or sign them out everywhere — any admin could make themselves owner.

The rule: the owner (a super admin, or a Django superuser whatever its role string says) may change any
account. Everyone else may change only accounts ranked strictly below their own — so an admin manages
learners and teachers, never another admin, an owner, or their own account from the console (their own
details live on their profile).
"""

from __future__ import annotations

from rest_framework.exceptions import PermissionDenied

from access import constants as C
from access.services import normalized_role

OWNER_ONLY = "Only the owner can change this account."


def _ranks() -> dict[str, int]:
    from .serializers import UserSerializer  # the one rank table; pinned against CANONICAL_ROLES

    return UserSerializer._ROLE_RANK


def account_rank(user) -> int:
    ranks = _ranks()
    if getattr(user, "is_superuser", False):
        return ranks[C.ROLE_SUPER_ADMIN]
    return ranks.get(normalized_role(user), 1)


def may_change_account(actor, target) -> bool:
    mine = account_rank(actor)
    if mine >= _ranks()[C.ROLE_SUPER_ADMIN]:
        return True
    return account_rank(target) < mine


def refuse_unless_may_change(actor, target) -> None:
    if not may_change_account(actor, target):
        raise PermissionDenied(OWNER_ONLY)
