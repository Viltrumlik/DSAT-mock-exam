"""The socket: one connection per person in the room.

What lives here is delivery and dispatch. Every decision that matters — may this person do
this, is the answer right, has time run out — is made in ``services`` against the database,
so a hand-written frame cannot talk this consumer into anything the REST API would refuse.

The timer deserves a word. When a question opens, the consumer that opened it arms an
asyncio task to close it at the deadline. That task is a convenience, not the authority:
the deadline itself is a column, ``close_question`` is compare-and-set, and answers are
checked against the stored deadline. So if this process is restarted mid-question, nothing
is corrupted — the timer is simply gone, and the next thing that happens in the room closes
the question late rather than never. The host's screen also has a Skip button for exactly
that case.
"""

from __future__ import annotations

import asyncio
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from core.errors.api import AppError
from users.permissions import IsAuthenticatedAndNotFrozen, is_frozen_learner

from . import constants as const
from . import events, paced, services
from .state_machine import InvalidTransition
from .models import LiveQuizParticipant, LiveQuizSession

logger = logging.getLogger("livequiz")

# Close codes. 4000+ is the private range; the client maps them to a plain-English reason.
CLOSE_DISABLED = 4503
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_GONE = 4404


def group_name_for(session_id: int) -> str:
    return f"livequiz.{int(session_id)}"


def personal_group_for(session_id: int, participant_id: int) -> str:
    """Every socket one student has open in one room — a phone and a laptop stay in step."""
    return f"livequiz.{int(session_id)}.p{int(participant_id)}"


# Student-paced: how often the host's socket refreshes everybody's view of the board. Pushing
# the whole board on every answer would be thirty phones times every answer; this is one
# frame every few seconds, and only when something changed.
BOARD_REFRESH_SECONDS = 3


