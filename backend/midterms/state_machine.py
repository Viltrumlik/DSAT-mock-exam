"""Single-module midterm attempt state machine.

A midterm is strictly one module: NOT_STARTED -> ACTIVE -> SCORING -> COMPLETED.
There is no MODULE_1/MODULE_2 split, no BREAK, no pause. ABANDONED exists only for
admin void / re-grant. These string constants are the single source of truth; the
model imports them (``MidtermAttempt.STATE_*``).

Mirrors ``exams.attempt_state_machine`` but for the collapsed single-module topology.
"""

from __future__ import annotations

from typing import FrozenSet

from django.core.exceptions import ValidationError

STATE_NOT_STARTED = "NOT_STARTED"
STATE_ACTIVE = "ACTIVE"
STATE_SCORING = "SCORING"
STATE_COMPLETED = "COMPLETED"
STATE_ABANDONED = "ABANDONED"

STATE_CHOICES = [
    (STATE_NOT_STARTED, "Not started"),
    (STATE_ACTIVE, "Active"),
    (STATE_SCORING, "Scoring"),
    (STATE_COMPLETED, "Completed"),
    (STATE_ABANDONED, "Abandoned"),
]

# On the wire the single active state is reported as MODULE_1_ACTIVE so the frontend
# exam-runner's ``z.nativeEnum(ATTEMPT_STATE)`` (which has no bare ``ACTIVE``) parses.
WIRE_STATE = {
    STATE_NOT_STARTED: "NOT_STARTED",
    STATE_ACTIVE: "MODULE_1_ACTIVE",
    STATE_SCORING: "SCORING",
    STATE_COMPLETED: "COMPLETED",
    STATE_ABANDONED: "ABANDONED",
}


class TransitionNotAllowed(ValidationError):
    """Rejected state change (illegal edge or concurrency conflict surface)."""


_EDGES: dict[str, FrozenSet[str]] = {
    STATE_NOT_STARTED: frozenset({STATE_ACTIVE}),
    STATE_ACTIVE: frozenset({STATE_SCORING}),
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
