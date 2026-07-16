"""Midterm level + level-gated Desmos calculator.

The calculator used to be blanket-denied for every midterm. It is now level-gated to
match the assessment rule: a MATH midterm at middle/senior offers it; everything else
(R&W, or an untagged/junior/foundation Math midterm) does not. The rule lives on the
model and is echoed to the runner, so the frontend never re-derives it.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import Module
from midterms.models import Midterm

User = get_user_model()


def _mk(level="", subject=Midterm.MATH, title="M"):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=60)
    return Midterm.objects.create(title=title, subject=subject, level=level, question_module=module)


class CalculatorEnabledRuleTests(TestCase):
    def test_math_middle_and_senior_get_the_calculator(self):
        self.assertTrue(_mk(level=Midterm.LEVEL_MIDDLE).calculator_enabled)
        self.assertTrue(_mk(level=Midterm.LEVEL_SENIOR).calculator_enabled)

    def test_math_junior_foundation_and_untagged_do_not(self):
        self.assertFalse(_mk(level=Midterm.LEVEL_JUNIOR).calculator_enabled)
        self.assertFalse(_mk(level=Midterm.LEVEL_FOUNDATION).calculator_enabled)
        self.assertFalse(_mk(level="").calculator_enabled)  # legacy/untagged

    def test_reading_writing_never_gets_it_even_at_middle(self):
        self.assertFalse(_mk(level=Midterm.LEVEL_MIDDLE, subject=Midterm.READING_WRITING).calculator_enabled)

    def test_allowed_levels_are_subject_dependent(self):
        self.assertIn(Midterm.LEVEL_FOUNDATION, Midterm.allowed_levels_for_subject(Midterm.MATH))
        self.assertNotIn(
            Midterm.LEVEL_FOUNDATION, Midterm.allowed_levels_for_subject(Midterm.READING_WRITING)
        )


class SyncCarriesLegacyLevelTests(TestCase):
    """The builder authors the tier on the legacy MockExam; sync must mirror it —
    this is what actually turns the calculator on for existing prod midterms."""

    def test_sync_copies_midterm_level_from_legacy(self):
        from exams.models import MockExam
        from midterms.sync import upsert_midterm_from_legacy

        mock = MockExam.objects.create(
            title="Middle Math Midterm Month 1", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_level="middle", midterm_module_count=1,
            midterm_module1_minutes=60, is_published=True,
        )
        midterm = upsert_midterm_from_legacy(mock)
        self.assertEqual(midterm.level, "middle")
        self.assertTrue(midterm.calculator_enabled)

    def test_clearing_the_legacy_level_turns_the_calculator_back_off(self):
        """The gate must not be one-way. Selecting "Any level" in the builder clears
        midterm_level to "" — that MUST propagate, or an admin could never undo a
        calculator they turned on by mistake (legacy is the source of truth)."""
        from exams.models import MockExam
        from midterms.sync import upsert_midterm_from_legacy

        mock = MockExam.objects.create(
            title="M", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_level="middle", midterm_module_count=1, midterm_module1_minutes=60,
        )
        midterm = upsert_midterm_from_legacy(mock)
        self.assertTrue(midterm.calculator_enabled)

        mock.midterm_level = ""  # builder: Level -> "Any level"
        mock.save(update_fields=["midterm_level"])
        midterm = upsert_midterm_from_legacy(mock)
        self.assertEqual(midterm.level, "")
        self.assertFalse(midterm.calculator_enabled)

    def test_downgrading_the_legacy_level_turns_the_calculator_off(self):
        from exams.models import MockExam
        from midterms.sync import upsert_midterm_from_legacy

        mock = MockExam.objects.create(
            title="M2", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_level="middle", midterm_module_count=1, midterm_module1_minutes=60,
        )
        self.assertTrue(upsert_midterm_from_legacy(mock).calculator_enabled)
        mock.midterm_level = "junior"
        mock.save(update_fields=["midterm_level"])
        self.assertFalse(upsert_midterm_from_legacy(mock).calculator_enabled)


class RunnerPayloadTests(TestCase):
    def test_practice_test_details_echoes_level_and_calculator_flag(self):
        from midterms.serializers import MidtermAttemptSerializer
        from midterms.models import MidtermAttempt

        student = User.objects.create_user("calc_student@test.com", "secret123")
        midterm = _mk(level=Midterm.LEVEL_MIDDLE, title="Middle Math Midterm Month 1")
        attempt = MidtermAttempt.objects.create(midterm=midterm, student=student)
        data = MidtermAttemptSerializer(attempt).data
        details = data["practice_test_details"]
        self.assertEqual(details["mock_kind"], "MIDTERM")  # existing contract
        self.assertEqual(details["level"], "middle")
        self.assertTrue(details["calculator_enabled"])

    def test_junior_math_midterm_reports_calculator_disabled(self):
        from midterms.serializers import MidtermAttemptSerializer
        from midterms.models import MidtermAttempt

        student = User.objects.create_user("calc_student2@test.com", "secret123")
        attempt = MidtermAttempt.objects.create(midterm=_mk(level=Midterm.LEVEL_JUNIOR), student=student)
        details = MidtermAttemptSerializer(attempt).data["practice_test_details"]
        self.assertFalse(details["calculator_enabled"])


class AdminLevelValidationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "mt_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_foundation_rejected_for_reading_writing(self):
        from midterms.admin_serializers import AdminMidtermSerializer

        s = AdminMidtermSerializer(data={
            "title": "RW", "subject": Midterm.READING_WRITING, "level": Midterm.LEVEL_FOUNDATION,
            "duration_minutes": 60, "question_limit": 30,
        })
        self.assertFalse(s.is_valid())
        self.assertIn("level", s.errors)

    def test_middle_accepted_for_math_and_blank_stays_allowed(self):
        from midterms.admin_serializers import AdminMidtermSerializer

        ok = AdminMidtermSerializer(data={
            "title": "Math", "subject": Midterm.MATH, "level": Midterm.LEVEL_MIDDLE,
            "duration_minutes": 60, "question_limit": 30,
        })
        self.assertTrue(ok.is_valid(), ok.errors)
        untagged = AdminMidtermSerializer(data={
            "title": "Math", "subject": Midterm.MATH, "duration_minutes": 60, "question_limit": 30,
        })
        self.assertTrue(untagged.is_valid(), untagged.errors)
