"""Normalization and duplicate detection for a user's real name.

Kept as a leaf module (no DRF, no views) so serializers, views and the upcoming
profile-completeness check can all share one definition of "same person" without
importing each other.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model

User = get_user_model()

DUPLICATE_FULL_NAME_CODE = "duplicate_full_name"
DUPLICATE_FULL_NAME_MESSAGE = (
    "A student with this first and last name already exists. If this is you, sign in "
    "instead of registering again. If you are a different person with the same name, "
    "ask an administrator to create your account."
)


def normalize_name(value: str | None) -> str:
    """Trim and collapse internal whitespace. ``"  Ali   Vali "`` -> ``"Ali Vali"``."""
    return " ".join(str(value or "").split())


def find_users_by_full_name(first_name: str, last_name: str):
    """Rows whose first+last name match, ignoring case and surrounding whitespace.

    Deliberately an exact (case-insensitive) match rather than a fuzzy one: fuzzy
    matching on Uzbek transliteration variants would reject unrelated people, and the
    caller uses this to *block* a registration.
    """
    first = normalize_name(first_name)
    last = normalize_name(last_name)
    if not first or not last:
        return User.objects.none()
    return User.objects.filter(first_name__iexact=first, last_name__iexact=last)


def full_name_taken(first_name: str, last_name: str, *, exclude_pk=None) -> bool:
    qs = find_users_by_full_name(first_name, last_name)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()
