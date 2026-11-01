"""Gems: what a game pays, the daily cap, the avatar shop, and avatars on the wire."""

from __future__ import annotations

from unittest import TestCase as PlainTestCase
from unittest import mock

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import ClassroomMembership
from core.errors.api import AppError

from . import avatars, events, gems, paced, services
from . import constants as const
from .models import AvatarLook, GemTransaction
from .routing import websocket_urlpatterns
from .tests_consumer import IN_MEMORY_LAYER, WebsocketClient, await_frame
from .tests_paced import PacedBase


class EarningRulesTests(PlainTestCase):
    def test_right_answers_the_finish_and_first_place(self):
        self.assertEqual(
            gems.earnings_for(correct=3, played_to_end=True, rank=1, player_count=5),
            {"correct": 30, "finish": 10, "podium": 50, "total": 90},
        )

    def test_no_podium_with_fewer_than_three_players(self):
        self.assertEqual(
            gems.earnings_for(correct=2, played_to_end=True, rank=1, player_count=2)["podium"], 0
        )

    def test_a_shared_second_place_pays_both_and_fourth_pays_nothing(self):
        self.assertEqual(gems.earnings_for(correct=0, played_to_end=False, rank=2, player_count=4)["podium"], 30)
        self.assertEqual(gems.earnings_for(correct=0, played_to_end=False, rank=4, player_count=4)["podium"], 0)

    def test_leaving_early_loses_only_the_finish_bonus(self):
        self.assertEqual(
            gems.earnings_for(correct=4, played_to_end=False, rank=None, player_count=1),
            {"correct": 40, "finish": 0, "podium": 0, "total": 40},
        )


class CatalogTests(PlainTestCase):
    def test_twelve_characters_three_of_them_free_starters(self):
        self.assertEqual(len(avatars.CHARACTERS), 12)
        starters = [k for k, c in avatars.CHARACTERS.items() if c["starter"]]
        self.assertEqual(len(starters), 3)
        self.assertTrue(all(avatars.CHARACTERS[k]["tier"] == avatars.COMMON for k in starters))

    def test_keys_round_trip_and_prices_follow_the_tier(self):
        self.assertEqual(avatars.parse(avatars.character_key("owl")), ("character", "owl", None))
        self.assertEqual(avatars.parse(avatars.skin_key("owl", "epic")), ("skin", "owl", "epic"))
        self.assertEqual(avatars.price_of("char:dragon"), 500)
        self.assertEqual(avatars.price_of("skin:owl:legendary"), 600)

    def test_nonsense_is_not_an_item(self):
        for key in ("", "char:", "char:nope", "skin:owl", "skin:owl:mythic", "hat:owl"):
            self.assertIsNone(avatars.parse(key), key)
            self.assertIsNone(avatars.price_of(key), key)


class GemsBase(PacedBase):
    def setUp(self):
        super().setUp()
        self.others = []
        for n in range(2):
            user = get_user_model().objects.create_user(
                email=f"classmate{n}@example.test", password="pw-for-tests", role="student"
            )
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
            )
            self.others.append(user)

    def _answer_all(self, session, participant, *, right=True):
        participant.refresh_from_db()
        while participant.finished_at is None:
            self._answer(session, participant, right=right)
            participant.refresh_from_db()

    @staticmethod
    def _end(session):
        session.refresh_from_db()
        return services.end_game(session=session)

    @staticmethod
    def _balance(user):
        return gems.balance(user)


