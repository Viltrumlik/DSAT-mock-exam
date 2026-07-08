"""DB-layer conditional update for the midterm attempt row (transition safety in depth).

Mirrors ``exams.engine_db_guard`` for ``midterms.MidtermAttempt``.
"""

from __future__ import annotations

from typing import Any

from django.apps import apps


class TransitionConflict(Exception):
    """Row did not match expected state/version (another writer won or stale read)."""


def conditional_midterm_attempt_update(
    *,
    pk: int,
    expect_state: str,
    expect_version: int,
    updates: dict[str, Any],
) -> int:
    """Persist ``updates`` iff current_state/version still match. Returns rows updated (0 or 1)."""
    MidtermAttempt = apps.get_model("midterms", "MidtermAttempt")
    return int(
        MidtermAttempt.objects.filter(
            pk=pk,
            current_state=str(expect_state),
            version_number=int(expect_version),
        ).update(**updates)
    )


__all__ = ["conditional_midterm_attempt_update", "TransitionConflict"]
