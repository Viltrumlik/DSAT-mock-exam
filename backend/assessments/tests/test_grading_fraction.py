"""Grading supports simple fractions (SAT grid-in style), e.g. correct "1/2" == "0.5"."""

from __future__ import annotations

from django.test import SimpleTestCase

from assessments.grading import grade_answer


class FractionGradingTests(SimpleTestCase):
    def _num(self, correct, answer, config=None):
        return grade_answer(question_type="numeric", correct_answer=correct, answer=answer, config=config or {})

    def test_fraction_correct_matches_decimal_answer(self):
        self.assertTrue(self._num("1/2", "0.5"))
        self.assertTrue(self._num("1/2", "1/2"))
        self.assertTrue(self._num("0.5", "1/2"))

    def test_fraction_three_quarters(self):
        self.assertTrue(self._num("3/4", "0.75"))
        self.assertTrue(self._num("3/4", "3/4"))

    def test_non_equivalent_fraction_is_wrong(self):
        self.assertFalse(self._num("1/3", "0.5"))
        self.assertFalse(self._num("1/2", "2/3"))

    def test_malformed_or_zero_denominator_is_not_correct(self):
        self.assertFalse(self._num("1/0", "0.5"))
        self.assertFalse(self._num("1/2", "1/0"))
        self.assertFalse(self._num("1/2", "abc"))

    def test_plain_numbers_still_grade(self):
        self.assertTrue(self._num("42", "42"))
        self.assertTrue(self._num(3.14, "3.14"))
        self.assertFalse(self._num("42", "43"))


class MultipleNumericAnswerGradingTests(SimpleTestCase):
    """A numeric question can accept several answers (SAT grid-in)."""

    def _num(self, correct, answer, config=None):
        return grade_answer(question_type="numeric", correct_answer=correct, answer=answer, config=config or {})

    def test_matches_any_value_in_list(self):
        accepted = [10.25, "21/2"]  # 10.25 or 10.5 (21/2)
        self.assertTrue(self._num(accepted, "10.25"))
        self.assertTrue(self._num(accepted, "10.5"))
        self.assertTrue(self._num(accepted, "21/2"))

    def test_no_match_in_list_is_wrong(self):
        self.assertFalse(self._num([10.25, "21/2"], "10.4"))
        self.assertFalse(self._num([10.25, "21/2"], "abc"))

    def test_list_respects_tolerance(self):
        self.assertTrue(self._num([10.25, "21/2"], "10.3", config={"tolerance": 0.1}))
        self.assertFalse(self._num([10.25, "21/2"], "10.9", config={"tolerance": 0.1}))

    def test_single_value_list_behaves_like_scalar(self):
        self.assertTrue(self._num(["1/2"], "0.5"))
        self.assertFalse(self._num(["1/2"], "0.6"))


class LocalNumberWritingGradingTests(SimpleTestCase):
    """Numbers as students here write them (2026-11-24, Foundation assessment).

    Uzbek schools write a decimal with a comma, and a phone or a pasted worksheet can give
    the typographic minus sign. The iPhone app sends what was typed as-is, so the grader
    must read both rather than mark a right answer wrong.
    """

    def _num(self, correct, answer, config=None):
        return grade_answer(question_type="numeric", correct_answer=correct, answer=answer, config=config or {})

    def test_comma_decimal_is_a_decimal(self):
        self.assertTrue(self._num("2.5", "2,5"))
        self.assertTrue(self._num(0.75, "0,75"))
        self.assertTrue(self._num("-0.75", "-0,75"))
        self.assertFalse(self._num("2.5", "2,6"))

    def test_typographic_minus_is_a_minus(self):
        self.assertTrue(self._num("-3", "\u22123"))
        self.assertTrue(self._num("-1/2", "\u22121/2"))
        self.assertFalse(self._num("3", "\u22123"))

    def test_x_equals_answer_is_its_value(self):
        # An equation's answer written the way it is solved on paper (owner, 2026-11-24:
        # "x=5" / "x=12" must be accepted). One letter, "=", then the number.
        self.assertTrue(self._num("5", "x=5"))
        self.assertTrue(self._num("12", "x = 12"))
        self.assertTrue(self._num("-3", "y=-3"))
        self.assertTrue(self._num("2.5", "x=2,5"))
        self.assertTrue(self._num("5", "\u0445=5"))  # Cyrillic "х" from a Russian keyboard
        self.assertFalse(self._num("5", "x=6"))

    def test_text_that_is_no_number_stays_wrong(self):
        self.assertFalse(self._num("25", "25%"))
        self.assertFalse(self._num("2.5", "2,5,0"))
        self.assertFalse(self._num("5", "2x=10"))
        self.assertFalse(self._num("5", "x=5 or x=-5"))
