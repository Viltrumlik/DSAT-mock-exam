from rest_framework.permissions import BasePermission

from access import constants as acc_const


class IsAuthenticatedAndNotFrozen(BasePermission):
    """
    Allow authenticated users, but block frozen students from API actions.
    """

    message = "Your account is frozen. Contact an administrator."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        role = str(getattr(user, "role", "") or "").strip().lower()
        if role in acc_const.LEARNER_ROLES and getattr(user, "is_frozen", False):
            return False
        return True
