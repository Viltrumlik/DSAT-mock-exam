"""The first-password step for accounts the lc-up sync created.

Such an account signs in once with phone + last four digits, and from then on must choose a
password before anything else opens. That is expressed as one more *missing profile field* —
``"password"`` — so the existing completion gate (``ProfileCompletionGate`` on the client, driven
by ``missing_fields``) asks for it first, before names and email, with no second gate to keep in
step.
"""

from __future__ import annotations

from django.contrib.auth.password_validation import validate_password
from django.db import transaction

from .models import AccountClaim


def password_requirement(user) -> list[str]:
    # No query for the ordinary case: an account with a usable password has nothing to choose.
    if user is None or not getattr(user, "pk", None) or user.has_usable_password():
        return []
    if AccountClaim.objects.filter(user_id=user.pk, password_set_at__isnull=True).exists():
        return ["password"]
    return []


def set_initial_password(user, raw_password: str, *, now) -> None:
    claim = AccountClaim.objects.filter(user_id=user.pk, password_set_at__isnull=True).first()
    if claim is None or user.has_usable_password():
        raise PermissionError("this account has no first password to choose")
    validate_password(raw_password, user)
    with transaction.atomic():
        user.set_password(raw_password)
        user.save(update_fields=["password"])
        claim.password_set_at = now
        claim.save(update_fields=["password_set_at"])
