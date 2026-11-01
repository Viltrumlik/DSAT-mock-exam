"""Student-paced play: own sequence, own clock, streaks and power-ups — and the socket."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.errors.api import AppError

from . import constants as const
from . import paced, powerups, scoring, services
from .models import LiveQuizAnswer, LiveQuizParticipant, LiveQuizSession
from .routing import websocket_urlpatterns
from .tests_consumer import IN_MEMORY_LAYER, WebsocketClient, await_frame
from .tests_services import LiveQuizBase


class PacedBase(LiveQuizBase):
    def _paced(self, **config):
        return services.create_session(
            host=self.teacher,
            classroom=self.classroom,
            vocab_set=self.vocab_set,
            config={"mode": const.MODE_STUDENT_PACED, **config},
        )

    def _in_play(self, **config):
        session = self._paced(**config)
        participant = services.join_session(session=session, user=self.student)
        session = services.start_game(session=session)
        session, _ = paced.begin_play(session=session)
        participant.refresh_from_db()
        return session, participant

    @staticmethod
    def _current(session, participant):
        participant.refresh_from_db()
        return paced.current_question(session, participant)

    def _answer(self, session, participant, *, right=True, now=None):
        question = self._current(session, participant)
        value = self._correct(question) if right else self._wrong(question)
        return paced.submit(
            session=session,
            participant=participant,
            question_id=question.id,
            answer=value,
            now=now or participant.question_started_at,
        )


class ConfigTests(PacedBase):
    def _session_default(self):
        return services.create_session(
            host=self.teacher, classroom=self.classroom, vocab_set=self.vocab_set
        )

    def test_a_new_room_is_student_paced_on_the_game_scale(self):
        session = self._session_default()
        self.assertEqual(session.setting("mode"), const.MODE_STUDENT_PACED)
        self.assertEqual(session.setting("point_scale"), 600)
        self.assertTrue(session.setting("powerups"))

    def test_a_room_from_before_modes_existed_stays_teacher_paced(self):
        # Its config has no "mode" key — exactly what every room created before the rebuild has.
        session = self._session_default()
        LiveQuizSession.objects.filter(pk=session.pk).update(config={"question_seconds": 20})
        session.refresh_from_db()
        self.assertEqual(session.setting("mode"), const.MODE_INSTRUCTOR_PACED)
        self.assertEqual(session.setting("point_scale"), 100)

    def test_no_timer_is_for_student_paced_rooms_only(self):
        self.assertEqual(self._paced(question_seconds=0).setting("question_seconds"), 0)
        with self.assertRaises(AppError):
            services.normalize_config({"mode": const.MODE_INSTRUCTOR_PACED, "question_seconds": 0})

    def test_power_ups_are_off_in_a_teacher_paced_room(self):
        config = services.normalize_config({"mode": const.MODE_INSTRUCTOR_PACED, "powerups": True})
        self.assertFalse(config["powerups"])

    def test_hiding_correctness_hides_the_answer_too(self):
        config = services.normalize_config({"reveal_correctness": False, "show_answers": True})
        self.assertFalse(config["show_answers"])


class SequenceTests(PacedBase):
    def test_joining_deals_the_whole_paper(self):
        session = self._paced()
        participant = services.join_session(session=session, user=self.student)
        orders = sorted(session.questions.values_list("order", flat=True))
        self.assertEqual(sorted(participant.question_order), orders)

    def test_unshuffled_rooms_keep_the_paper_order(self):
        session = self._paced(shuffle_questions=False)
        participant = services.join_session(session=session, user=self.student)
        self.assertEqual(participant.question_order, sorted(participant.question_order))

    def test_begin_play_opens_the_first_question_with_a_server_deadline(self):
        session, participant = self._in_play(question_seconds=30)
        self.assertEqual(session.status, const.STATUS_QUESTION_ACTIVE)
        self.assertIsNotNone(participant.question_started_at)
        self.assertEqual(
            participant.question_ends_at - participant.question_started_at, timedelta(seconds=30)
        )

    def test_the_host_cannot_open_a_room_wide_question(self):
        session = self._paced()
        services.join_session(session=session, user=self.student)
        session = services.start_game(session=session)
        with self.assertRaises(AppError) as caught:
            services.open_question(session=session, index=0)
        self.assertEqual(caught.exception.code, const.ERR_WRONG_MODE)


class AnsweringTests(PacedBase):
    def test_a_right_answer_scores_on_the_game_scale_and_moves_them_on(self):
        session, participant = self._in_play()
        move = self._answer(session, participant)

        self.assertTrue(move.answer.is_correct)
        # Instant: the full 600 + 400.
        self.assertEqual(move.breakdown["total"], 1000)
        self.assertEqual(move.participant.position, 1)
        self.assertEqual(move.participant.streak, 1)
        self.assertIsNotNone(move.next_question)

    def test_the_next_clock_starts_after_the_feedback_screen(self):
        session, participant = self._in_play()
        now = participant.question_started_at + timedelta(seconds=4)
        move = self._answer(session, participant, now=now)
        self.assertEqual(
            move.participant.question_started_at, now + timedelta(seconds=const.FEEDBACK_SECONDS)
        )

    def test_a_slower_right_answer_scores_less_but_never_below_the_base(self):
        session, participant = self._in_play(question_seconds=30)
        move = self._answer(
            session, participant, now=participant.question_started_at + timedelta(seconds=15)
        )
        self.assertEqual(move.breakdown["base"], 600)
        self.assertEqual(move.breakdown["total"], 800)

    def test_a_wrong_answer_scores_nothing_and_breaks_the_streak(self):
        session, participant = self._in_play()
        self._answer(session, participant)
        move = self._answer(session, participant, right=False)
        self.assertEqual(move.answer.points_awarded, 0)
        self.assertEqual(move.participant.streak, 0)
        self.assertEqual(move.participant.best_streak, 1)

    def test_an_answer_to_a_question_they_are_not_on_is_refused(self):
        session, participant = self._in_play()
        other = session.questions.exclude(pk=self._current(session, participant).pk).first()
        with self.assertRaises(AppError) as caught:
            paced.submit(session=session, participant=participant, question_id=other.id, answer="A")
        self.assertEqual(caught.exception.code, const.ERR_UNKNOWN_QUESTION)

    def test_an_answer_after_their_deadline_and_the_grace_is_refused(self):
        session, participant = self._in_play()
        question = self._current(session, participant)
        late = participant.question_ends_at + timedelta(milliseconds=const.LATE_ANSWER_GRACE_MS + 50)
        with self.assertRaises(AppError) as caught:
            paced.submit(
                session=session,
                participant=participant,
                question_id=question.id,
                answer=self._correct(question),
                now=late,
            )
        self.assertEqual(caught.exception.code, const.ERR_TOO_LATE)

    def test_the_last_answer_finishes_them(self):
        session, participant = self._in_play()
        for _ in range(paced.total_for(participant)):
            move = self._answer(session, participant)
        self.assertTrue(move.finished)
        self.assertIsNone(move.next_question)
        participant.refresh_from_db()
        self.assertIsNotNone(participant.finished_at)
        question = session.questions.first()
        with self.assertRaises(AppError):
            paced.submit(session=session, participant=participant, question_id=question.id, answer="A")

    def test_no_timer_means_no_deadline_and_a_flat_base(self):
        session, participant = self._in_play(question_seconds=0)
        self.assertIsNone(participant.question_ends_at)
        move = self._answer(
            session, participant, now=participant.question_started_at + timedelta(minutes=5)
        )
        self.assertEqual(move.breakdown["total"], 600)


class TimeOutTests(PacedBase):
    def test_running_out_writes_a_missed_question_and_moves_them_on(self):
        session, participant = self._in_play()
        after = participant.question_ends_at + timedelta(seconds=1)
        move = paced.time_out(session=session, participant_id=participant.pk, position=0, now=after)
        self.assertTrue(move.answer.timed_out)
        self.assertEqual(move.participant.position, 1)

    def test_only_one_of_two_racing_timers_moves_them(self):
        session, participant = self._in_play()
        after = participant.question_ends_at + timedelta(seconds=1)
        first = paced.time_out(session=session, participant_id=participant.pk, position=0, now=after)
        second = paced.time_out(session=session, participant_id=participant.pk, position=0, now=after)
        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(LiveQuizAnswer.objects.filter(participant=participant).count(), 1)

    def test_a_timer_that_wakes_early_does_nothing(self):
        session, participant = self._in_play()
        early = participant.question_ends_at - timedelta(seconds=1)
        self.assertIsNone(
            paced.time_out(session=session, participant_id=participant.pk, position=0, now=early)
        )

    def test_a_missed_question_is_not_an_answer_in_the_tally(self):
        session, participant = self._in_play()
        question = self._current(session, participant)
        paced.time_out(
            session=session,
            participant_id=participant.pk,
            position=0,
            now=participant.question_ends_at + timedelta(seconds=1),
        )
        self.assertEqual(services.question_tally(session=session, question=question)["answered"], 0)

    def test_coming_back_settles_one_missed_question_and_opens_the_next_from_now(self):
        session, participant = self._in_play()
        now = participant.question_ends_at + timedelta(minutes=10)
        participant = paced.catch_up(session=session, participant=participant, now=now)
        self.assertEqual(participant.position, 1)
        self.assertEqual(participant.question_started_at, now)
        self.assertEqual(LiveQuizAnswer.objects.filter(participant=participant).count(), 1)


class PauseTests(PacedBase):
    def test_a_pause_gives_every_student_their_time_back(self):
        session, participant = self._in_play()
        ends_before = participant.question_ends_at
        session = services.pause_game(session=session)
        LiveQuizSession.objects.filter(pk=session.pk).update(
            paused_at=timezone.now() - timedelta(seconds=40)
        )
        session.refresh_from_db()
        services.resume_game(session=session)
        participant.refresh_from_db()
        self.assertGreaterEqual((participant.question_ends_at - ends_before).total_seconds(), 39)


class PowerUpTests(PacedBase):
    def _holding(self, key, **config):
        session, participant = self._in_play(**config)
        LiveQuizParticipant.objects.filter(pk=participant.pk).update(powerups=[key])
        participant.refresh_from_db()
        return session, participant

    def test_three_right_in_a_row_earns_one(self):
        session, participant = self._in_play()
        moves = [self._answer(session, participant) for _ in range(powerups.AWARD_EVERY)]
        self.assertIsNone(moves[0].awarded)
        self.assertIn(moves[-1].awarded, powerups.ALL)
        participant.refresh_from_db()
        self.assertEqual(len(participant.powerups), 1)

    def test_nothing_is_earned_when_power_ups_are_off(self):
        session, participant = self._in_play(powerups=False)
        moves = [self._answer(session, participant) for _ in range(powerups.AWARD_EVERY)]
        self.assertIsNone(moves[-1].awarded)

    def test_fifty_fifty_takes_two_wrong_options_and_never_the_key(self):
        session, participant = self._holding(powerups.FIFTY_FIFTY)
        question = self._current(session, participant)
        applied = paced.use_powerup(session=session, participant=participant, key=powerups.FIFTY_FIFTY)
        self.assertEqual(len(applied["hidden_choices"]), 2)
        self.assertNotIn(question.correct_answer, applied["hidden_choices"])
        self.assertEqual(applied["inventory"], [])

    def test_eraser_takes_one(self):
        session, participant = self._holding(powerups.ERASER)
        applied = paced.use_powerup(session=session, participant=participant, key=powerups.ERASER)
        self.assertEqual(len(applied["hidden_choices"]), 1)

    def test_double_doubles_a_right_answer(self):
        session, participant = self._holding(powerups.DOUBLE)
        paced.use_powerup(session=session, participant=participant, key=powerups.DOUBLE)
        move = self._answer(session, participant)
        self.assertEqual(move.breakdown["multiplier"], 2)
        self.assertEqual(move.answer.points_awarded, 2000)
        self.assertEqual(move.used, [powerups.DOUBLE])

    def test_streak_saver_keeps_the_run_through_a_wrong_answer(self):
        session, participant = self._in_play()
        self._answer(session, participant)
        self._answer(session, participant)
        LiveQuizParticipant.objects.filter(pk=participant.pk).update(powerups=[powerups.STREAK_SAVER])
        participant.refresh_from_db()
        paced.use_powerup(session=session, participant=participant, key=powerups.STREAK_SAVER)
        move = self._answer(session, participant, right=False)
        self.assertEqual(move.participant.streak, 2)

    def test_time_freeze_stops_the_clock_and_keeps_the_bonus_where_it_was(self):
        session, participant = self._holding(powerups.TIME_FREEZE, question_seconds=30)
        started = participant.question_started_at
        paced.use_powerup(
            session=session,
            participant=participant,
            key=powerups.TIME_FREEZE,
            now=started + timedelta(seconds=15),
        )
        participant.refresh_from_db()
        self.assertIsNone(participant.question_ends_at)
        move = self._answer(session, participant, now=started + timedelta(minutes=3))
        self.assertEqual(move.breakdown["total"], 800)

    def test_a_power_up_you_do_not_hold_is_refused(self):
        session, participant = self._in_play()
        with self.assertRaises(AppError) as caught:
            paced.use_powerup(session=session, participant=participant, key=powerups.DOUBLE)
        self.assertEqual(caught.exception.code, const.ERR_NO_POWERUP)

    def test_options_to_hide_always_leaves_one_wrong_option(self):
        choices = [{"id": i, "text": i} for i in "ABCD"]
        hidden = powerups.options_to_hide(
            key=powerups.FIFTY_FIFTY, choices=choices, correct_answer="A", already_hidden=["B"]
        )
        self.assertEqual(len(hidden), 1)


class ScoringTests(LiveQuizBase):
    def test_the_parts_add_up_to_the_total(self):
        parts = scoring.score_answer(
            question_points=1,
            is_correct=True,
            response_time_ms=0,
            limit_ms=30_000,
            speed_bonus_ratio=round(400 / 600, 4),
            point_scale=600,
            double=True,
        )
        self.assertEqual((parts["base"] + parts["speed"]) * parts["multiplier"], parts["total"])
        self.assertEqual(parts["total"], 2000)


class TeacherPacedStreakTests(LiveQuizBase):
    def test_closing_a_question_settles_streaks(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)
        services.submit_answer(
            session=session,
            participant=participant,
            question_id=question.id,
            answer=question.correct_answer,
        )
        services.close_question(session=session)
        participant.refresh_from_db()
        self.assertEqual(participant.streak, 1)
        self.assertEqual(participant.best_streak, 1)


class ResultsTests(PacedBase):
    def _get_as_student(self, url):
        api = APIClient()
        api.force_authenticate(user=self.student)
        return api.get(url)

    def test_a_student_cannot_read_the_answer_sheet_mid_game(self):
        session, _ = self._in_play()
        reply = self._get_as_student(f"/api/livequiz/sessions/{session.pk}/results/")
        self.assertEqual(reply.status_code, 409)

    def test_a_student_reads_their_own_review_once_it_is_over(self):
        session, participant = self._in_play()
        self._answer(session, participant)
        services.end_game(session=LiveQuizSession.objects.get(pk=session.pk))
        reply = self._get_as_student(f"/api/livequiz/sessions/{session.pk}/results/")
        self.assertEqual(reply.status_code, 200)
        report = reply.json()["report"]
        self.assertEqual(len(report["participants"]), 1)
        self.assertEqual(report["participants"][0]["accuracy"], 100)
        self.assertIn("choices", report["questions"][0])


@override_settings(LIVE_QUIZ_ENABLED=True, CHANNEL_LAYERS=IN_MEMORY_LAYER)
class PacedSocketTests(TransactionTestCase):
    def setUp(self):
        base = PacedBase(methodName="setUp")
        base.setUp()
        self.teacher, self.student = base.teacher, base.student
        self.session = base._paced(question_seconds=30)
        services.join_session(session=self.session, user=self.student)

    def tearDown(self):
        layer = get_channel_layer()
        if layer is not None:
            async_to_sync(layer.flush)()

    def _client(self, user):
        return WebsocketClient(
            URLRouter(websocket_urlpatterns), f"/ws/livequiz/{self.session.pk}/", user
        )

    def test_start_answer_and_next_question_reach_only_that_student(self):
        async def run():
            host, player = self._client(self.teacher), self._client(self.student)
            await host.connect()
            await host.receive_json_from()
            await player.connect()
            await player.receive_json_from()

            with mock.patch.object(const, "COUNTDOWN_SECONDS", 0):
                await host.send_json_to({"type": const.CMD_START_GAME})
                first = await await_frame(player, const.EV_QUESTION_STARTED)
                # The host's screen must learn the round is in play — nothing room-wide says so.
                in_play = await await_frame(host, const.EV_SESSION_STATE)
                self.assertEqual(in_play["data"]["status"], const.STATUS_QUESTION_ACTIVE)
                self.assertIn("board", in_play["data"])

            question = first["data"]["question"]
            self.assertNotIn("correct_answer", question)
            self.assertGreater(first["data"]["ends_in_ms"], 0)
            self.assertEqual(question["index"], 0)

            key = await self._key(question["id"])
            await player.send_json_to(
                {"type": const.CMD_SUBMIT_ANSWER, "question_id": question["id"], "answer": key}
            )
            result = await await_frame(player, const.EV_ANSWER_RESULT)
            self.assertTrue(result["data"]["is_correct"])
            self.assertEqual(result["data"]["correct_answer"], key)
            self.assertEqual(result["data"]["rank"], 1)

            nxt = await await_frame(player, const.EV_QUESTION_STARTED)
            self.assertEqual(nxt["data"]["question"]["index"], 1)
            self.assertGreater(nxt["data"]["starts_in_ms"], 0)

            progress = await await_frame(host, const.EV_PLAYER_PROGRESS)
            self.assertTrue(progress["data"]["cell"]["correct"])

            await player.disconnect()
            await host.disconnect()

        async_to_sync(run)()

    def test_the_teacher_paced_controls_are_refused(self):
        async def run():
            host = self._client(self.teacher)
            await host.connect()
            await host.receive_json_from()
            await host.send_json_to({"type": const.CMD_END_QUESTION})
            reply = await await_frame(host, const.EV_ERROR)
            self.assertEqual(reply["data"]["code"], const.ERR_WRONG_MODE)
            await host.disconnect()

        async_to_sync(run)()

    def test_a_room_wide_frame_never_carries_the_board(self):
        session = services.start_game(session=self.session)
        paced.begin_play(session=session)

        async def run():
            host, player = self._client(self.teacher), self._client(self.student)
            await host.connect()
            state = await host.receive_json_from()
            self.assertIn("board", state["data"])
            await player.connect()
            await player.receive_json_from()

            await host.send_json_to({"type": const.CMD_PAUSE_GAME})
            paused = await await_frame(player, const.EV_GAME_PAUSED)
            self.assertNotIn("board", paused["data"])
            await player.disconnect()
            await host.disconnect()

        async_to_sync(run)()

    @staticmethod
    async def _key(question_id):
        from channels.db import database_sync_to_async

        from .models import LiveQuizQuestion

        @database_sync_to_async
        def read():
            return LiveQuizQuestion.objects.get(pk=question_id).correct_answer

        return await read()
