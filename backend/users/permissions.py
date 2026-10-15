from rest_framework.permissions import BasePermission

from access import constants as acc_const


def is_frozen_learner(user) -> bool:
    """A learner (student or public student) whose account is frozen.

    The flag means nothing on a staff account: the role is read first. REST applies this through
    ``IsAuthenticatedAndNotFrozen``; the live-quiz socket, which no DRF permission covers, calls
    it directly.
    """
    role = str(getattr(user, "role", "") or "").strip().lower()
    return role in acc_const.LEARNER_ROLES and bool(getattr(user, "is_frozen", False))


class IsAuthenticatedAndNotFrozen(BasePermission):
    """
    Allow authenticated users, but block frozen students from API actions.
    """

    message = "Your account is frozen. Contact an administrator."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return not is_frozen_learner(user)
