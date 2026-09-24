"""The socket, end to end: connect, start, answer, close.

Uses Channels' own communicator against the real consumer, so the routing, the frames and
the services underneath are all exercised together.

``TransactionTestCase`` rather than ``TestCase`` on purpose: the consumer reaches the
database through ``database_sync_to_async``, which runs in a worker thread, and a thread
cannot see rows written inside another thread's open transaction. A ``TestCase`` wraps each
test in one, so the consumer would find an empty database.
"""

from __future__ import annotations

import json
from datetime import timedelta

from asgiref.sync import async_to_sync
from asgiref.testing import ApplicationCommunicator
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from vocabulary.models import VocabSection, VocabSet, VocabSetItem, VocabWord
from classes.models import Classroom, ClassroomMembership

from . import constants as const
from . import services
from .models import LiveQuizSession
from .routing import websocket_urlpatterns

IN_MEMORY_LAYER = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


class WebsocketClient(ApplicationCommunicator):
    """A minimal websocket client for a consumer under test.

    Channels ships one of these, but importing ``channels.testing`` pulls in
    ``ChannelsLiveServerTestCase``, which imports daphne — and daphne is not what serves
    this in production (see requirements.txt). ``asgiref.testing`` is already a dependency
    and the ASGI websocket protocol is four message types, so this is the whole of it.
    """

    def __init__(self, application, path, user):
        super().__init__(
            application,
            {
                "type": "websocket",
                "path": path,
                "raw_path": path.encode(),
                "headers": [],
                "subprotocols": [],
                "query_string": b"",
                "client": ("127.0.0.1", 0),
                "server": ("127.0.0.1", 80),
                "user": user,
            },
        )

    async def connect(self, timeout=5):
        await self.send_input({"type": "websocket.connect"})
        response = await self.receive_output(timeout)
        if response["type"] == "websocket.close":
            return False, response.get("code", 1000)
        return True, response.get("subprotocol")

    async def send_json_to(self, data):
        await self.send_input({"type": "websocket.receive", "text": json.dumps(data)})

    async def receive_json_from(self, timeout=5):
        response = await self.receive_output(timeout)
        assert response["type"] == "websocket.send", response
        return json.loads(response["text"])

    async def disconnect(self, code=1000, timeout=5):
        await self.send_input({"type": "websocket.disconnect", "code": code})
        await self.wait(timeout)


async def await_frame(client, expected, limit=12):
    """Read until ``expected`` arrives.

    A connected player also receives the room's own lobby broadcasts, so the reply to a
    command is rarely the very next frame. Waiting for the one under test — rather than
    asserting on whatever came first — is what keeps these tests from breaking every time
    the room gains another piece of news to share.
    """
    seen = []
    for _ in range(limit):
        frame = await client.receive_json_from()
        seen.append(frame["type"])
        if frame["type"] == expected:
            return frame
    raise AssertionError(f"{expected!r} never arrived; saw {seen}")


