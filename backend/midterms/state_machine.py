"""Midterm attempt state machine (single- or two-module).

A single-module midterm is strictly: NOT_STARTED -> ACTIVE -> SCORING -> COMPLETED.
A two-module midterm inserts one edge: ACTIVE (module 1) -> MODULE_2_ACTIVE -> SCORING.
The ACTIVE -> SCORING edge is preserved, so a single-module attempt is unchanged. There is
no BREAK and no pause. ABANDONED exists only for admin void / re-grant. These string
constants are the single source of truth; the model imports them (``MidtermAttempt.STATE_*``).

Mirrors ``exams.attempt_state_machine`` but for the midterm topology (at most two modules).
"""

from __future__ import annotations

from typing import FrozenSet

from django.core.exceptions import ValidationError

STATE_NOT_STARTED = "NOT_STARTED"
STATE_ACTIVE = "ACTIVE"  # module 1 active (also the sole active state for a single-module midterm)
STATE_MODULE_2_ACTIVE = "MODULE_2_ACTIVE"
STATE_SCORING = "SCORING"
STATE_COMPLETED = "COMPLETED"
STATE_ABANDONED = "ABANDONED"

STATE_CHOICES = [
    (STATE_NOT_STARTED, "Not started"),
    (STATE_ACTIVE, "Active"),
    (STATE_MODULE_2_ACTIVE, "Module 2 active"),
    (STATE_SCORING, "Scoring"),
    (STATE_COMPLETED, "Completed"),
    (STATE_ABANDONED, "Abandoned"),
]

# On the wire the module-1 active state is reported as MODULE_1_ACTIVE so the frontend
# exam-runner's ``z.nativeEnum(ATTEMPT_STATE)`` (which has no bare ``ACTIVE``) parses.
WIRE_STATE = {
    STATE_NOT_STARTED: "NOT_STARTED",
    STATE_ACTIVE: "MODULE_1_ACTIVE",
    STATE_MODULE_2_ACTIVE: "MODULE_2_ACTIVE",
    STATE_SCORING: "SCORING",
    STATE_COMPLETED: "COMPLETED",
    STATE_ABANDONED: "ABANDONED",
}


class TransitionNotAllowed(ValidationError):
    """Rejected state change (illegal edge or concurrency conflict surface)."""


_EDGES: dict[str, FrozenSet[str]] = {
    STATE_NOT_STARTED: frozenset({STATE_ACTIVE}),
    # Module 1 either advances to module 2 (two-module midterm) or finishes (single-module).
    STATE_ACTIVE: frozenset({STATE_MODULE_2_ACTIVE, STATE_SCORING}),
    STATE_MODULE_2_ACTIVE: frozenset({STATE_SCORING}),
    STATE_SCORING: frozenset({STATE_COMPLETED}),
}


def allowed_primary_next_states(from_state: str) -> FrozenSet[str]:
    return _EDGES.get(from_state, frozenset())


def assert_primary_transition_allowed(from_state: str, to_state: str) -> None:
    """Raise TransitionNotAllowed if ``from_state -> to_state`` is not a canonical edge."""
    if from_state in (STATE_COMPLETED, STATE_ABANDONED):
        # Terminal sources are treated as allowed no-ops (idempotent replays).
        return
    ok = allowed_primary_next_states(from_state)
    if to_state not in ok:
        raise TransitionNotAllowed(
            f"Illegal midterm transition {from_state!r} -> {to_state!r}. Allowed: {sorted(ok)}.",
        )
