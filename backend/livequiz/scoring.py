"""What an answer is worth, and how the final places are worked out.

Pure functions over plain values: no database, no session object, so the arithmetic can be
read and tested on its own. Correctness itself is NOT decided here — that is
``assessments.grading.grade_answer``, reused unchanged, which is why grid-in numerics with
fractions and tolerances work in a live quiz on the first day.
"""

from __future__ import annotations

from . import constants as const


def points_for(
    *,
    question_points: int,
    is_correct: bool,
    response_time_ms: int,
    limit_ms: int,
    speed_bonus_ratio: float,
) -> int:
    """Base score for a right answer, plus a bonus that decays to zero at the deadline.

    A wrong answer is worth nothing — there is no negative marking, because this is a game
    played in front of the class and the point is to keep people answering.

    With the default ratio of 0.5, a 1-point question pays 150 for an instant answer and 100
    for one that lands on the buzzer. Set the ratio to 0 for flat marking.
    """
    if not is_correct:
        return 0

    base = max(0, int(question_points)) * const.BASE_POINT_SCALE
    if base == 0:
        return 0

    ratio = max(0.0, float(speed_bonus_ratio or 0.0))
    if ratio == 0.0 or limit_ms <= 0:
        return base

    # Clamp: a late answer inside the grace window has a negative remainder, and an answer
    # recorded at 0 ms (a test, or a very fast tap) must not pay more than the full bonus.
    remaining = (float(limit_ms) - float(max(0, response_time_ms))) / float(limit_ms)
    remaining = min(1.0, max(0.0, remaining))

    return int(round(base * (1.0 + ratio * remaining)))


def assign_ranks(scored: list[tuple[int, int]]) -> dict[int, int]:
    """Map participant id → final place, highest score first.

    Standard competition ranking: two students tied for second are both 2nd and the next is
    4th. Sharing a place is the honest answer; inventing an order between two identical
    scores would put one of them above the other for no reason anybody could explain.

    ``scored`` is ``[(participant_id, score), …]`` in any order.
    """
    ordered = sorted(scored, key=lambda row: (-int(row[1]), int(row[0])))

    ranks: dict[int, int] = {}
    previous_score: int | None = None
    previous_rank = 0

    for position, (participant_id, score) in enumerate(ordered, start=1):
        if previous_score is not None and int(score) == previous_score:
            ranks[int(participant_id)] = previous_rank
        else:
            ranks[int(participant_id)] = position
            previous_rank = position
            previous_score = int(score)

    return ranks
