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
    if not base.endswith("/"):
        base += "/"
    return f"{base}{path}"


def _iso(value):
    return value.isoformat() if value else None


# ─── Questions ────────────────────────────────────────────────────────────────


def public_question(question, *, index: int, total: int) -> dict:
    """A question as a player may see it: no key, no explanation.

    Choices are passed through as stored, so the ``{id, text}`` shape the assessment runner
    already speaks is what the live client receives too.
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
        "question_image": _media_url(images.get("question")),
        "option_a_image": _media_url(images.get("A")),
        "option_b_image": _media_url(images.get("B")),
        "option_c_image": _media_url(images.get("C")),
        "option_d_image": _media_url(images.get("D")),
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


def leaderboard(participants, *, limit: int | None = None) -> dict:
    ordered = sorted(participants, key=lambda p: (-int(p.score), p.joined_at))
    rows = [participant_row(p) for p in ordered]
    if limit is not None:
        rows = rows[:limit]
    return {"rows": rows}


# ─── The whole room, for a client that has just (re)connected ─────────────────


def session_state(session, *, participants, question=None, total: int = 0, me=None) -> dict:
    """Everything a client needs to render the room from cold.

    Sent on every connect, which is what makes a refresh, a locked phone or a dropped
    connection recoverable: the client never has to have seen an earlier frame.
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
    if question is not None and session.status == const.STATUS_QUESTION_ACTIVE:
        payload["question"] = public_question(question, index=session.current_index, total=total)
    if me is not None:
        payload["me"] = participant_row(me)
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
