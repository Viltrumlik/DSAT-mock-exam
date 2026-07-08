"""Mock access — full mocks are practice simulations available to any student once published."""

from __future__ import annotations

from .models import Mock, MockAttempt


def accessible_mock_ids(user) -> set[int]:
    if not user or not getattr(user, "is_authenticated", False):
        return set()
    published = set(Mock.objects.filter(is_published=True).values_list("id", flat=True))
    attempted = set(MockAttempt.objects.filter(student=user).values_list("mock_id", flat=True))
    return published | attempted


def can_start_mock(user, mock) -> tuple[bool, str]:
    if not mock.is_published:
        return False, "mock_unpublished"
    return True, "ok"
