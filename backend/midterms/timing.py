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
    """Timing for an ACTIVE midterm attempt. Returns None when not yet started.

    The limit comes from the midterm's ``duration_minutes``. A non-positive limit is
    treated as "no expiry" (defensive) rather than expiring instantly.
    """
    started = getattr(attempt, "started_at", None)
    if not started:
        return None
    if now is None:
        now = timezone.now()
    duration = int(getattr(attempt.midterm, "duration_minutes", 0) or 0)
    limit_seconds = duration * 60
    if limit_seconds <= 0:
        limit_seconds = 10**9
    return MidtermTiming(now=now, started_at=started, limit_seconds=limit_seconds)
