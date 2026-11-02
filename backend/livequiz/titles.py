"""Titles: earned by how a student plays, and never sold.

Worked out from the games themselves rather than kept in a ledger of their own: the history is
already there, a rule can be corrected without a backfill, and no code path can award a title by
forgetting to check. Only finished games count, so a title cannot appear mid-game and vanish
when the teacher stops the room.
"""

from __future__ import annotations

from django.db.models import Count, F, Max

from . import constants as const
from . import events
from .models import LiveQuizAnswer, LiveQuizParticipant

FAST_MS = 5000
PERFECT_MIN_QUESTIONS = 8

TITLES: dict[str, dict] = {
    "streak_master": {"name": "Streak master", "rule": "10 right in a row in one game", "goal": 10},
    "team_captain": {"name": "Team captain", "rule": "Top scorer on the winning team, 3 times", "goal": 3},
    "lightning": {"name": "Lightning", "rule": "50 right answers in under 5 seconds", "goal": 50},
    "word_wise": {"name": "Word wise", "rule": "200 vocabulary questions right", "goal": 200},
    "perfect_game": {"name": "Perfect game", "rule": "Every answer right, 8 questions or more", "goal": 1},
}


def _played(user):
    return LiveQuizParticipant.objects.filter(user=user, session__status=const.STATUS_FINISHED).exclude(
        status=const.PARTICIPANT_KICKED
    )


def _captaincies(played) -> int:
    """Games where they outscored their own team, and that team won. A tie for either counts."""
    count = 0
    for mine in played.filter(team__isnull=False).select_related("session").prefetch_related("session__participants"):
        teams = int(mine.session.setting("teams") or 0)
        if not teams or mine.score <= 0:
            continue
        players = [p for p in mine.session.participants.all() if p.status != const.PARTICIPANT_KICKED]
        winners = {row["team"] for row in events.team_standings(players, teams) if row["rank"] == 1}
        if mine.team in winners and mine.score == max(p.score for p in players if p.team == mine.team):
            count += 1
    return count


def progress_of(user) -> dict[str, int]:
    played = _played(user)
    right = LiveQuizAnswer.objects.filter(participant__in=played, is_correct=True)
    return {
        "streak_master": played.aggregate(best=Max("best_streak"))["best"] or 0,
        "team_captain": _captaincies(played),
        # A right retry turns `is_correct` on but keeps the time of the first try, so it is no
        # evidence of speed.
        "lightning": right.filter(second_try_correct__isnull=True, response_time_ms__lt=FAST_MS).count(),
        "word_wise": right.filter(session__vocab_set__isnull=False).count(),
        # Every answer right the first time: a second chance is a good thing, but not this.
        "perfect_game": played.filter(correct_count__gte=PERFECT_MIN_QUESTIONS)
        .annotate(total=Count("session__questions", distinct=True))
        .filter(correct_count__gte=F("total"))
        .exclude(answers__second_try_correct__isnull=False)
        .count(),
    }


def state_of(user) -> list[dict]:
    """Every title with how far this student has come."""
    progress = progress_of(user)
    return [
        {
            "key": key,
            "name": info["name"],
            "rule": info["rule"],
            "goal": info["goal"],
            "progress": min(progress[key], info["goal"]),
            "earned": progress[key] >= info["goal"],
        }
        for key, info in TITLES.items()
    ]


def earned(user) -> set[str]:
    return {row["key"] for row in state_of(user) if row["earned"]}