class LiveQuizConsumer(AsyncJsonWebsocketConsumer):
    """One player or one host, attached to one room."""

    session_id: int = 0
    role: str | None = None
    participant_id: int | None = None
    # Fixed when the room is created, so read once at connect.
    student_paced: bool = False
    # A player in a room that hides correctness: every score in every frame they get is zeroed
    # until the game is over. Fixed at creation, like the mode, so read once at connect.
    score_blind: bool = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._timer: asyncio.Task | None = None
        # Student-paced: this socket's clock on its student's own question, and (host only)
        # the board refresher.
        self._own_timer: asyncio.Task | None = None
        self._ticker: asyncio.Task | None = None
        self._board_seen: tuple | None = None
        # Student-paced: the wait between the last answer and the game ending itself.
        self._finish_task: asyncio.Task | None = None

    @property
    def group_name(self) -> str:
        return group_name_for(self.session_id)

    @property
    def personal_group(self) -> str | None:
        if not self.participant_id:
            return None
        return personal_group_for(self.session_id, self.participant_id)

    # ── Connection lifecycle ─────────────────────────────────────────────────

    async def connect(self):
        if not bool(getattr(settings, "LIVE_QUIZ_ENABLED", False)):
            await self.close(code=CLOSE_DISABLED)
            return

        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return

        if is_frozen_learner(user):
            # REST refuses a frozen learner everything but signing in, and a place taken
            # before the freeze is no way round that. The middleware read this user from the
            # database for this handshake, so the flag is current.
            await self.close(code=CLOSE_FORBIDDEN)
            return

        try:
            self.session_id = int(self.scope["url_route"]["kwargs"]["session_id"])
        except (KeyError, TypeError, ValueError):
            await self.close(code=CLOSE_GONE)
            return

        resolved = await self._resolve_membership(user)
        if resolved is None:
            await self.close(code=CLOSE_FORBIDDEN)
            return
        self.role, self.participant_id, self.student_paced, hides_scores = resolved
        self.score_blind = bool(self.participant_id) and hides_scores

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        if self.personal_group:
            await self.channel_layer.group_add(self.personal_group, self.channel_name)
        await self.accept()

        if self.participant_id:
            await self._count_connection(up=True)
            if self.student_paced:
                # Back after a dropped connection or a locked phone: settle whatever ran out
                # while they were away, and make sure the question in front of them has a clock.
                await self._catch_up()

        state = await self._state()
        await self.send_json(
            {"type": const.EV_SESSION_STATE, "data": self._for_me(const.EV_SESSION_STATE, state)}
        )

        if self.student_paced:
            if self.participant_id:
                self._arm_own_timer(state)
            elif state.get("status") == const.STATUS_QUESTION_ACTIVE:
                self._start_ticker()

        if self.participant_id:
            await self._broadcast(const.EV_PARTICIPANT_JOINED, await self._lobby())
            await self._broadcast(const.EV_LOBBY_UPDATED, await self._lobby())

    async def disconnect(self, code):
        self._cancel_timer()
        self._cancel_own_timer()
        self._stop_ticker()
        if self._finish_task is not None and not self._finish_task.done():
            self._finish_task.cancel()
        if self.participant_id:
            await self._count_connection(up=False)
            try:
                await self._broadcast(const.EV_PARTICIPANT_LEFT, await self._lobby())
                await self._broadcast(const.EV_LOBBY_UPDATED, await self._lobby())
                # The one student everybody was waiting for may just have left.
                await self._try_finish_now()
            except Exception:  # pragma: no cover - the room may be gone entirely
                pass
        if self.channel_layer is not None:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
            if self.personal_group:
                await self.channel_layer.group_discard(self.personal_group, self.channel_name)

    # ── Inbound ──────────────────────────────────────────────────────────────

    async def receive_json(self, content, **kwargs):
        command = str((content or {}).get("type") or "").strip()

        if self.participant_id and await self._frozen_now():
            # Frozen while the socket was open. REST would refuse their next request, and
            # every frame is one — the heartbeat included, so a player who sends nothing else
            # is gone within one beat. Checked before the command, so an answer that came
            # with it is not counted. Players only: a host is staff, and this is a learner rule.
            await self._error(const.ERR_ACCOUNT_FROZEN, IsAuthenticatedAndNotFrozen.message)
            await self.close(code=CLOSE_FORBIDDEN)
            return

        if command == const.CMD_HEARTBEAT:
            if self.participant_id:
                await self._touch()
            await self.send_json({"type": const.EV_PONG, "data": {"ts": timezone.now().isoformat()}})
            return

        if command in const.HOST_ONLY_COMMANDS and self.role != services.ROLE_HOST:
            # Checked here, server-side. The student's UI has no button for this, but the
            # socket is open and anybody can type into it.
            await self._error(const.ERR_NOT_HOST, "Only the host can do that.")
            return

        if command in const.INSTRUCTOR_PACED_COMMANDS and self.student_paced:
            await self._error(
                const.ERR_WRONG_MODE, "Students move through this quiz at their own pace."
            )
            return

        handlers = {
            const.CMD_START_GAME: self._cmd_start_game,
            const.CMD_START_QUESTION: self._cmd_start_question,
            const.CMD_REQUEST_NEXT_QUESTION: self._cmd_advance,
            const.CMD_END_QUESTION: self._cmd_end_question,
            const.CMD_PAUSE_GAME: self._cmd_pause,
            const.CMD_RESUME_GAME: self._cmd_resume,
            const.CMD_END_GAME: self._cmd_end_game,
            const.CMD_SUBMIT_ANSWER: self._cmd_submit_answer,
            const.CMD_REMOVE_PARTICIPANT: self._cmd_remove_participant,
            const.CMD_LEAVE_SESSION: self._cmd_leave,
            const.CMD_USE_POWERUP: self._cmd_use_powerup,
        }
        handler = handlers.get(command)
        if handler is None:
            await self._error(const.ERR_INVALID_COMMAND, f"Unknown command {command!r}.")
            return

        try:
            await handler(content or {})
        except AppError as exc:
            await self._error(str(getattr(exc, "code", "") or const.ERR_BAD_STATE), exc.detail)
        except InvalidTransition as exc:
            # A move the rules do not allow — pausing a game that has not begun, say. That
            # is the host being ahead of the room, not a fault, and it must not read as one.
            await self._error(const.ERR_BAD_STATE, str(exc))
        except Exception:  # pragma: no cover - defensive; never kill the room
            logger.exception(
                "livequiz_command_failed session=%s command=%s", self.session_id, command
            )
            await self._error("server_error", "Something went wrong handling that.")

    # ── Commands ─────────────────────────────────────────────────────────────

    async def _cmd_start_game(self, _content):
        await self._call(services.start_game)
        await self._broadcast(const.EV_GAME_STARTED, {"countdown_seconds": const.COUNTDOWN_SECONDS})
        # The countdown is a real wait, not a client animation, so every screen turns over
        # together rather than whenever each phone's own timer happens to fire.
        await asyncio.sleep(const.COUNTDOWN_SECONDS)
        if self.student_paced:
            # Everyone gets their own first question at the same instant; from here each
            # student's socket keeps its own clock.
            for participant_id, frame in await self._begin_play():
                await self._send_personal(participant_id, const.EV_QUESTION_STARTED, frame)
            # No room-wide frame says "in play" — every student got their own question
            # instead — so the host's screens are told directly, with the board, which is
            # why this goes to hosts only.
            await self._broadcast(
                const.EV_SESSION_STATE, await self._state(), audience=services.ROLE_HOST
            )
            self._start_ticker()
            return
        await self._open_question(0)

    async def _cmd_start_question(self, content):
        index = content.get("index")
        session = await self._session()
        await self._open_question(int(index) if index is not None else session.current_index + 1)

    async def _cmd_advance(self, _content):
        session, question = await self._advance()
        if question is None:
            await self._announce_finished()
            return
        await self._announce_question(session, question)

    async def _cmd_end_question(self, _content):
        await self._end_question()

    async def _cmd_pause(self, _content):
        self._cancel_timer()
        self._stop_ticker()
        await self._call(services.pause_game)
        await self._broadcast(const.EV_GAME_PAUSED, await self._room_state())

    async def _cmd_resume(self, _content):
        session = await self._call(services.resume_game)
        await self._broadcast(const.EV_GAME_RESUMED, await self._room_state())
        if session.status == const.STATUS_QUESTION_ACTIVE:
            if self.student_paced:
                # Each student's socket fetches its own moved clock when it hears this.
                self._start_ticker()
            else:
                self._arm_timer(session)

    async def _cmd_end_game(self, _content):
        self._cancel_timer()
        self._stop_ticker()
        session = await self._call(services.end_game)
        if session.status == const.STATUS_TERMINATED:
            # It never started, so there is no result to show — say so plainly instead of
            # putting an empty leaderboard on the projector.
            await self._broadcast(const.EV_SESSION_TERMINATED, await self._room_state())
            return
        await self._announce_finished()

    async def _cmd_remove_participant(self, content):
        removed = await self._remove_participant(content.get("participant_id"))
        if removed is None:
            await self._error(const.ERR_NOT_PARTICIPANT, "There is no such player in this room.")
            return
        # Sent to the whole room: the lobby already shows every name, so this tells nobody
        # anything new, and it is the removed player's own socket that acts on it.
        await self._broadcast(const.EV_REMOVED, {"participant_id": removed})
        await self._broadcast(const.EV_LOBBY_UPDATED, await self._lobby())
        # Removing the last student still playing leaves nobody to wait for.
        await self._try_finish_now()

    async def _cmd_leave(self, _content):
        await self.close()

    async def _cmd_submit_answer(self, content):
        if self.role != services.ROLE_PLAYER or not self.participant_id:
            await self._error(const.ERR_NOT_PARTICIPANT, "You are not playing this quiz.")
            return

        if self.student_paced:
            move = await self._submit_own(content.get("question_id"), content.get("answer"))
            await self._publish_move(move)
            return

        answer_row = await self._submit(content.get("question_id"), content.get("answer"))
        session = await self._session()
        await self.send_json(
            {
                "type": const.EV_ANSWER_RESULT,
                "data": events.answer_result(
                    answer=answer_row, reveal=bool(session.setting("reveal_correctness"))
                ),
            }
        )

        # The host watches the count come in. Names are deliberately not in this frame.
        tally = await self._tally()
        if tally is not None:
            await self._broadcast(const.EV_ANSWER_TALLY, tally, audience=services.ROLE_HOST)

        if await self._everyone_in():
            # Nobody is left to wait for, so stop the clock early rather than making the
            # room watch an empty countdown.
            await self._end_question()

    async def _cmd_use_powerup(self, content):
        if self.role != services.ROLE_PLAYER or not self.participant_id:
            await self._error(const.ERR_NOT_PARTICIPANT, "You are not playing this quiz.")
            return
        applied = await self._use_powerup(str(content.get("powerup") or ""))
        await self._send_personal(self.participant_id, const.EV_POWERUP_APPLIED, applied)

    # ── Student-paced: one student's moves ───────────────────────────────────

    async def _publish_move(self, move) -> None:
        """Tell a student how that went and give them the next one; tell the host they moved."""
        result, nxt, progress, leaderboard, standings_to = await self._move_frames(move)
        await self._send_personal(move.participant.id, const.EV_ANSWER_RESULT, result)
        if move.awarded:
            await self._send_personal(
                move.participant.id,
                const.EV_POWERUP_AWARDED,
                {"powerup": move.awarded, "inventory": list(move.participant.powerups or [])},
            )
        if nxt is not None:
            await self._send_personal(move.participant.id, const.EV_QUESTION_STARTED, nxt)
        await self._broadcast(const.EV_PLAYER_PROGRESS, progress, audience=services.ROLE_HOST)
        if leaderboard is not None:
            # Somebody finished — the waiting screens of everyone already done move too, unless
            # the leaderboard is off, when only the teacher sees it.
            await self._broadcast(const.EV_LEADERBOARD_UPDATED, leaderboard, audience=standings_to)
        if move.finished:
            self._schedule_finish_check()

    # ── Student-paced: the game ends itself when everyone is done ────────────

    def _schedule_finish_check(self) -> None:
        """After a student's last answer: let their result show, then end the game if it's over."""
        if self._finish_task is not None and not self._finish_task.done():
            self._finish_task.cancel()
        self._finish_task = asyncio.create_task(self._finish_after_feedback())

    async def _finish_after_feedback(self) -> None:
        try:
            # The last student reads how their last answer went before the podium replaces it.
            await asyncio.sleep(const.FEEDBACK_SECONDS)
            await self._try_finish_now()
        except asyncio.CancelledError:  # pragma: no cover - their socket closed first
            raise
        except Exception:  # pragma: no cover
            logger.exception("livequiz_auto_finish_failed session=%s", self.session_id)

    async def _try_finish_now(self) -> None:
        if self.student_paced and await self._finish_if_done():
            self._stop_ticker()
            await self._announce_finished()

    async def _send_personal(self, participant_id: int, event: str, data: dict) -> None:
        await self.channel_layer.group_send(
            personal_group_for(self.session_id, participant_id),
            {"type": "personal", "event": event, "data": data},
        )

    async def personal(self, message):
        """Group handler for one student's own frames. Every socket of theirs keeps the clock."""
        event, data = message["event"], message["data"]
        await self.send_json({"type": event, "data": data})
        if event == const.EV_QUESTION_STARTED:
            self._arm_own_timer(data)
        elif event == const.EV_POWERUP_APPLIED and data.get("frozen"):
            self._cancel_own_timer()
        elif event == const.EV_ANSWER_RESULT and data.get("finished"):
            self._cancel_own_timer()

    def _arm_own_timer(self, frame: dict) -> None:
        """Run out this student's question when its clock does. A frame with no clock arms nothing.

        Every socket the student has open arms one; only the first to fire can move them on.
        If no socket is open at the deadline, nothing fires — the question is settled when
        they come back (``paced.catch_up``), which is the honest moment to do it.
        """
        self._cancel_own_timer()
        question = frame.get("question") or {}
        ends_in_ms = frame.get("ends_in_ms")
        if not question or ends_in_ms is None or frame.get("frozen"):
            return
        position = int(question.get("index", -1))
        delay = (int(ends_in_ms) + const.LATE_ANSWER_GRACE_MS + 50) / 1000.0
        self._own_timer = asyncio.create_task(self._run_own_timer(position, delay))

    def _cancel_own_timer(self) -> None:
        current = asyncio.current_task()
        if self._own_timer is not None and self._own_timer is not current and not self._own_timer.done():
            self._own_timer.cancel()
        self._own_timer = None

    async def _run_own_timer(self, position: int, delay: float) -> None:
        try:
            await asyncio.sleep(max(0.0, delay))
            # Let go of the slot first. Publishing sends this student their next question,
            # whose handler arms a new timer — and arming cancels whatever is in the slot,
            # which would be this task, halfway through telling the host.
            if self._own_timer is asyncio.current_task():
                self._own_timer = None
            move = await self._time_out(position)
            if move is not None:
                await self._publish_move(move)
        except asyncio.CancelledError:  # pragma: no cover - normal on answer/pause/disconnect
            raise
        except Exception:  # pragma: no cover
            logger.exception("livequiz_own_timer_failed session=%s", self.session_id)

    def _start_ticker(self) -> None:
        if self.role != services.ROLE_HOST or not self.student_paced:
            return
        self._stop_ticker()
        self._ticker = asyncio.create_task(self._run_ticker())

    def _stop_ticker(self) -> None:
        current = asyncio.current_task()
        if self._ticker is not None and self._ticker is not current and not self._ticker.done():
            self._ticker.cancel()
        self._ticker = None

    async def _run_ticker(self) -> None:
        """Push the board to the room every few seconds while it changes. Host socket only."""
        try:
            while True:
                await asyncio.sleep(BOARD_REFRESH_SECONDS)
                status, leaderboard, fingerprint, standings_to = await self._board_snapshot()
                if status != const.STATUS_QUESTION_ACTIVE:
                    return
                if fingerprint != self._board_seen:
                    self._board_seen = fingerprint
                    await self._broadcast(
                        const.EV_LEADERBOARD_UPDATED, leaderboard, audience=standings_to
                    )
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception:  # pragma: no cover
            logger.exception("livequiz_ticker_failed session=%s", self.session_id)

    # ── Game moves shared by several commands ────────────────────────────────

    async def _open_question(self, index: int):
        session, question = await self._call_open(index)
        await self._announce_question(session, question)

    async def _announce_question(self, session, question):
        total = await self._total()
        await self._broadcast(
            const.EV_QUESTION_STARTED, events.question_started(session, question, total=total)
        )
        self._arm_timer(session)

    async def _end_question(self):
        """Close the open question and publish the answer. Safe to call twice."""
        self._cancel_timer()
        closed = await self._call(services.close_question)
        if not closed:
            return

        session = await self._session()
        question, total, tally = await self._closing_payload(session)
        if question is None:
            return

        closing = events.question_ended(session, question, tally=tally, total=total)
        if session.setting("show_answers"):
            await self._broadcast(const.EV_QUESTION_ENDED, closing)
        else:
            # The teacher kept the answers to themselves: the projector still needs the key to
            # reveal it when they choose, but no student's frame carries it.
            await self._broadcast(const.EV_QUESTION_ENDED, closing, audience=services.ROLE_HOST)
            await self._broadcast(
                const.EV_QUESTION_ENDED, events.without_key(closing), audience=services.ROLE_PLAYER
            )
        if bool(session.setting("show_leaderboard_between")):
            await self._broadcast(const.EV_LEADERBOARD_UPDATED, await self._leaderboard())

        if not bool(session.setting("manual_advance")):
            await asyncio.sleep(const.COUNTDOWN_SECONDS)
            await self._cmd_advance({})

    async def _announce_finished(self):
        await self._broadcast(
            const.EV_GAME_FINISHED,
            {"leaderboard": await self._leaderboard(), "session": await self._room_state()},
        )

    # ── The timer ────────────────────────────────────────────────────────────

    def _arm_timer(self, session) -> None:
        self._cancel_timer()
        if not session.question_ends_at:
            return
        seconds = (session.question_ends_at - timezone.now()).total_seconds()
        self._timer = asyncio.create_task(self._run_timer(seconds))

    def _cancel_timer(self) -> None:
        # Never the task that is running this: the timer ends its own question, and
        # `_end_question` starts by cancelling the timer. A task that cancels itself is torn
        # down at its next await — which was the database write closing the question — so
        # the question closed and nobody was told: no `question_ended`, no standings, no
        # auto-advance, every phone left at 0 s until the teacher pressed Skip.
        current = asyncio.current_task()
        if self._timer is not None and self._timer is not current and not self._timer.done():
            self._timer.cancel()
        self._timer = None

    async def _run_timer(self, seconds: float) -> None:
        try:
            warn_at = seconds - const.TIME_WARNING_SECONDS
            if warn_at > 0:
                await asyncio.sleep(warn_at)
                await self._broadcast(
                    const.EV_QUESTION_TIME_WARNING, {"seconds_left": const.TIME_WARNING_SECONDS}
                )
                await asyncio.sleep(const.TIME_WARNING_SECONDS)
            elif seconds > 0:
                await asyncio.sleep(seconds)
            await self._end_question()
        except asyncio.CancelledError:  # pragma: no cover - normal on skip/pause/disconnect
            raise
        except Exception:  # pragma: no cover
            logger.exception("livequiz_timer_failed session=%s", self.session_id)

    # ── Group plumbing ───────────────────────────────────────────────────────

    async def _broadcast(self, event: str, data: dict, *, audience: str | None = None) -> None:
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "fanout", "event": event, "data": data, "audience": audience},
        )

    async def fanout(self, message):
        """Group handler. ``audience`` lets a frame reach only the host or only players."""
        audience = message.get("audience")
        if audience and audience != self.role:
            return
        await self.send_json(
            {"type": message["event"], "data": self._for_me(message["event"], message["data"])}
        )

        # The player who was removed hears it and then goes. Closing here rather than
        # waiting for them to navigate away means the lobby count is right immediately.
        if (
            message["event"] == const.EV_REMOVED
            and self.participant_id
            and message["data"].get("participant_id") == self.participant_id
        ):
            await self.close(code=CLOSE_FORBIDDEN)
            return

        if self.student_paced and self.participant_id:
            event = message["event"]
            if event in (const.EV_GAME_PAUSED, const.EV_GAME_FINISHED, const.EV_SESSION_TERMINATED):
                self._cancel_own_timer()
            elif event == const.EV_GAME_RESUMED:
                # The room's frame says "resumed"; this student's clock moved by the pause,
                # and only their own state carries the new deadline.
                state = await self._state()
                await self.send_json(
                    {"type": const.EV_SESSION_STATE, "data": self._for_me(const.EV_SESSION_STATE, state)}
                )
                self._arm_own_timer(state)

    def _for_me(self, event: str, data):
        """The frame as this socket may see it. Only a score-blind player's frames change, and
        only until the game is over — the final standings are everybody's."""
        if not self.score_blind or event == const.EV_GAME_FINISHED:
            return data
        if isinstance(data, dict) and data.get("status") in const.TERMINAL_STATUSES:
            return data
        return events.without_scores(data)

    async def _error(self, code: str, detail: str) -> None:
        await self.send_json({"type": const.EV_ERROR, "data": events.error(code, detail)})

    # ── Database hops. Everything below crosses into sync Django. ────────────

    @database_sync_to_async
    def _resolve_membership(self, user):
        session = (
            LiveQuizSession.objects.select_related("classroom").filter(pk=self.session_id).first()
        )
        if session is None or session.status == const.STATUS_TERMINATED:
            return None

        role = services.role_in_session(user, session)
        if role is None:
            return None
        student_paced = paced.is_student_paced(session)
        hides_scores = not session.setting("reveal_correctness")
        if role == services.ROLE_HOST:
            return role, None, student_paced, hides_scores

        participant = LiveQuizParticipant.objects.filter(session=session, user=user).first()
        if participant is None or participant.status == const.PARTICIPANT_KICKED:
            # Joining happens over REST, where the code is checked. Arriving at the socket
            # without a place means a stale tab or a guessed session id.
            return None
        return role, participant.id, student_paced, hides_scores

    @database_sync_to_async
    def _frozen_now(self) -> bool:
        # Read again: the user in scope is the one the handshake saw.
        user = (
            get_user_model()
            .objects.filter(pk=self.scope["user"].pk)
            .only("role", "is_frozen", "email")
            .first()
        )
        return user is not None and is_frozen_learner(user)

    @database_sync_to_async
    def _load_session(self):
        return (
            LiveQuizSession.objects.select_related("classroom", "vocab_set", "assessment_set")
            .filter(pk=self.session_id)
            .first()
        )

    async def _session(self):
        session = await self._load_session()
        if session is None:
            raise AppError("That live quiz is gone.", code=const.ERR_BAD_STATE, status_code=404)
        return session

    @database_sync_to_async
    def _state_sync(self, participant_id, room: bool = False):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        me = (
            LiveQuizParticipant.objects.filter(pk=participant_id).first() if participant_id else None
        )
        own = None
        if me is not None and paced.is_student_paced(session):
            question = paced.current_question(session, me)
            if question is not None and me.question_started_at is not None:
                own = events.own_question(me, question, now=timezone.now())
        # The board names who got what wrong. It goes to the host's own socket, never into a
        # frame the whole room receives.
        board = None
        if not room and me is None and self.role == services.ROLE_HOST and paced.is_student_paced(session):
            board = paced.board(session)
        return events.session_state(
            session,
            participants=services.participants_of(session),
            question=session.current_question(),
            total=services.question_count(session),
            me=me,
            own_question=own,
            board=board,
        )

    async def _state(self):
        return await self._state_sync(self.participant_id)

    async def _room_state(self):
        """The room as everybody may see it — for frames broadcast to every socket."""
        return await self._state_sync(None, room=True)

    # ── Student-paced hops ───────────────────────────────────────────────────

    @database_sync_to_async
    def _catch_up(self):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        participant = LiveQuizParticipant.objects.get(pk=self.participant_id)
        paced.catch_up(session=session, participant=participant)

    @database_sync_to_async
    def _begin_play(self):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        session, opened = paced.begin_play(session=session)
        now = timezone.now()
        frames = []
        for participant in opened:
            question = paced.current_question(session, participant)
            if question is not None and participant.question_started_at is not None:
                frames.append((participant.id, events.own_question(participant, question, now=now)))
        return frames

    @database_sync_to_async
    def _submit_own(self, question_id, answer):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        participant = LiveQuizParticipant.objects.get(pk=self.participant_id)
        return paced.submit(
            session=session, participant=participant, question_id=question_id, answer=answer
        )

    @database_sync_to_async
    def _time_out(self, position):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        return paced.time_out(session=session, participant_id=self.participant_id, position=position)

    @database_sync_to_async
    def _use_powerup(self, key):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        participant = LiveQuizParticipant.objects.get(pk=self.participant_id)
        applied = paced.use_powerup(session=session, participant=participant, key=key)
        participant.refresh_from_db()
        question = paced.current_question(session, participant)
        if question is not None:
            # The whole question frame again, so every socket of theirs redraws the same
            # options and the same (possibly stopped) clock.
            applied.update(events.own_question(participant, question, now=timezone.now()))
        return applied

    @database_sync_to_async
    def _move_frames(self, move):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        participant = move.participant
        standing = None
        if session.setting("reveal_correctness") and session.setting("show_leaderboard_between"):
            standing = paced.standing(session=session, participant=participant)
        result = events.own_answer_result(move, session=session, standing=standing)
        nxt = None
        if move.next_question is not None and participant.question_started_at is not None:
            nxt = events.own_question(participant, move.next_question, now=timezone.now())
        progress = {
            "participant": events.participant_row(participant),
            "cell": paced.cell(
                move.question.order,
                move.answer.is_correct,
                move.answer.timed_out,
                move.answer.points_awarded,
            ),
        }
        leaderboard = (
            events.leaderboard(services.participants_of(session)) if move.finished else None
        )
        return result, nxt, progress, leaderboard, services.standings_audience(session)

    @database_sync_to_async
    def _finish_if_done(self) -> bool:
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        return services.finish_when_everyone_is_done(session=session)

    @database_sync_to_async
    def _board_snapshot(self):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        players = services.participants_of(session)
        fingerprint = tuple((p.id, p.score, p.position, p.status) for p in players)
        return (
            session.status,
            events.leaderboard(players),
            fingerprint,
            services.standings_audience(session),
        )

    @database_sync_to_async
    def _lobby_sync(self):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        return events.lobby(session, services.participants_of(session))

    async def _lobby(self):
        return await self._lobby_sync()

    @database_sync_to_async
    def _leaderboard_sync(self):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        return events.leaderboard(services.participants_of(session))

    async def _leaderboard(self):
        return await self._leaderboard_sync()

    @database_sync_to_async
    def _total_sync(self):
        return services.question_count(LiveQuizSession.objects.get(pk=self.session_id))

    async def _total(self):
        return await self._total_sync()

    @database_sync_to_async
    def _call_sync(self, fn):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        return fn(session=session)

    async def _call(self, fn):
        return await self._call_sync(fn)

    @database_sync_to_async
    def _call_open_sync(self, index):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        return services.open_question(session=session, index=index)

    async def _call_open(self, index):
        return await self._call_open_sync(index)

    @database_sync_to_async
    def _advance_sync(self):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        return services.advance(session=session)

    async def _advance(self):
        return await self._advance_sync()

    @database_sync_to_async
    def _submit_sync(self, question_id, answer):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        participant = LiveQuizParticipant.objects.get(pk=self.participant_id)
        return services.submit_answer(
            session=session, participant=participant, question_id=question_id, answer=answer
        )

    async def _submit(self, question_id, answer):
        return await self._submit_sync(question_id, answer)

    @database_sync_to_async
    def _tally_sync(self):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        question = session.current_question()
        if question is None:
            return None
        return services.question_tally(session=session, question=question)

    async def _tally(self):
        return await self._tally_sync()

    @database_sync_to_async
    def _closing_payload_sync(self, session_id):
        session = LiveQuizSession.objects.get(pk=session_id)
        question = session.current_question()
        if question is None:
            return None, 0, {}
        return (
            question,
            services.question_count(session),
            services.question_tally(session=session, question=question),
        )

    async def _closing_payload(self, session):
        return await self._closing_payload_sync(session.pk)

    @database_sync_to_async
    def _everyone_in_sync(self):
        session = LiveQuizSession.objects.get(pk=self.session_id)
        question = session.current_question()
        if question is None or session.status != const.STATUS_QUESTION_ACTIVE:
            return False
        return services.everyone_answered(session=session, question=question)

    async def _everyone_in(self):
        return await self._everyone_in_sync()

    @database_sync_to_async
    def _count_connection(self, *, up: bool):
        participant = LiveQuizParticipant.objects.filter(pk=self.participant_id).first()
        if participant is None:
            return
        if up:
            services.mark_connected(participant)
        else:
            services.mark_disconnected(participant)

    @database_sync_to_async
    def _remove_participant(self, participant_id):
        if participant_id is None:
            return None
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        removed = services.remove_participant(session=session, participant_id=participant_id)
        return removed.id if removed else None

    @database_sync_to_async
    def _touch(self):
        participant = LiveQuizParticipant.objects.filter(pk=self.participant_id).first()
        if participant is not None:
            services.touch(participant)
