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

    @property
    def elapsed_seconds(self) -> int:
        return max(0, int((self.now - self.started_at).total_seconds()))

    @property
    def remaining_seconds(self) -> int:
        return max(0, int(self.limit_seconds) - self.elapsed_seconds)

    @property
    def is_expired(self) -> bool:
        return self.elapsed_seconds >= int(self.limit_seconds)


def get_active_module_timing(attempt, *, now=None) -> Timing | None:
    mod = attempt.mock.active_module(attempt.current_state)
    if mod is None:
        return None
    started = _parse((attempt.phase_started_at or {}).get(attempt.current_state))
    if not started:
        return None
    now = now or timezone.now()
    limit = int(getattr(mod, "time_limit_minutes", 0) or 0) * 60 or 10**9
    return Timing(now=now, started_at=started, limit_seconds=limit)


def get_break_timing(attempt, *, now=None) -> Timing | None:
    if attempt.current_state != STATE_BREAK:
        return None
    started = _parse((attempt.phase_started_at or {}).get(STATE_BREAK))
    if not started:
        return None
    now = now or timezone.now()
    limit = int(getattr(attempt.mock, "break_minutes", 0) or 0) * 60
    return Timing(now=now, started_at=started, limit_seconds=limit)
