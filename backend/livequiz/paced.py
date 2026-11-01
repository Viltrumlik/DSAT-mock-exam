"""Student-paced play: every student on their own question, on their own clock.

The room starts together and finishes together, but in between each student walks their own
sequence. Their pointer (``position``), their deadline and their power-ups live on their
participant row; the session row only says the round is in play.

Every move here takes the participant row under ``select_for_update`` and re-checks that the
student is still on the question the move is about. That one rule settles every race this
mode has — an answer against the timer, two tabs answering at once, a power-up against an
answer — without a compare-and-set counter: whoever takes the lock second finds the student
has already moved on and does nothing.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from assessments.grading import grade_answer
from core.errors.api import Conflict

from . import constants as const
from . import powerups, scoring, state_machine
from .engine_db_guard import require_session_update
from .models import LiveQuizAnswer, LiveQuizParticipant


@dataclass
class Move:
    """What happened when a student left a question — answered or out of time."""

    answer: LiveQuizAnswer
    question: object
    participant: LiveQuizParticipant
    next_question: object | None
    breakdown: dict
    awarded: str | None = None
    finished: bool = False
    used: list = field(default_factory=list)


def is_student_paced(session) -> bool:
    return session.setting("mode") == const.MODE_STUDENT_PACED


def _require_paced(session) -> None:
    if not is_student_paced(session):
        raise Conflict(
            "This quiz is run by the teacher, one question at a time.", code=const.ERR_WRONG_MODE
        )


def seconds_for(session) -> int:
    try:
        return int(session.setting("question_seconds") or 0)
    except (TypeError, ValueError):
        return 0


def _score(session, *, question, is_correct: bool, elapsed_ms: int, double: bool) -> dict:
    return scoring.score_answer(
        question_points=question.points,
        is_correct=is_correct,
        response_time_ms=elapsed_ms,
        limit_ms=seconds_for(session) * 1000,
        speed_bonus_ratio=float(session.setting("speed_bonus_ratio") or 0.0),
        point_scale=int(session.setting("point_scale") or const.BASE_POINT_SCALE),
        double=double,
    )


# ─── The sequence ─────────────────────────────────────────────────────────────


def sequence_for(session, rng: random.Random | None = None) -> list[int]:
    """This student's order through the paper.

    Shuffled per student when the host asked for it, so the student beside them is not on the
    same question at the same moment.
    """
    orders = [int(o) for o in session.questions.order_by("order").values_list("order", flat=True)]
    if session.setting("shuffle_questions"):
        (rng or random).shuffle(orders)
    return orders


def ensure_sequence(*, session, participant) -> LiveQuizParticipant:
    """Give a student their sequence the first time they take a place in a paced room."""
    if not is_student_paced(session) or participant.question_order:
        return participant
    LiveQuizParticipant.objects.filter(pk=participant.pk, question_order=[]).update(
        question_order=sequence_for(session)
    )
    participant.refresh_from_db()
    return participant


def current_question(session, participant):
    order = participant.question_order or []
    if participant.position >= len(order):
        return None
    return session.questions.filter(order=order[participant.position]).first()


def total_for(participant) -> int:
    return len(participant.question_order or [])


# ─── Opening questions ────────────────────────────────────────────────────────


def _open_locked(*, session, participant, delay_seconds: float, now) -> None:
    """Put a clock on the student's current question. The caller holds the row lock."""
    if participant.finished_at is not None or participant.question_started_at is not None:
        return
    if participant.position >= total_for(participant):
        participant.finished_at = now
        participant.save(update_fields=["finished_at", "updated_at"])
        return

    start = now + timedelta(seconds=delay_seconds)
    seconds = seconds_for(session)
    participant.question_started_at = start
    participant.question_ends_at = (
        None if seconds == const.NO_TIMER else start + timedelta(seconds=seconds)
    )
    participant.armed = {}
    participant.save(
        update_fields=["question_started_at", "question_ends_at", "armed", "updated_at"]
    )


def open_current(*, session, participant, delay_seconds: float = 0, now=None) -> LiveQuizParticipant:
    """The student's current question, with a clock — opening it now if it has none.

    Safe to call as often as anyone likes: a question that already has a clock keeps it.
    """
    now = now or timezone.now()
    if session.status != const.STATUS_QUESTION_ACTIVE:
        return participant
    with transaction.atomic():
        row = LiveQuizParticipant.objects.select_for_update().get(pk=participant.pk)
        _open_locked(session=session, participant=row, delay_seconds=delay_seconds, now=now)
    participant.refresh_from_db()
    return participant


