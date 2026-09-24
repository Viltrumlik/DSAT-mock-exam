"""The rules and the arithmetic, without a database."""

from __future__ import annotations

from django.test import SimpleTestCase

from . import constants as const
from . import question_builder, scoring, state_machine


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


class _Word:
    """A stand-in for VocabWord: the builder only ever reads these four attributes."""

    def __init__(self, pk, word, definition, example=""):
        self.pk, self.word, self.definition, self.example = pk, word, definition, example


def _pool(n=6):
    return [_Word(i, f"word{i}", f"definition {i}") for i in range(1, n + 1)]


class DistractorTests(SimpleTestCase):
    def test_the_answer_is_never_offered_against_itself(self):
        pool = _pool()
        picked = question_builder.pick_distractors(pool, pool[0], 3)
        self.assertNotIn(pool[0].pk, [w.pk for w in picked])

    def test_a_word_spelled_the_same_is_not_a_distractor(self):
        # The same headword taught in two sections. Offering both is offering the answer twice.
        pool = _pool() + [_Word(99, "WORD1", "a different meaning entirely")]
        picked = question_builder.pick_distractors(pool, pool[0], 5)
        self.assertNotIn(99, [w.pk for w in picked])

    def test_a_word_MEANING_the_same_is_not_a_distractor(self):
        # The one that matters: a synonym is a second correct answer, so a student who picks
        # it is marked wrong for being right.
        pool = _pool() + [_Word(98, "synonym", "definition 1")]
        picked = question_builder.pick_distractors(pool, pool[0], 5)
        self.assertNotIn(98, [w.pk for w in picked])

    def test_matching_is_insensitive_to_case_and_spacing(self):
        pool = _pool() + [_Word(97, "elsewhere", "  DEFINITION   1 ")]
        picked = question_builder.pick_distractors(pool, pool[0], 5)
        self.assertNotIn(97, [w.pk for w in picked])

    def test_it_returns_what_it_can_when_the_pool_is_thin(self):
        pool = _pool(2)
        self.assertEqual(len(question_builder.pick_distractors(pool, pool[0], 3)), 1)


class QuestionBuildingTests(SimpleTestCase):
    def test_a_question_has_four_distinct_options_and_one_key(self):
        pool = _pool()
        built = question_builder.build_question(word=pool[0], pool=pool)
        ids = [c["id"] for c in built["choices"]]
        texts = [c["text"] for c in built["choices"]]

        self.assertEqual(ids, list(question_builder.OPTION_IDS))
        self.assertEqual(len(set(texts)), 4)
        self.assertIn(built["correct_answer"], ids)

    def test_the_definition_form_asks_for_the_word(self):
        pool = _pool()
        built = question_builder.build_question(
            word=pool[0], pool=pool, form=question_builder.FORM_DEFINITION_TO_WORD
        )
        self.assertEqual(built["prompt"], "definition 1")
        self.assertEqual(built["question_prompt"], question_builder.ASK_FOR_WORD)
        answer = next(c for c in built["choices"] if c["id"] == built["correct_answer"])
        self.assertEqual(answer["text"], "word1")

    def test_the_word_form_asks_for_the_definition(self):
        pool = _pool()
        built = question_builder.build_question(
            word=pool[0], pool=pool, form=question_builder.FORM_WORD_TO_DEFINITION
        )
        self.assertEqual(built["prompt"], "word1")
        self.assertEqual(built["question_prompt"], question_builder.ASK_FOR_DEFINITION)
        answer = next(c for c in built["choices"] if c["id"] == built["correct_answer"])
        self.assertEqual(answer["text"], "definition 1")

    def test_the_key_does_not_always_land_on_A(self):
        pool = _pool(12)
        keys = {
            question_builder.build_question(word=pool[0], pool=pool)["correct_answer"]
            for _ in range(40)
        }
        self.assertGreater(len(keys), 1, "the answer is always in the same place")

    def test_too_few_usable_words_builds_nothing(self):
        # Three words, all meaning the same thing: there is no honest question here.
        pool = [_Word(1, "a", "same"), _Word(2, "b", "same"), _Word(3, "c", "same")]
        self.assertIsNone(question_builder.build_question(word=pool[0], pool=pool))

    def test_the_example_sentence_becomes_the_explanation(self):
        pool = _pool()
        pool[0].example = "The storm began to abate."
        built = question_builder.build_question(word=pool[0], pool=pool)
        self.assertEqual(built["explanation"], "The storm began to abate.")
