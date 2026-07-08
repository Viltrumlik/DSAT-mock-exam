"""Full-mock attempt state machine (4 modules across 2 subjects + a real break).

Progression: NOT_STARTED -> ENGLISH_M1 -> ENGLISH_M2 -> BREAK -> MATH_M1 -> MATH_M2 ->
SCORING -> COMPLETED. Strictly timed, no pause. The BREAK is a real, server-authoritative
phase (10 minutes by default). These string constants are the single source of truth; the
model imports them.
"""

from __future__ import annotations

from typing import FrozenSet

from django.core.exceptions import ValidationError

STATE_NOT_STARTED = "NOT_STARTED"
STATE_ENGLISH_M1 = "ENGLISH_M1_ACTIVE"
STATE_ENGLISH_M2 = "ENGLISH_M2_ACTIVE"
STATE_BREAK = "BREAK"
STATE_MATH_M1 = "MATH_M1_ACTIVE"
STATE_MATH_M2 = "MATH_M2_ACTIVE"
STATE_SCORING = "SCORING"
STATE_COMPLETED = "COMPLETED"
STATE_ABANDONED = "ABANDONED"

STATE_CHOICES = [
    (STATE_NOT_STARTED, "Not started"),
    (STATE_ENGLISH_M1, "English module 1"),
    (STATE_ENGLISH_M2, "English module 2"),
    (STATE_BREAK, "Break"),
    (STATE_MATH_M1, "Math module 1"),
    (STATE_MATH_M2, "Math module 2"),
    (STATE_SCORING, "Scoring"),
    (STATE_COMPLETED, "Completed"),
    (STATE_ABANDONED, "Abandoned"),
]

# Which (subject, module_order) each active state maps to.
ACTIVE_MODULE = {
    STATE_ENGLISH_M1: ("READING_WRITING", 1),
    STATE_ENGLISH_M2: ("READING_WRITING", 2),
    STATE_MATH_M1: ("MATH", 1),
    STATE_MATH_M2: ("MATH", 2),
}

# On the wire the active state is reported as MODULE_1/2_ACTIVE so the frontend exam-runner's
# z.nativeEnum(ATTEMPT_STATE) parses; BREAK is surfaced via a separate `is_on_break` flag.
WIRE_STATE = {
    STATE_NOT_STARTED: "NOT_STARTED",
    STATE_ENGLISH_M1: "MODULE_1_ACTIVE",
    STATE_ENGLISH_M2: "MODULE_2_ACTIVE",
    STATE_BREAK: "MODULE_2_SUBMITTED",
    STATE_MATH_M1: "MODULE_1_ACTIVE",
    STATE_MATH_M2: "MODULE_2_ACTIVE",
    STATE_SCORING: "SCORING",
    STATE_COMPLETED: "COMPLETED",
    STATE_ABANDONED: "ABANDONED",
}


class TransitionNotAllowed(ValidationError):
    """Rejected state change (illegal edge or concurrency conflict surface)."""


_EDGES: dict[str, FrozenSet[str]] = {
    STATE_NOT_STARTED: frozenset({STATE_ENGLISH_M1}),
    STATE_ENGLISH_M1: frozenset({STATE_ENGLISH_M2}),
    STATE_ENGLISH_M2: frozenset({STATE_BREAK}),
    STATE_BREAK: frozenset({STATE_MATH_M1}),
    STATE_MATH_M1: frozenset({STATE_MATH_M2}),
    STATE_MATH_M2: frozenset({STATE_SCORING}),
    STATE_SCORING: frozenset({STATE_COMPLETED}),
}


def allowed_next_states(from_state: str) -> FrozenSet[str]:
    return _EDGES.get(from_state, frozenset())


def assert_transition_allowed(from_state: str, to_state: str) -> None:
    if from_state in (STATE_COMPLETED, STATE_ABANDONED):
        return
    ok = allowed_next_states(from_state)
    if to_state not in ok:
        raise TransitionNotAllowed(
            f"Illegal mock transition {from_state!r} -> {to_state!r}. Allowed: {sorted(ok)}.",
        )
