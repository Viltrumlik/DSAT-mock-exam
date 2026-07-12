"""Publish validation for versioned midterms (exams.sat_rules.validate_mock_exam).

A midterm's PracticeTests are its VERSIONS (parallel forms distributed randomly to
students). A midterm may have 1–4 versions, each with the configured module count
(1 or 2), and every counted module must hold at least one question.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from exams.models import MockExam, Module, PracticeTest
from exams.sat_rules import mock_exam_publish_violations
from exams.tests.support import seed_mc_question

User = get_user_model()


def _version(exam, order, n_modules, *, empty_module=None, missing_module=None):
    pt = PracticeTest.objects.create(
        mock_exam=exam, subject="MATH", form_type="INTERNATIONAL",
        skip_default_modules=True,
    )
    for mo in range(1, n_modules + 1):
        if mo == missing_module:
            continue
        m = Module.objects.create(practice_test=pt, module_order=mo, time_limit_minutes=10)
        if mo != empty_module:
            seed_mc_question(m, stem=f"V{order} M{mo} Q1")
    return pt


def _codes(exam):
    return {v.code for v in mock_exam_publish_violations(exam)}


class MidtermVersionValidationTests(TestCase):
    def _exam(self, module_count=2):
        return MockExam.objects.create(
            title="MT", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_module_count=module_count, is_published=False,
        )

    def test_one_version_two_modules_is_valid(self):
        ex = self._exam(2)
        _version(ex, 0, 2)
        self.assertEqual(_codes(ex), set())

    def test_four_versions_are_valid(self):
        ex = self._exam(2)
        for i in range(4):
            _version(ex, i, 2)
        self.assertEqual(_codes(ex), set())

    def test_more_than_four_versions_is_blocked(self):
        ex = self._exam(2)
        for i in range(5):
            _version(ex, i, 2)
        self.assertIn("MIDTERM_SECTION_COUNT", _codes(ex))

    def test_zero_versions_is_blocked(self):
        ex = self._exam(2)
        self.assertIn("MIDTERM_SECTION_COUNT", _codes(ex))

    def test_version_missing_second_module_is_blocked(self):
        ex = self._exam(2)
        _version(ex, 0, 2)  # valid version
        _version(ex, 1, 2, missing_module=2)  # only module 1 present
        self.assertIn("MIDTERM_MISSING_MODULES", _codes(ex))

    def test_version_with_empty_module_is_blocked(self):
        ex = self._exam(2)
        _version(ex, 0, 2)  # valid
        _version(ex, 1, 2, empty_module=2)  # module 2 has no questions
        self.assertIn("MIDTERM_EMPTY_MODULE", _codes(ex))

    def test_single_module_midterm_only_needs_module_one(self):
        # midterm_module_count=1 → module 2 is irrelevant even across 3 versions.
        ex = self._exam(1)
        for i in range(3):
            _version(ex, i, 1)
        self.assertEqual(_codes(ex), set())