def begin_play(*, session, now=None) -> tuple[object, list[LiveQuizParticipant]]:
    """The countdown is over: the round is in play and every student gets their first question."""
    _require_paced(session)
    state_machine.assert_transition(session.status, const.STATUS_QUESTION_ACTIVE)
    now = now or timezone.now()
    require_session_update(
        pk=session.pk,
        expect_status=session.status,
        expect_version=session.version,
        updates={"status": const.STATUS_QUESTION_ACTIVE, "started_at": session.started_at or now},
    )
    session.refresh_from_db()

    opened = []
    for participant in session.participants.filter(status=const.PARTICIPANT_JOINED):
        participant = ensure_sequence(session=session, participant=participant)
        opened.append(open_current(session=session, participant=participant, now=now))
    return session, opened


def shift_clocks(*, session, by: timedelta) -> None:
    """Give every student back the time a pause took. A frozen clock has no deadline to move."""
    live = LiveQuizParticipant.objects.filter(session=session, finished_at__isnull=True)
    live.filter(question_started_at__isnull=False).update(
        question_started_at=F("question_started_at") + by
    )
    live.filter(question_ends_at__isnull=False).update(question_ends_at=F("question_ends_at") + by)


# ─── Leaving a question ───────────────────────────────────────────────────────


def _advance_locked(*, session, participant, now):
    """Move the student on and open what comes next. Returns the next question, or None."""
    participant.position += 1
    participant.question_started_at = None
    participant.question_ends_at = None
    participant.armed = {}
    participant.save(
        update_fields=["position", "question_started_at", "question_ends_at", "armed", "updated_at"]
    )
    nxt = current_question(session, participant)
    if nxt is None:
        participant.finished_at = now
        participant.save(update_fields=["finished_at", "updated_at"])
        return None
    # The next clock starts when the feedback screen is gone, not now — reading whether you
    # were right must never cost time on the next one.
    _open_locked(
        session=session, participant=participant, delay_seconds=const.FEEDBACK_SECONDS, now=now
    )
    return nxt


def _settle_streak(participant, *, is_correct: bool, saved: bool) -> None:
    if is_correct:
        participant.streak += 1
        participant.best_streak = max(participant.best_streak, participant.streak)
    elif not saved:
        participant.streak = 0


def _armed_keys(armed: dict) -> list[str]:
    return sorted(key for key in armed if key in powerups.ALL)


def submit(*, session, participant, question_id, answer, now=None) -> Move:
    """Mark the student's answer to their current question, then move them on."""
    _require_paced(session)
    now = now or timezone.now()
    if not state_machine.accepts_answers(session.status):
        raise Conflict("That question is not taking answers.", code=const.ERR_BAD_STATE)

    with transaction.atomic():
        row = LiveQuizParticipant.objects.select_for_update().get(pk=participant.pk)
        if row.finished_at is not None:
            raise Conflict("You have answered every question.", code=const.ERR_BAD_STATE)

        question = current_question(session, row)
        try:
            asked_for = int(question_id or 0)
        except (TypeError, ValueError):
            asked_for = 0
        if question is None or asked_for != question.id:
            raise Conflict("That question has already moved on.", code=const.ERR_UNKNOWN_QUESTION)
        if row.question_started_at is None:
            raise Conflict("That question is not open yet.", code=const.ERR_BAD_STATE)
        if row.question_ends_at is not None and (
            (now - row.question_ends_at).total_seconds() * 1000.0 > const.LATE_ANSWER_GRACE_MS
        ):
            raise Conflict("Time is up for that question.", code=const.ERR_TOO_LATE)

        armed = dict(row.armed or {})
        # An app that shows the next question the moment it arrives can answer inside the
        # feedback pause; that is simply an instant answer, not a negative one.
        elapsed_ms = max(0, int((now - row.question_started_at).total_seconds() * 1000))
        if "frozen_ms" in armed:
            elapsed_ms = int(armed["frozen_ms"])

        is_correct = bool(
            grade_answer(
                question_type=question.question_type,
                correct_answer=question.correct_answer,
                answer=answer,
                config=question.grading_config or {},
            )
        )
        _settle_streak(row, is_correct=is_correct, saved=bool(armed.get(powerups.STREAK_SAVER)))
        breakdown = _score(
            session,
            question=question,
            is_correct=is_correct,
            elapsed_ms=elapsed_ms,
            double=bool(armed.get(powerups.DOUBLE)),
        )

        awarded = None
        held = list(row.powerups or [])
        if (
            is_correct
            and session.setting("powerups")
            and powerups.earns_one(streak=row.streak, held=len(held))
        ):
            awarded = powerups.pick()
            row.powerups = held + [awarded]

        try:
            with transaction.atomic():
                answer_row = LiveQuizAnswer.objects.create(
                    session=session,
                    participant=row,
                    question=question,
                    answer=answer,
                    is_correct=is_correct,
                    points_awarded=breakdown["total"],
                    response_time_ms=elapsed_ms,
                    powerups_used=_armed_keys(armed),
                )
        except IntegrityError:
            raise Conflict("You have already answered this one.", code=const.ERR_ALREADY_ANSWERED)

        row.score += breakdown["total"]
        row.correct_count += int(is_correct)
        row.answered_count += 1
        row.save(
            update_fields=[
                "score",
                "correct_count",
                "answered_count",
                "streak",
                "best_streak",
                "powerups",
                "updated_at",
            ]
        )
        nxt = _advance_locked(session=session, participant=row, now=now)

    participant.refresh_from_db()
    return Move(
        answer=answer_row,
        question=question,
        participant=participant,
        next_question=nxt,
        breakdown=breakdown,
        awarded=awarded,
        finished=participant.finished_at is not None,
        used=answer_row.powerups_used,
    )


