"""Server-authoritative timing for the active mock module + the break.

Anchors live in ``MockAttempt.phase_started_at`` ({state: iso}), written ``or now`` on first
entry and never rewound (strict, no pause). Mirrors ``exams.attempt_timing`` semantics.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone

from .state_machine import STATE_BREAK


def _parse(iso):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso)
    except (ValueError, TypeError):
        return None


@dataclass(frozen=True)
class Timing:
    now: datetime
    started_at: datetime
    limit_seconds: int
    # Seconds the student spent away from the exam during THIS phase — banked windows plus
    # any window still open. Counted against neither the timer nor the deadline. Always 0
    # for the break, which is not pausable.
    paused_seconds: int = 0

    @property
    def elapsed_seconds(self) -> int:
        spent = int((self.now - self.started_at).total_seconds())
        return max(0, spent - max(0, int(self.paused_seconds)))

    @property
    def remaining_seconds(self) -> int:
        return max(0, int(self.limit_seconds) - self.elapsed_seconds)

    @property
    def is_expired(self) -> bool:
        return self.elapsed_seconds >= int(self.limit_seconds)


def paused_seconds_for(attempt, state, *, now) -> int:
    """Banked pause for ``state`` plus the window still open, if the student is away now."""
    banked = int((getattr(attempt, "paused_seconds", None) or {}).get(state, 0) or 0)
    started = getattr(attempt, "pause_started_at", None)
    if started:
        banked += max(0, int((now - started).total_seconds()))
    return banked


def get_active_module_timing(attempt, *, now=None) -> Timing | None:
    mod = attempt.mock.active_module(attempt.current_state)
    if mod is None:
        return None
    state = attempt.current_state
    started = _parse((attempt.phase_started_at or {}).get(state))
    if not started:
        return None
    now = now or timezone.now()
    limit = int(getattr(mod, "time_limit_minutes", 0) or 0) * 60 or 10**9
    return Timing(
        now=now, started_at=started, limit_seconds=limit,
        paused_seconds=paused_seconds_for(attempt, state, now=now),
    )


def get_break_timing(attempt, *, now=None) -> Timing | None:
    if attempt.current_state != STATE_BREAK:
        return None
    started = _parse((attempt.phase_started_at or {}).get(STATE_BREAK))
    if not started:
        return None
    now = now or timezone.now()
    limit = int(getattr(attempt.mock, "break_minutes", 0) or 0) * 60
    return Timing(now=now, started_at=started, limit_seconds=limit)
