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
from django.utils import timezone

from core.errors.api import AppError

from . import constants as const
from . import events, services
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


class LiveQuizConsumer(AsyncJsonWebsocketConsumer):
    """One player or one host, attached to one room."""

    session_id: int = 0
    role: str | None = None
    participant_id: int | None = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._timer: asyncio.Task | None = None

    @property
    def group_name(self) -> str:
        return group_name_for(self.session_id)

    # ── Connection lifecycle ─────────────────────────────────────────────────

    async def connect(self):
        if not bool(getattr(settings, "LIVE_QUIZ_ENABLED", False)):
            await self.close(code=CLOSE_DISABLED)
            return

        user = self.scope.get("user")
        if not user or not getattr(user, "is_authenticated", False):
            await self.close(code=CLOSE_UNAUTHENTICATED)
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
        self.role, self.participant_id = resolved

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        if self.participant_id:
            await self._count_connection(up=True)

        await self.send_json({"type": const.EV_SESSION_STATE, "data": await self._state()})

        if self.participant_id:
            await self._broadcast(const.EV_PARTICIPANT_JOINED, await self._lobby())
            await self._broadcast(const.EV_LOBBY_UPDATED, await self._lobby())

    async def disconnect(self, code):
        self._cancel_timer()
        if self.participant_id:
            await self._count_connection(up=False)
            try:
                await self._broadcast(const.EV_PARTICIPANT_LEFT, await self._lobby())
                await self._broadcast(const.EV_LOBBY_UPDATED, await self._lobby())
            except Exception:  # pragma: no cover - the room may be gone entirely
                pass
        if self.channel_layer is not None:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # ── Inbound ──────────────────────────────────────────────────────────────

    async def receive_json(self, content, **kwargs):
        command = str((content or {}).get("type") or "").strip()

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
        await self._call(services.pause_game)
        await self._broadcast(const.EV_GAME_PAUSED, await self._state())

    async def _cmd_resume(self, _content):
        session = await self._call(services.resume_game)
        await self._broadcast(const.EV_GAME_RESUMED, await self._state())
        if session.status == const.STATUS_QUESTION_ACTIVE:
            self._arm_timer(session)

    async def _cmd_end_game(self, _content):
        self._cancel_timer()
        session = await self._call(services.end_game)
        if session.status == const.STATUS_TERMINATED:
            # It never started, so there is no result to show — say so plainly instead of
            # putting an empty leaderboard on the projector.
            await self._broadcast(const.EV_SESSION_TERMINATED, await self._state())
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

    async def _cmd_leave(self, _content):
        await self.close()

    async def _cmd_submit_answer(self, content):
        if self.role != services.ROLE_PLAYER or not self.participant_id:
            await self._error(const.ERR_NOT_PARTICIPANT, "You are not playing this quiz.")
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

        await self._broadcast(
            const.EV_QUESTION_ENDED,
            events.question_ended(session, question, tally=tally, total=total),
        )
        if bool(session.setting("show_leaderboard_between")):
            await self._broadcast(const.EV_LEADERBOARD_UPDATED, await self._leaderboard())

        if not bool(session.setting("manual_advance")):
            await asyncio.sleep(const.COUNTDOWN_SECONDS)
            await self._cmd_advance({})

    async def _announce_finished(self):
        await self._broadcast(
            const.EV_GAME_FINISHED,
            {"leaderboard": await self._leaderboard(), "session": await self._state()},
        )

    # ── The timer ────────────────────────────────────────────────────────────

    def _arm_timer(self, session) -> None:
        self._cancel_timer()
        if not session.question_ends_at:
            return
        seconds = (session.question_ends_at - timezone.now()).total_seconds()
        self._timer = asyncio.create_task(self._run_timer(seconds))

    def _cancel_timer(self) -> None:
        if self._timer is not None and not self._timer.done():
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
        await self.send_json({"type": message["event"], "data": message["data"]})

        # The player who was removed hears it and then goes. Closing here rather than
        # waiting for them to navigate away means the lobby count is right immediately.
        if (
            message["event"] == const.EV_REMOVED
            and self.participant_id
            and message["data"].get("participant_id") == self.participant_id
        ):
            await self.close(code=CLOSE_FORBIDDEN)

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
        if role == services.ROLE_HOST:
            return role, None

        participant = LiveQuizParticipant.objects.filter(session=session, user=user).first()
        if participant is None or participant.status == const.PARTICIPANT_KICKED:
            # Joining happens over REST, where the code is checked. Arriving at the socket
            # without a place means a stale tab or a guessed session id.
            return None
        return role, participant.id

    @database_sync_to_async
    def _load_session(self):
        return (
            LiveQuizSession.objects.select_related("classroom", "vocab_set")
            .filter(pk=self.session_id)
            .first()
        )

    async def _session(self):
        session = await self._load_session()
        if session is None:
            raise AppError("That live quiz is gone.", code=const.ERR_BAD_STATE, status_code=404)
        return session

    @database_sync_to_async
    def _state_sync(self, participant_id):
        session = LiveQuizSession.objects.select_related("classroom").get(pk=self.session_id)
        me = (
            LiveQuizParticipant.objects.filter(pk=participant_id).first() if participant_id else None
        )
        return events.session_state(
            session,
            participants=services.participants_of(session),
            question=session.current_question(),
            total=services.question_count(session),
            me=me,
        )

    async def _state(self):
        return await self._state_sync(self.participant_id)

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
