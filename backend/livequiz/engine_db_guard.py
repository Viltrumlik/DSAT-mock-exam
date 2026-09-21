"""Compare-and-set for the session row — transition safety in depth.

Mirrors ``midterms.engine_db_guard``. The rules in ``state_machine`` say which moves are
legal; this says only one caller may make a given move.

It matters most when a question closes, because three things race to close it: the timer
that fired at the deadline, the last student's answer arriving, and the host pressing skip.
All three read status=QUESTION_ACTIVE and all three try to write. With the version check
exactly one writes, the other two get 0 rows back, and they can tell that they lost rather
than each sending a "question ended" frame to thirty phones.
"""

from __future__ import annotations

from typing import Any

from django.db.models import F


class TransitionConflict(Exception):
    """The row moved under us: another writer won, or we read a stale copy."""


def conditional_session_update(
    *,
    pk: int,
    expect_status: str,
    expect_version: int,
    updates: dict[str, Any],
) -> int:
    """Apply ``updates`` iff status and version still match. Returns rows written (0 or 1).

    Always bumps ``version``, so a caller holding the old one loses. Callers that must not
    silently no-op should use :func:`require_session_update`.
    """
    from .models import LiveQuizSession

    return int(
        LiveQuizSession.objects.filter(
            pk=pk, status=str(expect_status), version=int(expect_version)
        ).update(version=F("version") + 1, **updates)
    )


def require_session_update(
    *,
    pk: int,
    expect_status: str,
    expect_version: int,
    updates: dict[str, Any],
) -> None:
    """:func:`conditional_session_update`, raising :class:`TransitionConflict` on a loss."""
    written = conditional_session_update(
        pk=pk, expect_status=expect_status, expect_version=expect_version, updates=updates
    )
    if written != 1:
        raise TransitionConflict(
            f"Live quiz session {pk} is no longer at {expect_status}/v{expect_version}."
        )


__all__ = ["TransitionConflict", "conditional_session_update", "require_session_update"]
