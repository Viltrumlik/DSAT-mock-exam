"""Server-authoritative single-module midterm timing.

A midterm has ONE timer anchored at ``MidtermAttempt.started_at`` (written ``or now``
on first activation and NEVER rewound) with a fixed limit of ``Midterm.duration_minutes``.
There is NO pause, so ``paused_seconds`` is always 0. Mirrors the semantics of
``exams.attempt_timing.ModuleTiming`` minus the pause bookkeeping.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.utils import timezone


@dataclass(frozen=True)
class MidtermTiming:
    now: timezone.datetime
    started_at: timezone.datetime
    limit_seconds: int

    @property
    def elapsed_seconds(self) -> int:
        dt = self.now - self.started_at
        return max(0, int(dt.total_seconds()))

    @property
    def remaining_seconds(self) -> int:
        return max(0, int(self.limit_seconds) - self.elapsed_seconds)

    @property
    def is_expired(self) -> bool:
        return self.elapsed_seconds >= int(self.limit_seconds)


def get_midterm_timing(attempt, *, now: timezone.datetime | None = None) -> MidtermTiming | None:
    """Timing for the CURRENTLY-ACTIVE module of a midterm attempt. None when not started.

    Picks the anchor + limit for the live module: module 1 uses ``started_at`` +
    ``duration_minutes``; module 2 uses ``module_2_started_at`` + ``duration_minutes_2``.
    A single-module attempt never reaches MODULE_2_ACTIVE, so its path is identical to
    before. A non-positive limit is treated as "no expiry" (defensive).
    """
    from .state_machine import STATE_MODULE_2_ACTIVE

    if getattr(attempt, "current_state", None) == STATE_MODULE_2_ACTIVE:
        started = getattr(attempt, "module_2_started_at", None)
        duration = attempt.midterm.duration_for_order(2)
    else:  # module 1 (or any not-yet-module-2 state) — identical to the previous behaviour
        started = getattr(attempt, "started_at", None)
        duration = attempt.midterm.duration_for_order(1)
    if not started:
        return None
    if now is None:
        now = timezone.now()
    limit_seconds = duration * 60
    if limit_seconds <= 0:
        limit_seconds = 10**9
    return MidtermTiming(now=now, started_at=started, limit_seconds=limit_seconds)
