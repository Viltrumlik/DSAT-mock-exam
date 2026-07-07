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
