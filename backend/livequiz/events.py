"""The shapes that go over the wire.

One place that decides what a client is told, so the answer key cannot leak by accident from
some view that built its own payload.

The rule this module exists to enforce: **a question frame sent while the question is open
carries no ``correct_answer`` and no ``explanation``.** The key is added only by
:func:`question_ended`, once the question is closed and the answer is public anyway. A
student reading the socket in devtools sees exactly what a student is meant to see.
"""

from __future__ import annotations

from django.conf import settings

from . import constants as const


def _media_url(path: str | None) -> str | None:
    if not path:
        return None
    base = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    return f"{base if base.endswith('/') else base + '/'}{path}"


def _iso(value):
    return value.isoformat() if value else None


# ─── Questions ────────────────────────────────────────────────────────────────


def public_question(question, *, index: int, total: int) -> dict:
    """A question as a player may see it: no key, no explanation.

    Choices are passed through as stored, so the ``{id, text}`` shape the assessment runner
    already speaks is what the live client receives too — which is why its answer widgets
    can be reused unchanged.
    """
    images = question.image_paths if isinstance(question.image_paths, dict) else {}
    return {
        "id": question.id,
        "index": index,
        "total": total,
        "prompt": question.prompt,
        "question_prompt": question.question_prompt,
        "question_type": question.question_type,
        "choices": question.choices or [],
        "points": question.points,
        "time_limit_seconds": question.time_limit_seconds,
        "form": question.form,
        # SAT questions can carry a figure, and options can be pictures.
        "question_image": _media_url(images.get("question")),
        "option_images": {key: _media_url(name) for key, name in images.items() if key != "question"},
    }


def question_started(session, question, *, total: int) -> dict:
    return {
        "question": public_question(question, index=session.current_index, total=total),
        "started_at": _iso(session.question_started_at),
        "ends_at": _iso(session.question_ends_at),
    }


def question_ended(session, question, *, tally: dict, total: int) -> dict:
    """The close of a question — now, and only now, the key travels."""
    return {
        "question": public_question(question, index=session.current_index, total=total),
        "correct_answer": question.correct_answer,
        "explanation": question.explanation,
        "tally": tally,
    }


# ─── People ───────────────────────────────────────────────────────────────────


def participant_row(participant) -> dict:
    return {
        "id": participant.id,
        "user_id": participant.user_id,
        "display_name": participant.display_name,
        "status": participant.status,
        "present": participant.is_present,
        "score": participant.score,
        "correct_count": participant.correct_count,
        "answered_count": participant.answered_count,
        "rank": participant.rank,
        "streak": participant.streak,
        "best_streak": participant.best_streak,
        # Student-paced: how many of their questions are behind them, and whether that is all.
        "progress": participant.position,
        "finished": participant.finished_at is not None,
        "team": participant.team,
    }


# What a score gives away. In a room that hides correctness (the Test preset), every one of
# these says how a student is doing, so a student is sent zeros until the game is over. Zeros
# rather than nulls: an app that predates this decodes them as numbers.
SCORE_FIELDS = ("score", "correct_count", "answered_count", "streak", "best_streak")


def _blind_row(row):
    if not isinstance(row, dict):
        return row
    return {**row, **{field: 0 for field in SCORE_FIELDS if field in row}}


def without_scores(data: dict) -> dict:
    """A copy of a frame with every player's score fields zeroed — rows, lists and ``me``."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    for key in ("participants", "rows"):
        if isinstance(out.get(key), list):
            out[key] = [_blind_row(row) for row in out[key]]
    if isinstance(out.get("me"), dict):
        out["me"] = _blind_row(out["me"])
    if isinstance(out.get("teams"), list):
        out["teams"] = [{**row, "score": 0} for row in out["teams"]]
    return out


def without_key(data: dict) -> dict:
    """A question's close for students in a room that keeps the answers to itself."""
    return {**data, "correct_answer": None, "explanation": ""}


def me_row(participant) -> dict:
    """The student's own row: the public one plus what only they may see."""
    return {
        **participant_row(participant),
        "powerups": list(participant.powerups or []),
        "question_total": len(participant.question_order or []),
    }


def lobby(session, participants) -> dict:
    rows = [participant_row(p) for p in participants]
    return {
        "session_id": session.id,
        "status": session.status,
        "participants": rows,
        "participant_count": len(rows),
        "present_count": sum(1 for r in rows if r["present"]),
    }


def team_standings(participants, teams: int) -> list[dict]:
    """Team mode: each team's score — the SUM of its members' — best first, ties sharing a place."""
    totals = {
        index: {"team": index, "name": const.TEAM_NAMES[index], "score": 0, "members": 0}
        for index in range(int(teams or 0))
    }
    for p in participants:
        if p.status == const.PARTICIPANT_KICKED or p.team not in totals:
            continue
        totals[p.team]["score"] += int(p.score)
        totals[p.team]["members"] += 1
    ordered = sorted(totals.values(), key=lambda row: (-row["score"], row["team"]))
    place, previous = 0, None
    for position, row in enumerate(ordered, start=1):
        if row["score"] != previous:
            place, previous = position, row["score"]
        row["rank"] = place
    return ordered


