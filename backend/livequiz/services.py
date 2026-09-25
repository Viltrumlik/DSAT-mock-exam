"""Every move in the game.

The consumer and the REST views both come here; neither writes a session row itself. That
is what keeps the rules in one place — a student cannot start a game by finding a different
endpoint, because there is only one ``start_game`` and it checks.

Two habits run through this module:

* **The server owns the clock.** A question's deadline is written to the row when the
  question opens, and every late-answer decision reads it back. Nothing trusts a timestamp
  sent by a client.
* **Transitions are compare-and-set.** Reading a status and then writing it is a race when
  a timer, a student and the host can all act at the same instant, so the write is
  conditional on the row not having moved. A caller that loses is told, and stays quiet.
"""

from __future__ import annotations

import random
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from assessments.grading import grade_answer
from classes.capabilities import classroom_capabilities
from core.errors.api import BadRequest, Conflict, Forbidden, NotFound

from . import constants as const
from . import question_builder, scoring, state_machine
from .engine_db_guard import TransitionConflict, require_session_update
from .models import (
    LiveQuizAnswer,
    LiveQuizParticipant,
    LiveQuizQuestion,
    LiveQuizSession,
    generate_join_code,
)

ROLE_HOST = "host"
ROLE_PLAYER = "player"


# ─── Configuration ────────────────────────────────────────────────────────────


def normalize_config(raw: dict | None) -> dict:
    """Keep the known keys, coerce them, drop anything else.

    Unknown keys are dropped rather than stored: a typo'd key that sat in the JSON would
    read as a setting that does something, and it would not.
    """
    raw = raw if isinstance(raw, dict) else {}
    out: dict = {}

    seconds = raw.get("question_seconds", const.CONFIG_DEFAULTS["question_seconds"])
    try:
        seconds = int(seconds)
    except (TypeError, ValueError):
        raise BadRequest("Seconds per question must be a whole number.", code="bad_config")
    if not (const.MIN_QUESTION_SECONDS <= seconds <= const.MAX_QUESTION_SECONDS):
        raise BadRequest(
            f"Seconds per question must be between {const.MIN_QUESTION_SECONDS} "
            f"and {const.MAX_QUESTION_SECONDS}.",
            code="bad_config",
        )
    out["question_seconds"] = seconds

    ratio = raw.get("speed_bonus_ratio", const.CONFIG_DEFAULTS["speed_bonus_ratio"])
    try:
        ratio = float(ratio)
    except (TypeError, ValueError):
        raise BadRequest("The speed bonus must be a number.", code="bad_config")
    out["speed_bonus_ratio"] = min(2.0, max(0.0, ratio))

    for key in (
        "allow_answer_change",
        "show_leaderboard_between",
        "reveal_correctness",
        "shuffle_questions",
        "manual_advance",
    ):
        out[key] = bool(raw.get(key, const.CONFIG_DEFAULTS[key]))

    return out


# ─── Who is who ───────────────────────────────────────────────────────────────


def display_name_for(user) -> str:
    """The name on the leaderboard. Their own, never a nickname they typed.

    Roster-only games mean everyone already has a name the class knows, and a free-text
    field in front of thirty teenagers is a moderation problem nobody asked for.
    """
    full = (getattr(user, "get_full_name", lambda: "")() or "").strip()
    if full:
        return full[:120]
    for attr in ("first_name", "username", "email"):
        value = str(getattr(user, attr, "") or "").strip()
        if value:
            return value.split("@")[0][:120]
    return f"Student {user.pk}"


