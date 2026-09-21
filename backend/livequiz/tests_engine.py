"""The rules and the arithmetic, without a database."""

from __future__ import annotations

from django.test import SimpleTestCase

from . import constants as const
from . import scoring, state_machine


class TransitionTableTests(SimpleTestCase):
    def test_the_ordinary_run_of_a_game_is_legal(self):
        path = [
            (const.STATUS_LOBBY, const.STATUS_STARTING),
            (const.STATUS_STARTING, const.STATUS_QUESTION_ACTIVE),
            (const.STATUS_QUESTION_ACTIVE, const.STATUS_QUESTION_RESULTS),
            (const.STATUS_QUESTION_RESULTS, const.STATUS_QUESTION_ACTIVE),
            (const.STATUS_QUESTION_RESULTS, const.STATUS_FINISHED),
        ]
        for frm, to in path:
            self.assertTrue(state_machine.can_transition(frm, to), f"{frm} -> {to}")

    def test_a_question_cannot_open_while_one_is_open(self):
        self.assertFalse(
            state_machine.can_transition(
                const.STATUS_QUESTION_ACTIVE, const.STATUS_QUESTION_ACTIVE
            )
        )

    def test_a_game_cannot_skip_the_lobby(self):
        self.assertFalse(
            state_machine.can_transition(const.STATUS_LOBBY, const.STATUS_QUESTION_ACTIVE)
        )

    def test_nothing_leaves_a_finished_game(self):
        for target in dict(const.STATUS_CHOICES):
            self.assertFalse(state_machine.can_transition(const.STATUS_FINISHED, target))

    def test_nothing_leaves_a_terminated_game(self):
        for target in dict(const.STATUS_CHOICES):
            self.assertFalse(state_machine.can_transition(const.STATUS_TERMINATED, target))

    def test_any_live_state_can_be_terminated(self):
        for status in const.LIVE_STATUSES:
            self.assertTrue(state_machine.can_transition(status, const.STATUS_TERMINATED), status)

    def test_assert_transition_raises_on_an_illegal_move(self):
        with self.assertRaises(state_machine.InvalidTransition):
            state_machine.assert_transition(const.STATUS_FINISHED, const.STATUS_QUESTION_ACTIVE)

    def test_only_an_open_question_accepts_answers(self):
        self.assertTrue(state_machine.accepts_answers(const.STATUS_QUESTION_ACTIVE))
        for status in (
            const.STATUS_LOBBY,
            const.STATUS_STARTING,
            const.STATUS_QUESTION_RESULTS,
            const.STATUS_PAUSED,
            const.STATUS_FINISHED,
            const.STATUS_TERMINATED,
        ):
            self.assertFalse(state_machine.accepts_answers(status), status)

    def test_a_terminated_session_cannot_be_rejoined(self):
        self.assertFalse(state_machine.accepts_joins(const.STATUS_TERMINATED))
        self.assertFalse(state_machine.accepts_joins(const.STATUS_FINISHED))
        self.assertTrue(state_machine.accepts_joins(const.STATUS_QUESTION_ACTIVE))


class ScoringTests(SimpleTestCase):
    def test_a_wrong_answer_scores_nothing_however_fast(self):
        self.assertEqual(
            scoring.points_for(
                question_points=3,
                is_correct=False,
                response_time_ms=0,
                limit_ms=20_000,
                speed_bonus_ratio=0.5,
            ),
            0,
        )

    def test_an_instant_answer_earns_the_whole_bonus(self):
        self.assertEqual(
            scoring.points_for(
                question_points=1,
                is_correct=True,
                response_time_ms=0,
                limit_ms=20_000,
                speed_bonus_ratio=0.5,
            ),
            150,
        )

    def test_an_answer_on_the_buzzer_earns_the_base_only(self):
        self.assertEqual(
            scoring.points_for(
                question_points=1,
                is_correct=True,
                response_time_ms=20_000,
                limit_ms=20_000,
                speed_bonus_ratio=0.5,
            ),
            100,
        )

    def test_a_late_answer_inside_the_grace_window_never_scores_below_the_base(self):
        # The remainder goes negative here; the clamp is what keeps it at the base.
        self.assertEqual(
            scoring.points_for(
                question_points=1,
                is_correct=True,
                response_time_ms=20_700,
                limit_ms=20_000,
                speed_bonus_ratio=0.5,
            ),
            100,
        )

    def test_a_zero_ratio_is_flat_marking(self):
        for elapsed in (0, 5_000, 20_000):
            self.assertEqual(
                scoring.points_for(
                    question_points=2,
                    is_correct=True,
                    response_time_ms=elapsed,
                    limit_ms=20_000,
                    speed_bonus_ratio=0.0,
                ),
                200,
            )

    def test_points_scale_with_the_weight_of_the_question(self):
        self.assertEqual(
            scoring.points_for(
                question_points=3,
                is_correct=True,
                response_time_ms=10_000,
                limit_ms=20_000,
                speed_bonus_ratio=0.5,
            ),
            375,  # 300 base + half the 150 bonus
        )


class RankingTests(SimpleTestCase):
    def test_places_run_from_the_highest_score(self):
        ranks = scoring.assign_ranks([(1, 10), (2, 30), (3, 20)])
        self.assertEqual(ranks, {2: 1, 3: 2, 1: 3})

    def test_a_tie_shares_a_place_and_the_next_one_is_skipped(self):
        ranks = scoring.assign_ranks([(1, 50), (2, 40), (3, 40), (4, 10)])
        self.assertEqual(ranks[1], 1)
        self.assertEqual(ranks[2], 2)
        self.assertEqual(ranks[3], 2)
        self.assertEqual(ranks[4], 4)

    def test_everybody_on_zero_shares_first(self):
        ranks = scoring.assign_ranks([(1, 0), (2, 0), (3, 0)])
        self.assertEqual(set(ranks.values()), {1})

    def test_an_empty_room_ranks_nobody(self):
        self.assertEqual(scoring.assign_ranks([]), {})
