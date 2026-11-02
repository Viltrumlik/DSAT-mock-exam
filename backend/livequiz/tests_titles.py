"""Titles come from how a student plays; limited items sell only in their season."""

from __future__ import annotations

from datetime import date
from unittest import mock

from rest_framework.test import APIClient

from assessments.models import AssessmentSet
from core.errors.api import AppError

from . import avatars, gems, services, titles
from . import constants as const
from .models import AvatarLook, GemTransaction, LiveQuizAnswer, LiveQuizParticipant
from .tests_gems import GemsBase


class TitlesBase(GemsBase):
    def _played(self, user=None, *, finished=True, **fields):
        """A game this student played, its result written straight in."""
        session = self._paced()
        participant = services.join_session(session=session, user=user or self.student)
        LiveQuizParticipant.objects.filter(pk=participant.pk).update(**fields)
        if finished:
            type(session).objects.filter(pk=session.pk).update(status=const.STATUS_FINISHED)
        session.refresh_from_db()
        participant.refresh_from_db()
        return session, participant

    def _answered(self, session, participant, index=0, *, right=True, ms=1000, second_try=None):
        return LiveQuizAnswer.objects.create(
            session=session,
            participant=participant,
            question=list(session.questions.order_by("order"))[index],
            answer="x",
            is_correct=right,
            response_time_ms=ms,
            second_try_correct=second_try,
        )

    def _progress(self, key, user=None):
        return titles.progress_of(user or self.student)[key]


class RuleTests(TitlesBase):
    def test_a_new_student_has_earned_nothing(self):
        self.assertEqual(titles.earned(self.student), set())
        self.assertEqual({row["progress"] for row in titles.state_of(self.student)}, {0})

    def test_streak_master_is_ten_in_a_row_in_one_game(self):
        self._played(best_streak=9)
        self.assertNotIn("streak_master", titles.earned(self.student))
        self._played(best_streak=10)
        self.assertIn("streak_master", titles.earned(self.student))

    def test_a_game_still_running_earns_nothing_yet(self):
        self._played(finished=False, best_streak=10)
        self.assertEqual(self._progress("streak_master"), 0)

    def test_a_student_removed_from_the_game_earns_nothing_from_it(self):
        self._played(best_streak=10, status=const.PARTICIPANT_KICKED)
        self.assertEqual(self._progress("streak_master"), 0)

    def test_lightning_counts_only_fast_right_first_answers(self):
        session, participant = self._played()
        self._answered(session, participant, 0, ms=4999)
        self._answered(session, participant, 1, ms=5000)
        self._answered(session, participant, 2, ms=1000, right=False)
        # Right on the second try: `is_correct` is on, and the time is the first try's.
        self._answered(session, participant, 3, ms=1000, second_try=True)
        self.assertEqual(self._progress("lightning"), 1)

    def test_word_wise_counts_right_answers_on_words_only(self):
        session, participant = self._played()
        self._answered(session, participant, 0)
        self._answered(session, participant, 1, right=False)
        self.assertEqual(self._progress("word_wise"), 1)

        sat = AssessmentSet.objects.create(
            title="Algebra", subject=AssessmentSet.SUBJECT_MATH, created_by=self.teacher, is_active=True
        )
        type(session).objects.filter(pk=session.pk).update(vocab_set=None, assessment_set=sat)
        self.assertEqual(self._progress("word_wise"), 0)

    def test_perfect_game_is_every_answer_right_on_a_long_enough_paper(self):
        total = self._paced().questions.count()
        with mock.patch.object(titles, "PERFECT_MIN_QUESTIONS", total):
            self._played(correct_count=total - 1)
            self.assertEqual(self._progress("perfect_game"), 0)
            self._played(correct_count=total)
            self.assertEqual(self._progress("perfect_game"), 1)

    def test_a_paper_shorter_than_the_minimum_is_never_perfect(self):
        total = self._paced().questions.count()
        with mock.patch.object(titles, "PERFECT_MIN_QUESTIONS", total + 1):
            self._played(correct_count=total)
            self.assertEqual(self._progress("perfect_game"), 0)

    def test_a_second_chance_is_not_a_perfect_game(self):
        total = self._paced().questions.count()
        with mock.patch.object(titles, "PERFECT_MIN_QUESTIONS", total):
            played, participant = self._played(correct_count=total)
            self._answered(played, participant, 0, second_try=True)
            self.assertEqual(self._progress("perfect_game"), 0)

    def _team_game(self, mine, *others):
        """`mine` = (team, score) for the student; `others` the same for each classmate."""
        session, _participant = self._played(finished=False, team=mine[0], score=mine[1])
        for user, (team, score) in zip(self.others, others):
            other = services.join_session(session=session, user=user)
            LiveQuizParticipant.objects.filter(pk=other.pk).update(team=team, score=score)
        config = {**session.config, "teams": 2}
        type(session).objects.filter(pk=session.pk).update(config=config, status=const.STATUS_FINISHED)
        return session

    def test_team_captain_is_the_top_scorer_on_the_winning_team(self):
        self._team_game((0, 900), (0, 100), (1, 800))
        self.assertEqual(self._progress("team_captain"), 1)

    def test_not_captain_when_a_teammate_scored_more(self):
        self._team_game((0, 400), (0, 900), (1, 800))
        self.assertEqual(self._progress("team_captain"), 0)

    def test_not_captain_of_the_team_that_lost(self):
        self._team_game((0, 700), (1, 800), (1, 800))
        self.assertEqual(self._progress("team_captain"), 0)

    def test_progress_stops_at_the_goal_and_the_title_is_earned(self):
        self._played(best_streak=14)
        row = next(r for r in titles.state_of(self.student) if r["key"] == "streak_master")
        self.assertEqual((row["progress"], row["goal"], row["earned"]), (10, 10, True))