class AwardTests(GemsBase):
    def test_a_finished_game_pays_right_answers_and_the_finish(self):
        session, participant = self._in_play()
        total = paced.total_for(participant)
        self._answer_all(session, participant)
        self._end(session)
        self.assertEqual(self._balance(self.student), total * 10 + 10)

    def test_a_game_pays_once(self):
        session, participant = self._in_play()
        self._answer(session, participant)
        session = self._end(session)
        before = self._balance(self.student)
        gems.award_for_game(session)
        self.assertEqual(self._balance(self.student), before)
        self.assertEqual(GemTransaction.objects.filter(kind=GemTransaction.KIND_EARN).count(), 1)

    def test_a_game_stopped_in_the_lobby_pays_nothing(self):
        session = self._paced()
        services.join_session(session=session, user=self.student)
        self._end(session)
        self.assertEqual(GemTransaction.objects.count(), 0)

    def test_a_removed_player_earns_nothing(self):
        session, participant = self._in_play()
        self._answer(session, participant)
        services.remove_participant(session=session, participant_id=participant.pk)
        self._end(session)
        self.assertEqual(self._balance(self.student), 0)

    def test_the_daily_cap_cuts_the_award_and_says_so(self):
        gems.grant(self.student, 280, kind=GemTransaction.KIND_EARN, note="earlier games today")
        session, participant = self._in_play()
        self._answer_all(session, participant)
        session = self._end(session)
        self.assertEqual(self._balance(self.student), 300)
        row = GemTransaction.objects.get(session=session)
        self.assertEqual(row.amount, 20)
        self.assertTrue(row.detail["capped"])

    def test_yesterday_does_not_count_against_today(self):
        gems.grant(self.student, 300, kind=GemTransaction.KIND_EARN, note="yesterday")
        GemTransaction.objects.update(day=timezone.localdate() - timezone.timedelta(days=1))
        session, participant = self._in_play()
        self._answer(session, participant)
        self._end(session)
        self.assertEqual(self._balance(self.student), 310)

    def test_the_podium_pays_when_three_played(self):
        session = self._paced()
        players = [services.join_session(session=session, user=u) for u in [self.student, *self.others]]
        session = services.start_game(session=session)
        session, _ = paced.begin_play(session=session)
        for player, right in zip(players, (3, 2, 1)):
            for _ in range(right):
                self._answer(session, player)
        self._end(session)
        first = GemTransaction.objects.get(wallet__user=self.student)
        self.assertEqual(first.detail["podium"], 50)
        self.assertEqual(first.amount, 30 + 50)

    def test_a_game_that_paid_nothing_under_the_cap_still_counts_as_paid(self):
        # Review finding: with no row written for a zero share, asking again on a later day —
        # under a fresh cap — paid the same game.
        gems.grant(self.student, 300, kind=GemTransaction.KIND_EARN, note="earlier games today")
        session, participant = self._in_play()
        self._answer(session, participant)
        session = self._end(session)
        row = GemTransaction.objects.get(session=session)
        self.assertEqual((row.amount, row.detail["capped"]), (0, True))

        GemTransaction.objects.update(day=timezone.localdate() - timezone.timedelta(days=1))
        gems.award_for_game(session)
        self.assertEqual(self._balance(self.student), 300)
        self.assertEqual(GemTransaction.objects.filter(session=session).count(), 1)

    def test_teacher_paced_present_at_the_end_gets_the_finish_bonus(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)
        services.submit_answer(
            session=session, participant=participant, question_id=question.id, answer=question.correct_answer
        )
        self._end(session)
        self.assertEqual(self._balance(self.student), 10 + 10)


