import re

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

User = get_user_model()

_PHONE_TYPED = re.compile(r"^\+?[\d\s()\-]+$")


def _phone_username(typed: str) -> str | None:
    """The username an account named after its phone carries ("998901234567", as every account the
    lc-up sync creates does), however the phone was typed: "+998 90 123 45 67", "90-123-45-67".
    Same rule as ``lcup.phones.normalize_phone``; kept here so login does not depend on lc-up."""
    if not _PHONE_TYPED.match(typed):
        return None
    digits = re.sub(r"\D", "", typed)
    if len(digits) == 9:
        digits = "998" + digits
    return digits if len(digits) == 12 and digits.startswith("998") else None


class EmailOrUsernameModelBackend(ModelBackend):
    """Authenticate by email (the ``USERNAME_FIELD``) or by username."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if not username:
            # ``username`` is nullable on the model, so ``__iexact=None`` compiles to
            # ``IS NULL`` and would match every row that has no username. Burn a hash
            # anyway to keep the timing indistinguishable from an unknown account.
            User().set_password(password)
            return None

        matches = User.objects.filter(Q(username__iexact=username) | Q(email__iexact=username))
        # Email is the canonical login key, so it wins when some *other* row happens to
        # carry this address as its username. Never silently password-check an arbitrary
        # row: the old MultipleObjectsReturned branch fell back to the lowest id, which
        # locked the newer of two case-colliding usernames out with no explanation.
        user = matches.filter(email__iexact=username).first() or matches.order_by("id").first()
        if user is None:
            # Only when nothing matched as typed: a phone typed with "+", spaces or dashes finds the
            # account whose username is that phone. Never another account's phone_number field.
            phone = _phone_username(username)
            if phone and phone != username:
                user = User.objects.filter(username=phone).first()
        if user is None:
            User().set_password(password)
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