def role_in_session(user, session) -> str | None:
    """``host``, ``player``, or None for somebody with no business in this room.

    Staff host and students play. A teacher does not appear on the leaderboard of their own
    class's quiz, which is why this is a role and not a boolean.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return None
    caps = classroom_capabilities(user, session.classroom)
    if caps.is_staff:
        return ROLE_HOST
    if caps.is_student:
        return ROLE_PLAYER
    return None


def can_host_in(user, classroom) -> bool:
    return bool(classroom_capabilities(user, classroom).is_staff)


# ─── Creating a room ──────────────────────────────────────────────────────────


def _freeze_questions(*, session, vocab_set, config) -> int:
    """Generate this session's questions from the set's words. Returns how many.

    Built once, here, and stored. The wrong options are chosen at random, so a question that
    was never written down could never be shown again — not to a student asking why they were
    marked wrong, and not to the teacher going over it afterwards.
    """
    words = [item.word for item in vocab_set.items.select_related("word").order_by("order", "id")]
    words = [w for w in words if w is not None]

    if len(words) < question_builder.MIN_WORDS:
        raise BadRequest(
            f"A live quiz needs at least {question_builder.MIN_WORDS} words, "
            f"so every question can have four different options.",
            code="too_few_words",
        )

    asked = list(words)
    if config["shuffle_questions"]:
        random.shuffle(asked)

    rows, order = [], 0
    for word in asked:
        # The pool is the set's own words, as it is in every study mode: options a student
        # has been learning, not strangers from another section.
        built = question_builder.build_question(word=word, pool=words)
        if built is None:
            # Not enough genuinely different words to surround this one. Skipping beats
            # asking a question with two right answers.
            continue
        rows.append(
            LiveQuizQuestion(
                session=session,
                order=order,
                source_word=word,
                form=built["form"],
                prompt=built["prompt"],
                question_prompt=built["question_prompt"],
                question_type=built["question_type"],
                choices=built["choices"],
                correct_answer=built["correct_answer"],
                grading_config={},
                points=1,
                explanation=built["explanation"],
                time_limit_seconds=config["question_seconds"],
            )
        )
        order += 1

    if not rows:
        raise BadRequest("These words are too alike to make a quiz from.", code="no_questions")

    LiveQuizQuestion.objects.bulk_create(rows)
    return len(rows)


def create_session(*, host, classroom, vocab_set, config: dict | None = None) -> LiveQuizSession:
    """Mint a room: a code, a frozen paper, and an empty lobby."""
    if not can_host_in(host, classroom):
        raise Forbidden("You do not teach this class.", code="not_class_staff")

    normalized = normalize_config(config)

    # A code must be unique among rooms that are still open. Two hosts pressing create at the
    # same instant can pick the same one, so the loop retries on the constraint rather than
    # trusting the exists() check it just made.
    last_error: Exception | None = None
    for _ in range(12):
        code = generate_join_code()
        try:
            with transaction.atomic():
                session = LiveQuizSession.objects.create(
                    vocab_set=vocab_set,
                    classroom=classroom,
                    host=host,
                    join_code=code,
                    status=const.STATUS_LOBBY,
                    config=normalized,
                )
                _freeze_questions(session=session, vocab_set=vocab_set, config=normalized)
            return session
        except IntegrityError as exc:  # pragma: no cover - needs a real collision
            last_error = exc
            continue

    raise Conflict(
        "Could not start a live quiz just now — too many are running.", code="code_exhausted"
    ) from last_error


def find_session_by_code(code: str) -> LiveQuizSession | None:
    """The open room with this code, if there is one. Codes are case-insensitive to type."""
    cleaned = str(code or "").strip().upper()
    if len(cleaned) != const.JOIN_CODE_LENGTH:
        return None
    return (
        LiveQuizSession.objects.filter(join_code=cleaned, status__in=const.LIVE_STATUSES)
        .select_related("classroom", "vocab_set")
        .first()
    )


# ─── The lobby ────────────────────────────────────────────────────────────────


def join_session(*, session, user) -> LiveQuizParticipant:
    """Put a student in the room, or hand back the place they already had."""
    if not state_machine.accepts_joins(session.status):
        raise Conflict("That live quiz has finished.", code=const.ERR_BAD_STATE)

    role = role_in_session(user, session)
    if role is None:
        raise Forbidden("This live quiz belongs to a class you are not in.", code="not_in_class")
    if role == ROLE_HOST:
        raise Forbidden(
            "You are hosting this quiz, so you cannot also play it.", code="host_cannot_play"
        )

    with transaction.atomic():
        participant = (
            LiveQuizParticipant.objects.select_for_update()
            .filter(session=session, user=user)
            .first()
        )

        if participant is not None:
            if participant.status == const.PARTICIPANT_KICKED:
                raise Forbidden("The host removed you from this quiz.", code="removed")
            if participant.status != const.PARTICIPANT_JOINED:
                participant.status = const.PARTICIPANT_JOINED
                participant.save(update_fields=["status", "updated_at"])
            return participant

        playing = LiveQuizParticipant.objects.filter(
            session=session, status=const.PARTICIPANT_JOINED
        ).count()
        if playing >= const.MAX_PARTICIPANTS:
            raise Conflict("This live quiz is full.", code="room_full")

        return LiveQuizParticipant.objects.create(
            session=session, user=user, display_name=display_name_for(user)
        )


def mark_connected(participant) -> LiveQuizParticipant:
    """One more open socket for this student."""
    LiveQuizParticipant.objects.filter(pk=participant.pk).update(
        connections=F("connections") + 1,
        last_seen_at=timezone.now(),
        status=const.PARTICIPANT_JOINED,
    )
    participant.refresh_from_db()
    return participant


def mark_disconnected(participant) -> LiveQuizParticipant:
    """One fewer. Never below zero — a lost socket can be reported twice."""
    LiveQuizParticipant.objects.filter(pk=participant.pk, connections__gt=0).update(
        connections=F("connections") - 1
    )
    LiveQuizParticipant.objects.filter(pk=participant.pk).update(last_seen_at=timezone.now())
    participant.refresh_from_db()
    return participant


def touch(participant) -> None:
    """Heartbeat. Cheap: one column, no read."""
    LiveQuizParticipant.objects.filter(pk=participant.pk).update(last_seen_at=timezone.now())


def participants_of(session):
    return list(
        session.participants.exclude(status=const.PARTICIPANT_KICKED).order_by("-score", "joined_at")
    )


def question_count(session) -> int:
    return session.questions.count()


# ─── Running the game ─────────────────────────────────────────────────────────


def start_game(*, session) -> LiveQuizSession:
    """Lobby → the countdown before question one."""
    state_machine.assert_transition(session.status, const.STATUS_STARTING)
    if question_count(session) == 0:
        raise BadRequest("That live quiz has no questions.", code="empty_set")

    now = timezone.now()
    require_session_update(
        pk=session.pk,
        expect_status=session.status,
        expect_version=session.version,
        updates={"status": const.STATUS_STARTING, "started_at": session.started_at or now},
    )
    session.refresh_from_db()
    return session


def open_question(*, session, index: int) -> tuple[LiveQuizSession, LiveQuizQuestion]:
    """Open the question at ``index`` and set its deadline.

    The deadline is computed here, server-side, and stored. That single fact is what makes
    every later "was this in time?" answerable without trusting anybody's clock.
    """
    state_machine.assert_transition(session.status, const.STATUS_QUESTION_ACTIVE)

    question = session.questions.filter(order=int(index)).first()
    if question is None:
        raise NotFound("There is no such question in this quiz.", code=const.ERR_UNKNOWN_QUESTION)

    now = timezone.now()
    require_session_update(
        pk=session.pk,
        expect_status=session.status,
        expect_version=session.version,
        updates={
            "status": const.STATUS_QUESTION_ACTIVE,
            "current_index": int(index),
            "question_started_at": now,
            "question_ends_at": now + timedelta(seconds=question.time_limit_seconds),
            "started_at": session.started_at or now,
        },
    )
    session.refresh_from_db()
    return session, question


def close_question(*, session) -> bool:
    """Close the open question. True if THIS call is the one that closed it.

    Three callers race here and all three are legitimate: the timer that fired at the
    deadline, the answer that completed the room, and the host pressing skip. Two of them
    get False and send nothing, so the room sees one "question ended".
    """
    if session.status != const.STATUS_QUESTION_ACTIVE:
        return False
    try:
        require_session_update(
            pk=session.pk,
            expect_status=const.STATUS_QUESTION_ACTIVE,
            expect_version=session.version,
            updates={"status": const.STATUS_QUESTION_RESULTS},
        )
    except TransitionConflict:
        return False
    session.refresh_from_db()
    return True


def advance(*, session) -> tuple[LiveQuizSession, LiveQuizQuestion | None]:
    """From the results screen: open the next question, or finish.

    Returns ``(session, None)`` when that was the last one and the game is now over.
    """
    if session.status != const.STATUS_QUESTION_RESULTS:
        raise Conflict("The game is not waiting to move on.", code=const.ERR_BAD_STATE)

    next_index = session.current_index + 1
    if next_index >= question_count(session):
        return finish_game(session=session), None

    return open_question(session=session, index=next_index)


def finish_game(*, session) -> LiveQuizSession:
    """End the game and write the final placings."""
    state_machine.assert_transition(session.status, const.STATUS_FINISHED)

    require_session_update(
        pk=session.pk,
        expect_status=session.status,
        expect_version=session.version,
        updates={
            "status": const.STATUS_FINISHED,
            "finished_at": timezone.now(),
            "question_ends_at": None,
        },
    )
    session.refresh_from_db()
    _write_ranks(session)
    return session


def _write_ranks(session) -> None:
    rows = list(
        session.participants.exclude(status=const.PARTICIPANT_KICKED).values_list("id", "score")
    )
    ranks = scoring.assign_ranks([(int(pk), int(score)) for pk, score in rows])
    for participant_id, place in ranks.items():
        LiveQuizParticipant.objects.filter(pk=participant_id).update(rank=place)


def pause_game(*, session) -> LiveQuizSession:
    """Freeze the room, remembering what to come back to."""
    state_machine.assert_transition(session.status, const.STATUS_PAUSED)
    require_session_update(
        pk=session.pk,
        expect_status=session.status,
        expect_version=session.version,
        updates={
            "status": const.STATUS_PAUSED,
            "paused_at": timezone.now(),
            "paused_from": session.status,
        },
    )
    session.refresh_from_db()
    return session


def resume_game(*, session) -> LiveQuizSession:
    """Unfreeze, giving back the time the pause took.

    Without the deadline shift, a host who pauses to answer a question from the back of the
    room returns to find the clock ran through the conversation and everybody is out of time.
    """
    if session.status != const.STATUS_PAUSED:
        raise Conflict("The game is not paused.", code=const.ERR_BAD_STATE)

    back_to = session.paused_from or const.STATUS_QUESTION_RESULTS
    state_machine.assert_transition(session.status, back_to)

    updates: dict = {"status": back_to, "paused_at": None, "paused_from": ""}
    if back_to == const.STATUS_QUESTION_ACTIVE and session.question_ends_at and session.paused_at:
        updates["question_ends_at"] = session.question_ends_at + (timezone.now() - session.paused_at)

    require_session_update(
        pk=session.pk,
        expect_status=const.STATUS_PAUSED,
        expect_version=session.version,
        updates=updates,
    )
    session.refresh_from_db()
    return session


def terminate_session(*, session) -> LiveQuizSession:
    """Stop the room for good. A terminated session cannot be rejoined."""
    if session.is_over:
        return session
    state_machine.assert_transition(session.status, const.STATUS_TERMINATED)
    require_session_update(
        pk=session.pk,
        expect_status=session.status,
        expect_version=session.version,
        updates={
            "status": const.STATUS_TERMINATED,
            "finished_at": timezone.now(),
            "question_ends_at": None,
        },
    )
    session.refresh_from_db()
    return session


def remove_participant(*, session, participant_id: int) -> LiveQuizParticipant | None:
    """Take a player out of the room, for good.

    Somebody reads the code off the board from the corridor, or a student joins the wrong
    class's game. The row is kept rather than deleted — their answers stay attached to the
    questions they actually answered — but they leave the leaderboard and cannot rejoin,
    because ``join_session`` refuses a KICKED place and the socket refuses the handshake.
    """
    if session.is_over:
        raise Conflict("That quiz has finished.", code=const.ERR_BAD_STATE)

    participant = LiveQuizParticipant.objects.filter(
        session=session, pk=int(participant_id)
    ).first()
    if participant is None:
        return None

    LiveQuizParticipant.objects.filter(pk=participant.pk).update(
        status=const.PARTICIPANT_KICKED, connections=0
    )
    participant.refresh_from_db()
    return participant


def end_game(*, session) -> LiveQuizSession:
    """Stop the room, whatever it happens to be doing.

    The host has one "End" button and it has to mean the right thing from any screen, so
    the decision lives here rather than in the consumer:

    * A game that never reached a question is **terminated**, not finished. Nothing was
      played, there is no result worth keeping, and the room should give its code back.
      The state machine agrees — there is no LOBBY → FINISHED edge — and before this
      existed, pressing End in the lobby raised InvalidTransition and the host was told
      "something went wrong" while the room stayed open.
    * An open question is closed first, so the answers already given are counted.
    * Anything else finishes normally, with places written.
    """
    if session.is_over:
        return session

    if session.status in (const.STATUS_LOBBY, const.STATUS_STARTING):
        return terminate_session(session=session)

    if session.status == const.STATUS_QUESTION_ACTIVE:
        close_question(session=session)
        session.refresh_from_db()

    return finish_game(session=session)


# ─── Answers ──────────────────────────────────────────────────────────────────


def submit_answer(*, session, participant, question_id, answer, now=None) -> LiveQuizAnswer:
    """Record one answer, mark it, and move the student's running total.

    Everything that could be argued about is decided here from stored facts: whether the
    question is open, whether the deadline has passed, and whether the answer is right.
    """
    now = now or timezone.now()

    if not state_machine.accepts_answers(session.status):
        raise Conflict("That question is not taking answers.", code=const.ERR_BAD_STATE)

    question = session.questions.filter(order=session.current_index).first()
    if question is None or int(question_id) != question.id:
        # Almost always a slow phone answering the previous question. Say so plainly rather
        # than recording it against whatever happens to be open now.
        raise Conflict("That question has already moved on.", code=const.ERR_UNKNOWN_QUESTION)

    deadline = session.question_ends_at
    if deadline is None:
        raise Conflict("That question is not taking answers.", code=const.ERR_BAD_STATE)
    if (now - deadline).total_seconds() * 1000.0 > const.LATE_ANSWER_GRACE_MS:
        raise Conflict("Time is up for that question.", code=const.ERR_TOO_LATE)

    started = session.question_started_at or now
    elapsed_ms = max(0, int((now - started).total_seconds() * 1000))

    is_correct = bool(
        grade_answer(
            question_type=question.question_type,
            correct_answer=question.correct_answer,
            answer=answer,
            config=question.grading_config or {},
        )
    )
    points = scoring.points_for(
        question_points=question.points,
        is_correct=is_correct,
        response_time_ms=elapsed_ms,
        limit_ms=int(question.time_limit_seconds) * 1000,
        speed_bonus_ratio=float(session.setting("speed_bonus_ratio") or 0.0),
    )

    with transaction.atomic():
        existing = (
            LiveQuizAnswer.objects.select_for_update()
            .filter(participant=participant, question=question)
            .first()
        )

        if existing is not None:
            if not session.setting("allow_answer_change"):
                raise Conflict("You have already answered this one.", code=const.ERR_ALREADY_ANSWERED)

            # Revising: move the totals by the difference, so the running tally stays equal
            # to the sum of the answers rather than drifting with every change.
            LiveQuizParticipant.objects.filter(pk=participant.pk).update(
                score=F("score") + (points - existing.points_awarded),
                correct_count=F("correct_count") + (int(is_correct) - int(existing.is_correct)),
            )
            existing.answer = answer
            existing.is_correct = is_correct
            existing.points_awarded = points
            existing.response_time_ms = elapsed_ms
            existing.save(
                update_fields=[
                    "answer",
                    "is_correct",
                    "points_awarded",
                    "response_time_ms",
                    "updated_at",
                ]
            )
            row = existing
        else:
            row = LiveQuizAnswer.objects.create(
                session=session,
                participant=participant,
                question=question,
                answer=answer,
                is_correct=is_correct,
                points_awarded=points,
                response_time_ms=elapsed_ms,
            )
            LiveQuizParticipant.objects.filter(pk=participant.pk).update(
                score=F("score") + points,
                correct_count=F("correct_count") + int(is_correct),
                answered_count=F("answered_count") + 1,
            )

    participant.refresh_from_db()
    return row


def question_tally(*, session, question) -> dict:
    """How the room answered one question — counts only, never who said what.

    The per-choice breakdown is what the host projects after the timer; naming the students
    who got it wrong on a screen in front of the class is not something this will do.
    """
    answers = list(
        LiveQuizAnswer.objects.filter(session=session, question=question).values_list(
            "answer", "is_correct"
        )
    )
    by_choice: dict[str, int] = {}
    for value, _ in answers:
        key = str(value) if value is not None else ""
        by_choice[key] = by_choice.get(key, 0) + 1

    playing = session.participants.filter(status=const.PARTICIPANT_JOINED).count()
    correct = sum(1 for _, ok in answers if ok)
    return {
        "answered": len(answers),
        "playing": playing,
        "correct": correct,
        "incorrect": len(answers) - correct,
        "by_choice": by_choice,
    }


def everyone_answered(*, session, question) -> bool:
    """True when every present player is in, so the host need not wait out the clock."""
    present = session.participants.filter(
        status=const.PARTICIPANT_JOINED, connections__gt=0
    ).count()
    if present == 0:
        return False
    answered = LiveQuizAnswer.objects.filter(session=session, question=question).count()
    return answered >= present


def results_report(session) -> dict:
    """The final table: every player, every question, for the results page."""
    questions = list(session.questions.order_by("order"))
    players = participants_of(session)
    answers = {
        (row.participant_id, row.question_id): row
        for row in LiveQuizAnswer.objects.filter(session=session)
    }

    rows = []
    for player in players:
        per_question = []
        for question in questions:
            answer = answers.get((player.id, question.id))
            per_question.append(
                {
                    "question_id": question.id,
                    "order": question.order,
                    "answered": answer is not None,
                    "is_correct": bool(answer.is_correct) if answer else False,
                    "points_awarded": int(answer.points_awarded) if answer else 0,
                    "response_time_ms": int(answer.response_time_ms) if answer else None,
                }
            )
        rows.append(
            {
                "participant_id": player.id,
                "user_id": player.user_id,
                "display_name": player.display_name,
                "score": player.score,
                "rank": player.rank,
                "correct_count": player.correct_count,
                "answered_count": player.answered_count,
                "answers": per_question,
            }
        )

    per_question_stats = []
    for question in questions:
        stats = question_tally(session=session, question=question)
        per_question_stats.append(
            {
                "question_id": question.id,
                "order": question.order,
                "prompt": question.prompt,
                "correct_answer": question.correct_answer,
                "answered": stats["answered"],
                "correct": stats["correct"],
                "by_choice": stats["by_choice"],
            }
        )

    return {"participants": rows, "questions": per_question_stats}
