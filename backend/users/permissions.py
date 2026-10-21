from django.conf import settings
from rest_framework.permissions import BasePermission

from access import constants as acc_const


def is_freeze_exempt(user) -> bool:
    """One of the owner's test accounts, which the freeze does not lock out of the site.

    See ``settings.FREEZE_ACCESS_EXEMPT_EMAILS``. The account stays frozen everywhere it is
    SHOWN — ops, finance, rosters, lc-up — only the access checks below let it through.
    """
    exempt = getattr(settings, "FREEZE_ACCESS_EXEMPT_EMAILS", None) or ()
    if not exempt:
        return False
    email = str(getattr(user, "email", "") or "").strip().lower()
    return bool(email) and email in exempt


def is_frozen_for_access(user) -> bool:
    """Is this account frozen OUT of the site? The stored flag, unless the account is exempt.

    The one reading of the freeze for "may this account use MasterSAT". Anything that only
    REPORTS the freeze (a staff screen, a debt report, a roster badge) reads ``is_frozen``
    itself, so an exempt account still shows as frozen for debt there.
    """
    return bool(getattr(user, "is_frozen", False)) and not is_freeze_exempt(user)


def is_frozen_learner(user) -> bool:
    """A learner (student or public student) whose account is frozen.

    The flag means nothing on a staff account: the role is read first. REST applies this through
    ``IsAuthenticatedAndNotFrozen``; the live-quiz socket, which no DRF permission covers, calls
    it directly. An exempt test account is never one (``is_frozen_for_access``).
    """
    role = str(getattr(user, "role", "") or "").strip().lower()
    return role in acc_const.LEARNER_ROLES and is_frozen_for_access(user)


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
