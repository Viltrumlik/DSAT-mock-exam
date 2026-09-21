"""Which moves are legal. One table, consulted before every transition.

Kept apart from the services that perform the moves so the rules can be read, and tested,
without a database. The services layer calls :func:`assert_transition` and then writes under
compare-and-set (``engine_db_guard``); this module never touches a row.
"""

from __future__ import annotations

from . import constants as const


class InvalidTransition(Exception):
    """A move that the rules do not allow, e.g. opening a question that is already open."""

    def __init__(self, frm: str, to: str):
        self.frm = frm
        self.to = to
        super().__init__(f"Cannot move a live quiz from {frm} to {to}.")


# The whole game, as a table.
#
# Note what is NOT here: nothing leaves FINISHED or TERMINATED. A finished game cannot take
# another answer and a terminated one cannot be rejoined, and that is enforced by the
# absence of an edge rather than by a check somebody has to remember to write.
ALLOWED: dict[str, frozenset[str]] = {
    const.STATUS_LOBBY: frozenset({const.STATUS_STARTING, const.STATUS_TERMINATED}),
    const.STATUS_STARTING: frozenset(
        {const.STATUS_QUESTION_ACTIVE, const.STATUS_PAUSED, const.STATUS_TERMINATED}
    ),
    const.STATUS_QUESTION_ACTIVE: frozenset(
        {const.STATUS_QUESTION_RESULTS, const.STATUS_PAUSED, const.STATUS_TERMINATED}
    ),
    const.STATUS_QUESTION_RESULTS: frozenset(
        {
            const.STATUS_QUESTION_ACTIVE,   # advance to the next question
            const.STATUS_FINISHED,          # that was the last one
            const.STATUS_PAUSED,
            const.STATUS_TERMINATED,
        }
    ),
    # Resume returns to whatever was interrupted; the session remembers it in `paused_from`.
    const.STATUS_PAUSED: frozenset(
        {
            const.STATUS_STARTING,
            const.STATUS_QUESTION_ACTIVE,
            const.STATUS_QUESTION_RESULTS,
            const.STATUS_FINISHED,
            const.STATUS_TERMINATED,
        }
    ),
    const.STATUS_FINISHED: frozenset(),
    const.STATUS_TERMINATED: frozenset(),
}


def can_transition(frm: str, to: str) -> bool:
    return to in ALLOWED.get(str(frm), frozenset())


def assert_transition(frm: str, to: str) -> None:
    if not can_transition(frm, to):
        raise InvalidTransition(frm, to)


def accepts_answers(status: str) -> bool:
    """Only one state takes answers. Results, lobby, paused and both terminal states do not."""
    return status == const.STATUS_QUESTION_ACTIVE


def accepts_joins(status: str) -> bool:
    """A latecomer may still join a game in progress — they simply have nothing scored yet.

    Deliberately different from a mock sitting, which closes the door at Start because the
    clock has begun. A quiz is per-question, so a student walking in late is only late for
    the questions already asked.
    """
    return status in const.LIVE_STATUSES