class ShopTests(GemsBase):
    def test_buying_takes_the_price_and_writes_the_ledger(self):
        gems.grant(self.student, 400)
        gems.buy(self.student, "char:fox")
        self.assertEqual(self._balance(self.student), 300)
        spend = GemTransaction.objects.get(kind=GemTransaction.KIND_SPEND)
        self.assertEqual((spend.amount, spend.balance_after, spend.item_key), (-100, 300, "char:fox"))

    def test_not_enough_gems_changes_nothing(self):
        gems.grant(self.student, 50)
        with self.assertRaises(AppError) as caught:
            gems.buy(self.student, "char:fox")
        self.assertEqual(caught.exception.code, "not_enough_gems")
        self.assertEqual(self._balance(self.student), 50)

    def test_nothing_is_bought_twice(self):
        gems.grant(self.student, 400)
        gems.buy(self.student, "char:fox")
        with self.assertRaises(AppError) as caught:
            gems.buy(self.student, "char:fox")
        self.assertEqual(caught.exception.code, "already_owned")

    def test_a_skin_needs_its_character_first(self):
        gems.grant(self.student, 400)
        with self.assertRaises(AppError) as caught:
            gems.buy(self.student, "skin:fox:rare")
        self.assertEqual(caught.exception.code, "needs_character")

    def test_one_free_starter_and_only_a_starter(self):
        with self.assertRaises(AppError) as caught:
            gems.claim_starter(self.student, "dragon")
        self.assertEqual(caught.exception.code, "not_a_starter")
        gems.claim_starter(self.student, "owl")
        with self.assertRaises(AppError) as caught:
            gems.claim_starter(self.student, "cat")
        self.assertEqual(caught.exception.code, "starter_used")
        self.assertEqual(self._balance(self.student), 0)

    def test_the_first_character_is_worn_at_once(self):
        gems.claim_starter(self.student, "owl")
        look = AvatarLook.objects.get(user=self.student)
        self.assertEqual((look.character, look.skin), ("owl", ""))

    def test_only_what_you_own_can_be_worn(self):
        gems.claim_starter(self.student, "owl")
        with self.assertRaises(AppError) as caught:
            gems.equip(self.student, "owl", "legendary")
        self.assertEqual(caught.exception.code, "not_owned")
        gems.grant(self.student, 600)
        gems.buy(self.student, "skin:owl:legendary")
        gems.equip(self.student, "owl", "legendary")
        self.assertEqual(AvatarLook.objects.get(user=self.student).skin, "legendary")

    def test_unknown_items_are_not_found(self):
        with self.assertRaises(AppError) as caught:
            gems.buy(self.student, "char:nope")
        self.assertEqual(caught.exception.code, "no_such_item")

    def test_the_shop_endpoint(self):
        gems.grant(self.student, 120)
        api = APIClient()
        api.force_authenticate(user=self.student)
        state = api.get("/api/livequiz/shop/").json()
        self.assertEqual(state["balance"], 120)
        self.assertEqual(state["daily_cap"], 300)
        self.assertTrue(state["can_claim_starter"])
        self.assertEqual(len([i for i in state["items"] if i["kind"] == "character"]), 12)
        self.assertEqual(len([i for i in state["items"] if i["kind"] == "skin"]), 36)

        reply = api.post("/api/livequiz/shop/claim/", {"character": "cat"}, format="json")
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()["look"], {"character": "cat", "skin": None})
        reply = api.post("/api/livequiz/shop/buy/", {"item": "char:fox"}, format="json")
        self.assertEqual(reply.json()["balance"], 20)
        reply = api.post("/api/livequiz/shop/buy/", {"item": "char:dragon"}, format="json")
        self.assertEqual(reply.status_code, 409)
        reply = api.post("/api/livequiz/shop/equip/", {"character": "fox"}, format="json")
        self.assertEqual(reply.json()["look"]["character"], "fox")


class WireTests(GemsBase):
    def test_a_player_row_carries_their_look(self):
        session = self._paced()
        participant = services.join_session(session=session, user=self.student)
        self.assertIsNone(events.participant_row(participant)["avatar"])
        gems.claim_starter(self.student, "robot")
        row = events.participant_row(services.participants_of(session)[0])
        self.assertEqual(row["avatar"], {"character": "robot", "skin": None})

    def test_the_report_says_what_each_earned(self):
        session, participant = self._in_play()
        self._answer(session, participant)
        session = self._end(session)
        rows = services.results_report(session)["participants"]
        self.assertEqual(rows[0]["gems"], 10)


@override_settings(LIVE_QUIZ_ENABLED=True, CHANNEL_LAYERS=IN_MEMORY_LAYER)
class GemsSocketTests(TransactionTestCase):
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
        return WebsocketClient(URLRouter(websocket_urlpatterns), f"/ws/livequiz/{self.session.pk}/", user)

    def test_each_student_hears_what_they_earned(self):
        async def run():
            host, player = self._client(self.teacher), self._client(self.student)
            await host.connect()
            await host.receive_json_from()
            await player.connect()
            await player.receive_json_from()
            with mock.patch.object(const, "COUNTDOWN_SECONDS", 0):
                await host.send_json_to({"type": const.CMD_START_GAME})
                first = await await_frame(player, const.EV_QUESTION_STARTED)
            key = await self._key(first["data"]["question"]["id"])
            await player.send_json_to(
                {"type": const.CMD_SUBMIT_ANSWER, "question_id": first["data"]["question"]["id"], "answer": key}
            )
            await await_frame(player, const.EV_ANSWER_RESULT)
            await host.send_json_to({"type": const.CMD_END_GAME})
            earned = await await_frame(player, const.EV_GEMS_AWARDED, limit=20)
            self.assertEqual(earned["data"]["earned"], 10)
            self.assertEqual(earned["data"]["balance"], 10)
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