@override_settings(LIVE_QUIZ_ENABLED=True, CHANNEL_LAYERS=IN_MEMORY_LAYER)
class LiveQuizSocketTests(TransactionTestCase):
    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="host@example.test", password="pw-for-tests", role="teacher", subject="math"
        )
        self.student = User.objects.create_user(
            email="player@example.test", password="pw-for-tests", role="student"
        )
        self.outsider = User.objects.create_user(
            email="nobody@example.test", password="pw-for-tests", role="student"
        )

        self.classroom = Classroom.objects.create(
            name="Socket Class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

        self.section = VocabSection.objects.create(
            title="Socket Words", slug="socket-words-test", order=1
        )
        self.vocab_set = VocabSet.objects.create(section=self.section, title="Set 1", order=1)
        WORDS = [
            ("abate", "to become less intense"),
            ("candid", "truthful and straightforward"),
            ("deft", "neatly skilful and quick"),
            ("elated", "extremely happy"),
            ("frugal", "sparing with money"),
        ]
        self.words = [
            VocabWord.objects.create(section=self.section, word=w, definition=d)
            for w, d in WORDS
        ]
        for position, word in enumerate(self.words):
            VocabSetItem.objects.create(vocab_set=self.vocab_set, word=word, order=position)

        self.session = services.create_session(
            host=self.teacher,
            classroom=self.classroom,
            vocab_set=self.vocab_set,
            config={"question_seconds": 30, "manual_advance": True},
        )

    def tearDown(self):
        # The in-memory layer keeps groups between tests in the same process.
        layer = get_channel_layer()
        if layer is not None:
            async_to_sync(layer.flush)()

    def _communicator(self, user):
        return WebsocketClient(
            URLRouter(websocket_urlpatterns), f"/ws/livequiz/{self.session.pk}/", user
        )

    def test_a_student_with_a_place_connects_and_is_sent_the_room(self):
        services.join_session(session=self.session, user=self.student)

        async def run():
            communicator = self._communicator(self.student)
            connected, _ = await communicator.connect()
            self.assertTrue(connected)

            first = await communicator.receive_json_from()
            self.assertEqual(first["type"], const.EV_SESSION_STATE)
            self.assertEqual(first["data"]["status"], const.STATUS_LOBBY)
            self.assertEqual(first["data"]["join_code"], self.session.join_code)

            await communicator.disconnect()

        async_to_sync(run)()

    def test_somebody_from_another_class_is_refused(self):
        async def run():
            communicator = self._communicator(self.outsider)
            connected, _ = await communicator.connect()
            self.assertFalse(connected)

        async_to_sync(run)()

    def test_a_student_without_a_place_is_refused(self):
        # They never went through /join/, so they have no participant row.
        async def run():
            communicator = self._communicator(self.student)
            connected, _ = await communicator.connect()
            self.assertFalse(connected)

        async_to_sync(run)()

    def test_a_student_cannot_start_the_game(self):
        services.join_session(session=self.session, user=self.student)

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            await communicator.receive_json_from()  # session_state

            await communicator.send_json_to({"type": const.CMD_START_GAME})
            reply = await await_frame(communicator, const.EV_ERROR)

            self.assertEqual(reply["data"]["code"], const.ERR_NOT_HOST)
            await communicator.disconnect()

        async_to_sync(run)()

        self.session.refresh_from_db()
        self.assertEqual(self.session.status, const.STATUS_LOBBY)

    def test_the_heartbeat_is_answered(self):
        services.join_session(session=self.session, user=self.student)

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({"type": const.CMD_HEARTBEAT})
            await await_frame(communicator, const.EV_PONG)
            await communicator.disconnect()

        async_to_sync(run)()

    def test_an_unknown_command_is_answered_with_an_error_not_a_crash(self):
        services.join_session(session=self.session, user=self.student)

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({"type": "drop_the_database"})
            reply = await await_frame(communicator, const.EV_ERROR)
            self.assertEqual(reply["data"]["code"], const.ERR_INVALID_COMMAND)
            await communicator.disconnect()

        async_to_sync(run)()

    def test_the_question_reaches_the_player_without_the_answer_key(self):
        services.join_session(session=self.session, user=self.student)
        # Open the question through the services layer, then let the player connect: the
        # snapshot they receive is exactly what a phone joining late would get.
        session = services.start_game(session=self.session)
        services.open_question(session=session, index=0)

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            state = await communicator.receive_json_from()

            self.assertEqual(state["data"]["status"], const.STATUS_QUESTION_ACTIVE)
            question = state["data"]["question"]
            self.assertNotIn("correct_answer", question)
            self.assertNotIn("explanation", question)
            self.assertIn("ends_at", state["data"])
            await communicator.disconnect()

        async_to_sync(run)()

    def test_an_answer_is_marked_and_scored_over_the_socket(self):
        participant = services.join_session(session=self.session, user=self.student)
        session = services.start_game(session=self.session)
        session, question = services.open_question(session=session, index=0)

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            await communicator.receive_json_from()  # session_state

            await communicator.send_json_to(
                {
                    "type": const.CMD_SUBMIT_ANSWER,
                    "question_id": question.id,
                    "answer": question.correct_answer,
                }
            )

            reply = await await_frame(communicator, const.EV_ANSWER_RESULT)
            self.assertTrue(reply["data"]["is_correct"])
            self.assertGreater(reply["data"]["points_awarded"], 0)

            await communicator.disconnect()

        async_to_sync(run)()

        participant.refresh_from_db()
        self.assertEqual(participant.correct_count, 1)
        self.assertGreater(participant.score, 0)

    def test_a_late_answer_is_refused_over_the_socket(self):
        services.join_session(session=self.session, user=self.student)
        session = services.start_game(session=self.session)
        session, question = services.open_question(session=session, index=0)

        # Wind the deadline into the past, well outside the grace window.
        LiveQuizSession.objects.filter(pk=session.pk).update(
            question_ends_at=timezone.now() - timedelta(seconds=5)
        )

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to(
                {
                    "type": const.CMD_SUBMIT_ANSWER,
                    "question_id": question.id,
                    "answer": question.correct_answer,
                }
            )
            reply = await await_frame(communicator, const.EV_ERROR)

            self.assertEqual(reply["data"]["code"], const.ERR_TOO_LATE)
            await communicator.disconnect()

        async_to_sync(run)()

    @override_settings(LIVE_QUIZ_ENABLED=False)
    def test_nothing_connects_while_the_feature_is_off(self):
        services.join_session(session=self.session, user=self.student)

        async def run():
            communicator = self._communicator(self.student)
            connected, _ = await communicator.connect()
            self.assertFalse(connected)

        async_to_sync(run)()

    def test_a_host_ending_a_game_that_never_started_stops_the_room(self):
        """The class did not turn up, or the wrong room was opened.

        Pressing End in the lobby has to close the room — and release its code — rather
        than reporting a fault and leaving it open.
        """

        async def run():
            communicator = self._communicator(self.teacher)
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await communicator.receive_json_from()  # session_state

            await communicator.send_json_to({"type": const.CMD_END_GAME})
            await communicator.receive_json_from()
            await communicator.disconnect()

        async_to_sync(run)()

        self.session.refresh_from_db()
        self.assertIn(self.session.status, const.TERMINAL_STATUSES)
        # The code is free again: nothing live is holding it.
        self.assertIsNone(services.find_session_by_code(self.session.join_code))

    def test_an_illegal_move_reads_as_a_bad_state_not_a_crash(self):
        """A host pausing a game that has not begun is a mistake, not a server fault."""

        async def run():
            communicator = self._communicator(self.teacher)
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to({"type": const.CMD_PAUSE_GAME})
            reply = await await_frame(communicator, const.EV_ERROR)

            self.assertEqual(reply["data"]["code"], const.ERR_BAD_STATE)
            self.assertNotEqual(reply["data"]["code"], "server_error")
            await communicator.disconnect()

        async_to_sync(run)()

    def test_the_host_can_remove_a_player_and_they_cannot_come_back(self):
        """Somebody read the code off the board from the corridor."""
        participant = services.join_session(session=self.session, user=self.student)

        async def run():
            host = self._communicator(self.teacher)
            await host.connect()
            await host.receive_json_from()

            player = self._communicator(self.student)
            await player.connect()
            await player.receive_json_from()

            await host.send_json_to(
                {"type": const.CMD_REMOVE_PARTICIPANT, "participant_id": participant.id}
            )
            told = await await_frame(player, const.EV_REMOVED)
            self.assertEqual(told["data"]["participant_id"], participant.id)

            await host.disconnect()

        async_to_sync(run)()

        participant.refresh_from_db()
        self.assertEqual(participant.status, const.PARTICIPANT_KICKED)

        # The code no longer lets them back in.
        with self.assertRaises(Exception):
            services.join_session(session=self.session, user=self.student)

        # And they are off the board.
        self.assertNotIn(
            participant.id, [p.id for p in services.participants_of(self.session)]
        )

    def test_a_student_cannot_remove_anybody(self):
        participant = services.join_session(session=self.session, user=self.student)

        async def run():
            communicator = self._communicator(self.student)
            await communicator.connect()
            await communicator.receive_json_from()

            await communicator.send_json_to(
                {"type": const.CMD_REMOVE_PARTICIPANT, "participant_id": participant.id}
            )
            reply = await await_frame(communicator, const.EV_ERROR)
            self.assertEqual(reply["data"]["code"], const.ERR_NOT_HOST)
            await communicator.disconnect()

        async_to_sync(run)()

        participant.refresh_from_db()
        self.assertEqual(participant.status, const.PARTICIPANT_JOINED)