def time_out(*, session, participant_id: int, position: int, now=None) -> Move | None:
    """The clock ran out on ``position``. None when the student had already moved on.

    Called by every socket the student has open, and only one call can find them still on
    that question — the rest return None and say nothing.
    """
    if not is_student_paced(session) or session.status != const.STATUS_QUESTION_ACTIVE:
        return None
    now = now or timezone.now()

    with transaction.atomic():
        row = LiveQuizParticipant.objects.select_for_update().filter(pk=participant_id).first()
        if row is None or row.finished_at is not None or row.position != int(position):
            return None
        if row.question_ends_at is None or now < row.question_ends_at:
            # A frozen clock, or a timer that woke early. Nothing is late yet.
            return None
        question = current_question(session, row)
        if question is None:
            return None

        armed = dict(row.armed or {})
        _settle_streak(row, is_correct=False, saved=bool(armed.get(powerups.STREAK_SAVER)))
        try:
            with transaction.atomic():
                answer_row = LiveQuizAnswer.objects.create(
                    session=session,
                    participant=row,
                    question=question,
                    answer=None,
                    is_correct=False,
                    points_awarded=0,
                    response_time_ms=seconds_for(session) * 1000,
                    timed_out=True,
                    powerups_used=_armed_keys(armed),
                )
        except IntegrityError:
            return None
        row.save(update_fields=["streak", "best_streak", "updated_at"])
        nxt = _advance_locked(session=session, participant=row, now=now)

    row.refresh_from_db()
    return Move(
        answer=answer_row,
        question=question,
        participant=row,
        next_question=nxt,
        breakdown=_score(session, question=question, is_correct=False, elapsed_ms=0, double=False),
        finished=row.finished_at is not None,
        used=answer_row.powerups_used,
    )


def catch_up(*, session, participant, now=None) -> LiveQuizParticipant:
    """A student (re)connecting: settle a question that ran out while they were away.

    One missed question is marked missed and the next one opens fresh from now. Questions
    they never saw are not charged to them — being away is not the same as being wrong.
    """
    if not is_student_paced(session) or session.status != const.STATUS_QUESTION_ACTIVE:
        return participant
    now = now or timezone.now()
    participant = ensure_sequence(session=session, participant=participant)
    ran_out = (
        participant.finished_at is None
        and participant.question_ends_at is not None
        and (now - participant.question_ends_at).total_seconds() * 1000.0
        > const.LATE_ANSWER_GRACE_MS
    )
    if ran_out:
        time_out(
            session=session, participant_id=participant.pk, position=participant.position, now=now
        )
        participant.refresh_from_db()
        # Back from being away: there is no feedback screen to wait through.
        if participant.question_started_at and participant.question_started_at > now:
            seconds = seconds_for(session)
            LiveQuizParticipant.objects.filter(pk=participant.pk).update(
                question_started_at=now,
                question_ends_at=(
                    None if seconds == const.NO_TIMER else now + timedelta(seconds=seconds)
                ),
            )
            participant.refresh_from_db()
    return open_current(session=session, participant=participant, now=now)


# ─── Power-ups ────────────────────────────────────────────────────────────────