class WearingTests(TitlesBase):
    def setUp(self):
        super().setUp()
        gems.claim_starter(self.student, "owl")

    def test_only_an_earned_title_can_be_worn(self):
        with self.assertRaises(AppError) as caught:
            gems.equip(self.student, "owl", None, title="streak_master")
        self.assertEqual(caught.exception.code, "not_earned")
        self.assertEqual(AvatarLook.objects.get(user=self.student).title, "")

    def test_a_title_that_does_not_exist_is_not_earned(self):
        with self.assertRaises(AppError):
            gems.equip(self.student, "owl", None, title="emperor")

    def test_a_title_cannot_be_bought(self):
        gems.grant(self.student, 5000)
        with self.assertRaises(AppError) as caught:
            gems.buy(self.student, "title:streak_master")
        self.assertEqual(caught.exception.code, "no_such_item")

    def test_an_earned_title_goes_out_on_the_wire_and_comes_off(self):
        self._played(best_streak=10)
        api = APIClient()
        api.force_authenticate(user=self.student)
        reply = api.post("/api/livequiz/shop/equip/", {"character": "owl", "title": "streak_master"}, format="json")
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.json()["look"]["title"], "streak_master")
        rows = {row["key"]: row for row in reply.json()["titles"]}
        self.assertTrue(rows["streak_master"]["earned"])
        self.assertFalse(rows["lightning"]["earned"])

        # A locker save names no title, so it leaves the title on.
        reply = api.post("/api/livequiz/shop/equip/", {"character": "owl", "hat": None}, format="json")
        self.assertEqual(reply.json()["look"]["title"], "streak_master")

        reply = api.post("/api/livequiz/shop/equip/", {"character": "owl", "title": None}, format="json")
        self.assertNotIn("title", reply.json()["look"])


class SeasonTests(TitlesBase):
    WINTER = "hat:winter_beanie"
    SPRING = "hat:navroz_tulips"

    def test_on_sale_inside_its_months_with_the_days_it_has_left(self):
        season = avatars.season_of(self.WINTER, date(2026, 12, 7))
        self.assertEqual((season["on_sale"], season["back_in"]), (True, None))
        # What is left of December, counting today, then January and February.
        self.assertEqual(season["days_left"], 25 + 31 + 28)

    def test_the_last_day_still_counts(self):
        self.assertEqual(avatars.season_of(self.SPRING, date(2027, 3, 31))["days_left"], 1)

    def test_a_season_crosses_the_new_year(self):
        self.assertTrue(avatars.season_of(self.WINTER, date(2027, 1, 15))["on_sale"])
        self.assertEqual(avatars.season_of(self.WINTER, date(2028, 2, 29))["days_left"], 1)

    def test_out_of_season_says_when_it_comes_back(self):
        season = avatars.season_of(self.WINTER, date(2026, 7, 1))
        self.assertEqual((season["on_sale"], season["days_left"], season["back_in"]), (False, None, "December"))
        self.assertEqual(avatars.season_of(self.SPRING, date(2026, 11, 2))["back_in"], "March")
        self.assertEqual(avatars.season_of(self.SPRING, date(2027, 4, 1))["back_in"], "March")

    def test_an_ordinary_item_has_no_season(self):
        self.assertIsNone(avatars.season_of("hat:crown", date(2026, 7, 1)))

    def test_out_of_season_it_cannot_be_bought_and_nothing_is_taken(self):
        gems.grant(self.student, 500)
        with mock.patch("livequiz.gems.timezone.localdate", return_value=date(2026, 7, 1)):
            with self.assertRaises(AppError) as caught:
                gems.buy(self.student, self.WINTER)
        self.assertEqual(caught.exception.code, "not_on_sale")
        self.assertEqual(gems.balance(self.student), 500)
        self.assertFalse(GemTransaction.objects.filter(kind=GemTransaction.KIND_SPEND).exists())

    def test_in_season_it_sells_at_the_price_drawn_and_stays_wearable_after(self):
        gems.claim_starter(self.student, "owl")
        gems.grant(self.student, 500)
        with mock.patch("livequiz.gems.timezone.localdate", return_value=date(2026, 12, 7)):
            gems.buy(self.student, self.WINTER)
        self.assertEqual(gems.balance(self.student), 250)
        with mock.patch("livequiz.gems.timezone.localdate", return_value=date(2026, 7, 1)):
            gems.equip(self.student, "owl", None, hat="winter_beanie")
        self.assertEqual(AvatarLook.objects.get(user=self.student).hat, "winter_beanie")

    def test_the_shop_says_which_are_on_sale_today(self):
        with mock.patch("livequiz.gems.timezone.localdate", return_value=date(2026, 12, 7)):
            items = {row["key"]: row for row in gems.shop_state(self.student)["items"]}
        self.assertEqual((items[self.WINTER]["limited"], items[self.WINTER]["on_sale"]), (True, True))
        self.assertEqual(items[self.WINTER]["tier"], "limited")
        self.assertEqual((items[self.SPRING]["on_sale"], items[self.SPRING]["back_in"]), (False, "March"))
        self.assertNotIn("limited", items["hat:crown"])