def leaderboard(participants, *, limit: int | None = None, teams: int = 0) -> dict:
    ordered = sorted(participants, key=lambda p: (-int(p.score), p.joined_at))
    rows = [participant_row(p) for p in ordered]
    if limit is not None:
        rows = rows[:limit]
    payload = {"rows": rows}
    if teams:
        payload["teams"] = team_standings(participants, teams)
    return payload


# ─── The whole room, for a client that has just (re)connected ─────────────────


def session_state(
    session,
    *,
    participants,
    question=None,
    total: int = 0,
    me=None,
    own_question: dict | None = None,
    board: list | None = None,
) -> dict:
    """Everything a client needs to render the room from cold.

    Sent on every connect, which is what makes a refresh, a locked phone or a dropped
    connection recoverable: the client never has to have seen an earlier frame.

    Student-paced rooms add two things. A student gets ``own_question`` — their own question
    and their own deadline, in the same keys a teacher-paced room uses for the room's — so an
    app that predates the mode renders it as "the question". The host gets ``board``: every
    student's answers so far, for the live dashboard.
    """
    payload = {
        "session_id": session.id,
        "join_code": session.join_code,
        "status": session.status,
        "current_index": session.current_index,
        "question_total": total,
        "started_at": _iso(session.started_at),
        "finished_at": _iso(session.finished_at),
        "ends_at": _iso(session.question_ends_at),
        "config": {key: session.setting(key) for key in const.CONFIG_KEYS},
        "participants": [participant_row(p) for p in participants],
    }
    # The open question travels only while it is open. In QUESTION_RESULTS the client has
    # already had `question_ended`, which carried the key.
    if own_question is not None and session.status == const.STATUS_QUESTION_ACTIVE:
        payload.update(own_question)
    elif question is not None and session.status == const.STATUS_QUESTION_ACTIVE:
        payload["question"] = public_question(question, index=session.current_index, total=total)
    if me is not None:
        payload["me"] = me_row(me)
    if board is not None:
        payload["board"] = board
    teams = int(session.setting("teams") or 0)
    if teams:
        payload["teams"] = team_standings(participants, teams)
    return payload


# ─── Student-paced frames ─────────────────────────────────────────────────────


def _ms_until(value, now) -> int | None:
    if value is None:
        return None
    return max(0, int((value - now).total_seconds() * 1000))


def own_question(participant, question, *, now) -> dict:
    """One student's question, with their clock.

    ``starts_in_ms`` and ``ends_in_ms`` are durations from the moment the frame was built, so
    a phone whose clock is minutes out still shows the right countdown: it adds them to the
    moment the frame arrived instead of comparing the server's timestamps with its own.
    A question opened behind a feedback screen has ``starts_in_ms`` > 0.
    """
    armed = participant.armed or {}
    return {
        "question": public_question(
            question, index=participant.position, total=len(participant.question_order or [])
        ),
        "started_at": _iso(participant.question_started_at),
        "ends_at": _iso(participant.question_ends_at),
        "starts_in_ms": _ms_until(participant.question_started_at, now) or 0,
        "ends_in_ms": _ms_until(participant.question_ends_at, now),
        "hidden_choices": list(armed.get("hidden", [])),
        "armed": sorted(key for key in armed if key not in ("hidden", "frozen_ms")),
        "frozen": "frozen_ms" in armed,
        # A missed question asked again at the end — the screen says so.
        "second_try": participant.redemption_from is not None
        and participant.position >= participant.redemption_from,
    }


def own_answer_result(move, *, session, standing: dict | None) -> dict:
    """What a student is told the moment they leave a question — answered or out of time.

    The first three keys are the teacher-paced frame's, so an older app reads it as it always
    has. Everything after is for the feedback screen. With correctness hidden, the student
    learns that their answer landed and how far through they are, and nothing that would give
    the answer away — not even their score, which moves only when they are right.
    """
    answer = move.answer
    payload = {
        "question_id": answer.question_id,
        "accepted": not answer.timed_out,
        "response_time_ms": answer.response_time_ms,
        "timed_out": answer.timed_out,
        "second_try": answer.second_try_correct is not None,
        "progress": move.participant.position,
        "question_total": len(move.participant.question_order or []),
        "finished": move.finished,
    }
    if session.setting("reveal_correctness"):
        payload.update(
            {
                "is_correct": answer.is_correct,
                "points_awarded": answer.points_awarded,
                "breakdown": move.breakdown,
                "streak": move.participant.streak,
                "best_streak": move.participant.best_streak,
                "score": move.participant.score,
                "correct_count": move.participant.correct_count,
                "answered_count": move.participant.answered_count,
                "awarded": move.awarded,
                "powerups_used": list(move.used or []),
            }
        )
    if session.setting("show_answers"):
        payload["correct_answer"] = move.question.correct_answer
        payload["explanation"] = move.question.explanation
    if standing is not None:
        payload.update(standing)
    return payload


def answer_result(*, answer, reveal: bool) -> dict:
    """What the answering student is told.

    With ``reveal_correctness`` off, they are told their answer landed and nothing else —
    the score still moves, but they find out where they stand at the end.
    """
    payload = {
        "question_id": answer.question_id,
        "accepted": True,
        "response_time_ms": answer.response_time_ms,
    }
    if reveal:
        payload["is_correct"] = answer.is_correct
        payload["points_awarded"] = answer.points_awarded
    return payload


def error(code: str, detail: str) -> dict:
    return {"code": code, "detail": detail}