def use_powerup(*, session, participant, key: str, now=None) -> dict:
    """Spend one power-up on the question in front of the student."""
    _require_paced(session)
    now = now or timezone.now()
    if not session.setting("powerups"):
        raise Conflict("Power-ups are off in this quiz.", code=const.ERR_NO_POWERUP)
    if key not in powerups.ALL:
        raise Conflict("There is no such power-up.", code=const.ERR_NO_POWERUP)
    if not state_machine.accepts_answers(session.status):
        raise Conflict("Power-ups work while a question is open.", code=const.ERR_BAD_STATE)

    with transaction.atomic():
        row = LiveQuizParticipant.objects.select_for_update().get(pk=participant.pk)
        held = list(row.powerups or [])
        if key not in held:
            raise Conflict("You do not have that power-up.", code=const.ERR_NO_POWERUP)
        question = current_question(session, row)
        if row.finished_at is not None or question is None or row.question_started_at is None:
            raise Conflict("Power-ups work while a question is open.", code=const.ERR_BAD_STATE)
        armed = dict(row.armed or {})
        if armed.get(key):
            raise Conflict("That one is already working on this question.", code=const.ERR_NO_POWERUP)

        if key in powerups.HIDES_OPTIONS:
            hidden_now = powerups.options_to_hide(
                key=key,
                choices=question.choices,
                correct_answer=question.correct_answer,
                already_hidden=armed.get("hidden", []),
            )
            if not hidden_now:
                raise Conflict("There is nothing left to take away here.", code=const.ERR_NO_POWERUP)
            armed["hidden"] = list(armed.get("hidden", [])) + hidden_now

        if key == powerups.TIME_FREEZE:
            if row.question_ends_at is None:
                raise Conflict("This question has no clock to stop.", code=const.ERR_NO_POWERUP)
            armed["frozen_ms"] = max(0, int((now - row.question_started_at).total_seconds() * 1000))
            row.question_ends_at = None

        held.remove(key)
        armed[key] = True
        row.powerups = held
        row.armed = armed
        row.save(update_fields=["powerups", "armed", "question_ends_at", "updated_at"])

    participant.refresh_from_db()
    return {
        "powerup": key,
        "inventory": list(participant.powerups or []),
        "question_id": question.id,
        "hidden_choices": list(armed.get("hidden", [])),
        "armed": _armed_keys(armed),
        "frozen": "frozen_ms" in armed,
        "ends_at": participant.question_ends_at.isoformat() if participant.question_ends_at else None,
    }


# ─── Where everybody stands ───────────────────────────────────────────────────


def everyone_finished(session) -> bool:
    """True once every student still in the room has answered their last question.

    "In the room" means joined AND connected: a student whose phone died halfway does not hold
    the game open for everybody else — what they answered still counts. At least one student
    must have finished, so an empty room never "finishes".
    """
    playing = session.participants.filter(status=const.PARTICIPANT_JOINED)
    finished = playing.filter(finished_at__isnull=False).count()
    still_going = playing.filter(finished_at__isnull=True, connections__gt=0).count()
    return finished > 0 and still_going == 0


def standing(*, session, participant, top: int = 3) -> dict:
    """The student's place right now, and the top of the board, for their feedback screen.

    Two small queries per answer instead of pushing the whole board to every phone every time
    somebody answers.
    """
    playing = session.participants.exclude(status=const.PARTICIPANT_KICKED)
    ahead = playing.filter(score__gt=participant.score).count()
    leaders = list(playing.order_by("-score", "joined_at")[:top])
    return {
        "rank": ahead + 1,
        "player_count": playing.count(),
        "leaders": [{"id": p.id, "display_name": p.display_name, "score": p.score} for p in leaders],
    }


def cell(order, is_correct, timed_out, points) -> dict:
    return {
        "order": int(order),
        "correct": bool(is_correct),
        "timed_out": bool(timed_out),
        "points": int(points or 0),
    }


def board(session) -> list[dict]:
    """Every student's answers, cell by cell, for the host's live dashboard.

    Keyed by the question's place in the PAPER, not in the student's sequence, so a column on
    the dashboard is one question for everybody however shuffled they were.
    """
    cells: dict[int, list] = {}
    rows = LiveQuizAnswer.objects.filter(session=session).values_list(
        "participant_id", "question__order", "is_correct", "timed_out", "points_awarded"
    )
    for participant_id, order, ok, timed_out, points in rows:
        cells.setdefault(int(participant_id), []).append(cell(order, ok, timed_out, points))
    return [
        {"participant_id": pid, "cells": sorted(values, key=lambda c: c["order"])}
        for pid, values in cells.items()
    ]
