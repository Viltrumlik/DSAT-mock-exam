"""Power-ups: what a streak earns, and what each one does.

Pure rules over plain values. Who holds what, and what is armed for the question in front of
them, lives on the participant row (``powerups`` and ``armed``); applying one is a move in
``paced``, under the same row lock as answering, so a power-up and an answer cannot race.

Five of them, all about the student's OWN question. Nothing here reaches into anybody else's
game: a room of teenagers does not need a button that wrecks a classmate's screen.

    double         a right answer on this question scores twice
    fifty_fifty    two wrong options disappear
    eraser         one wrong option disappears
    streak_saver   a wrong answer (or running out of time) does not break the streak
    time_freeze    the clock stops; the speed bonus stays where it was when it was used

They are earned, never bought: every ``AWARD_EVERY`` right answers in a row hands the student
one at random, up to ``MAX_HELD``. Student-paced games only — in a teacher-paced one the whole
room is on the same clock, and freezing it for one student would not mean anything.
"""

from __future__ import annotations

import random

DOUBLE = "double"
FIFTY_FIFTY = "fifty_fifty"
ERASER = "eraser"
STREAK_SAVER = "streak_saver"
TIME_FREEZE = "time_freeze"

ALL = (DOUBLE, FIFTY_FIFTY, ERASER, STREAK_SAVER, TIME_FREEZE)

# The two that take options away only make sense on a question with options to take.
HIDES_OPTIONS = {FIFTY_FIFTY: 2, ERASER: 1}

# One power-up for every three right answers in a row.
AWARD_EVERY = 3

# Enough to make a choice about, not so many that the bar becomes the game.
MAX_HELD = 3


def earns_one(*, streak: int, held: int) -> bool:
    """True when this right answer completes a run worth a power-up and there is room."""
    return streak > 0 and streak % AWARD_EVERY == 0 and held < MAX_HELD


def pick(rng: random.Random | None = None) -> str:
    return (rng or random).choice(ALL)


def options_to_hide(
    *,
    key: str,
    choices: list,
    correct_answer,
    already_hidden: list,
    rng: random.Random | None = None,
) -> list[str]:
    """Which wrong options this power-up takes away. Empty when there is nothing left to take.

    Never the right answer, never one already gone, and never so many that only the answer is
    left — a question with one option is not a question.
    """
    want = HIDES_OPTIONS.get(key, 0)
    if want == 0:
        return []
    key_id = str(correct_answer or "").strip().upper()
    gone = {str(value) for value in (already_hidden or [])}
    candidates = [
        str(choice.get("id"))
        for choice in (choices or [])
        if isinstance(choice, dict)
        and str(choice.get("id") or "").strip().upper() != key_id
        and str(choice.get("id")) not in gone
    ]
    # Keep at least one wrong option on screen.
    take = min(want, max(0, len(candidates) - 1))
    if take == 0:
        return []
    return (rng or random).sample(candidates, take)
