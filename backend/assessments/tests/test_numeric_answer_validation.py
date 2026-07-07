"""AssessmentQuestion numeric correct_answer: single value OR several acceptable
values (SAT grid-in, e.g. 10.25 and 21/2), via a comma-separated string or a list."""
from __future__ import annotations

from django.test import TestCase

from assessments.serializers import AssessmentQuestionAdminWriteSerializer


class NumericAnswerValidationTests(TestCase):
    def _ser(self, correct):
        return AssessmentQuestionAdminWriteSerializer(
            data={"question_type": "numeric", "prompt": "Q", "correct_answer": correct, "points": 1}
        )

    def test_comma_separated_string_becomes_list(self):
        s = self._ser("10.25, 21/2")
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["correct_answer"], [10.25, "21/2"])

    def test_json_list_accepted(self):
        s = self._ser([10.25, "21/2"])
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["correct_answer"], [10.25, "21/2"])

    def test_single_number_stays_scalar(self):
        s = self._ser("42")
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["correct_answer"], 42)

    def test_single_fraction_stays_string(self):
        s = self._ser("1/2")
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["correct_answer"], "1/2")

    def test_invalid_token_in_list_rejected(self):
        s = self._ser("10.25, abc")
        self.assertFalse(s.is_valid())
        self.assertIn("correct_answer", s.errors)

    def test_blank_rejected(self):
        s = self._ser("   ")
        self.assertFalse(s.is_valid())
        self.assertIn("correct_answer", s.errors)
