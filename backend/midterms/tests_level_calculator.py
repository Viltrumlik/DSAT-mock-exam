"""Midterm level + level-gated Desmos calculator.

The calculator used to be blanket-denied for every midterm. It is now level-gated: a MATH
midterm at middle/senior offers the full Desmos, junior its Scientific calculator only;
foundation, R&W and an untagged Math midterm get none. Foundation shared junior's
Scientific calculator until 2026-10-11 (the school's request: Foundation works by hand).
The rule lives on the model and is echoed to the runner — and read by the scheduling
email — so nothing downstream re-derives it.
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

    def test_math_middle_and_senior_get_the_full_calculator(self):
        self.assertEqual(_mk(level=Midterm.LEVEL_MIDDLE).calculator_mode, Midterm.CALCULATOR_FULL)
        self.assertEqual(_mk(level=Midterm.LEVEL_SENIOR).calculator_mode, Midterm.CALCULATOR_FULL)

    def test_math_junior_gets_the_scientific_calculator_only(self):
        midterm = _mk(level=Midterm.LEVEL_JUNIOR)
        self.assertTrue(midterm.calculator_enabled)
        self.assertEqual(midterm.calculator_mode, Midterm.CALCULATOR_SCIENTIFIC)

    def test_math_foundation_gets_no_calculator_at_all(self):
        """2026-10-11, the school's request: Foundation Math is worked by hand. Not the
        Scientific calculator junior keeps — none, the same as an untagged paper."""
        midterm = _mk(level=Midterm.LEVEL_FOUNDATION)
        self.assertFalse(midterm.calculator_enabled)
        self.assertIsNone(midterm.calculator_mode)
        self.assertNotIn(Midterm.LEVEL_FOUNDATION, Midterm.CALCULATOR_LEVELS)
        self.assertNotIn(Midterm.LEVEL_FOUNDATION, Midterm.SCIENTIFIC_CALCULATOR_LEVELS)

    def test_untagged_math_gets_none(self):
        midterm = _mk(level="")  # legacy/untagged
        self.assertFalse(midterm.calculator_enabled)
        self.assertIsNone(midterm.calculator_mode)

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

    def test_downgrading_the_legacy_level_narrows_to_scientific(self):
        from exams.models import MockExam
        from midterms.sync import upsert_midterm_from_legacy

        mock = MockExam.objects.create(
            title="M2", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_level="middle", midterm_module_count=1, midterm_module1_minutes=60,
        )
        self.assertEqual(upsert_midterm_from_legacy(mock).calculator_mode, Midterm.CALCULATOR_FULL)
        mock.midterm_level = "junior"
        mock.save(update_fields=["midterm_level"])
        self.assertEqual(upsert_midterm_from_legacy(mock).calculator_mode, Midterm.CALCULATOR_SCIENTIFIC)


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
        self.assertEqual(details["calculator_mode"], "full")

    def test_junior_math_midterm_reports_scientific_only(self):
        from midterms.serializers import MidtermAttemptSerializer
        from midterms.models import MidtermAttempt

        student = User.objects.create_user("calc_student2@test.com", "secret123")
        attempt = MidtermAttempt.objects.create(midterm=_mk(level=Midterm.LEVEL_JUNIOR), student=student)
        details = MidtermAttemptSerializer(attempt).data["practice_test_details"]
        self.assertTrue(details["calculator_enabled"])
        self.assertEqual(details["calculator_mode"], "scientific")

    def test_foundation_math_midterm_reports_no_calculator(self):
        """The payload is the gate both runners obey (web selectors.calculatorAllowed and the
        Windows app's ExamRunner), so Foundation's "by hand" rule has to be visible here."""
        from midterms.serializers import MidtermAttemptSerializer
        from midterms.models import MidtermAttempt

        student = User.objects.create_user("calc_student3@test.com", "secret123")
        attempt = MidtermAttempt.objects.create(
            midterm=_mk(level=Midterm.LEVEL_FOUNDATION, title="Foundation Math Midterm"), student=student
        )
        details = MidtermAttemptSerializer(attempt).data["practice_test_details"]
        self.assertEqual(details["level"], "foundation")
        self.assertIs(details["calculator_enabled"], False)
        self.assertIsNone(details["calculator_mode"])


class SchedulingEmailCalculatorTests(TestCase):
    """The "your midterm is scheduled" email states the calculator rule before the student
    ever opens the paper, so it must say what the runner will do. Both identities are
    covered: the new Midterm reads the property, the legacy MockExam the model's tuples."""

    def _legacy(self, level):
        from exams.models import MockExam

        return MockExam.objects.create(
            title=f"Legacy {level} Math", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_level=level,
        )

    def test_foundation_math_mail_promises_no_calculator(self):
        from classes.mail_midterm import _legacy_facts, _midterm_facts

        for facts in (_midterm_facts(_mk(level=Midterm.LEVEL_FOUNDATION)), _legacy_facts(self._legacy("foundation"))):
            self.assertIs(facts["calculator_enabled"], False)
            self.assertIs(facts["calculator_scientific_only"], False)

    def test_junior_math_mail_promises_the_scientific_calculator(self):
        from classes.mail_midterm import _legacy_facts, _midterm_facts

        for facts in (_midterm_facts(_mk(level=Midterm.LEVEL_JUNIOR)), _legacy_facts(self._legacy("junior"))):
            self.assertIs(facts["calculator_enabled"], True)
            self.assertIs(facts["calculator_scientific_only"], True)

    def test_legacy_rule_matches_the_model_at_every_level(self):
        """The legacy path used to hand-copy the rule; this pins it to the model so the two
        cannot drift again (legacy levels are free-form case, so "Middle" counts too)."""
        from classes.mail_midterm import _legacy_facts

        for level in ("", "foundation", "junior", "middle", "senior", "Middle"):
            model = _mk(level=level.lower())
            facts = _legacy_facts(self._legacy(level))
            self.assertEqual(facts["calculator_enabled"], model.calculator_enabled, level)
            self.assertEqual(
                facts["calculator_scientific_only"],
                model.calculator_mode == Midterm.CALCULATOR_SCIENTIFIC,
                level,
            )

    def test_reading_writing_legacy_mail_never_promises_one(self):
        from classes.mail_midterm import _legacy_facts
        from exams.models import MockExam

        exam = MockExam.objects.create(
            title="Legacy RW", kind=MockExam.KIND_MIDTERM,
            midterm_subject="READING_WRITING", midterm_level="middle",
        )
        self.assertIs(_legacy_facts(exam)["calculator_enabled"], False)


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
