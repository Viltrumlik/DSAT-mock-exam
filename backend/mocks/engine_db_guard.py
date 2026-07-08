"""CAS conditional update for the mock attempt row (mirrors exams.engine_db_guard)."""

from __future__ import annotations

from typing import Any

from django.apps import apps


class TransitionConflict(Exception):
    """Row did not match expected state/version (another writer won or stale read)."""


def conditional_mock_attempt_update(*, pk: int, expect_state: str, expect_version: int, updates: dict[str, Any]) -> int:
    MockAttempt = apps.get_model("mocks", "MockAttempt")
    return int(
        MockAttempt.objects.filter(
            pk=pk, current_state=str(expect_state), version_number=int(expect_version)
        ).update(**updates)
    )


__all__ = ["conditional_mock_attempt_update", "TransitionConflict"]
