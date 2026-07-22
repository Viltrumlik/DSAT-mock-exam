from django.core.management import call_command
from django.test import TestCase

from questionbank.models import BankDomain, BankQuestion, BankSkill, Difficulty, QuestionStatus, Subject
from questionbank.services import create_bank_question
from questionbank.suggestions import HeuristicSuggestionProvider, generate_suggestion
from questionbank.triage import (
    TriageError,
    accept_suggestion,
    approve_question,
    archive_question,
    classify_question,
    restore_question,
)


class TriageWorkflowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")
        cls.algebra = BankDomain.objects.get(subject=Subject.MATH, name="Algebra")
        cls.linear = BankSkill.objects.get(domain=cls.algebra, name="Linear functions")
        cls.geo = BankDomain.objects.get(subject=Subject.MATH, name="Geometry and Trigonometry")

    def _q(self):
        return create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="slope?",
            option_a="1", option_b="2", correct_answer="A",
        )

    def test_cannot_approve_unclassified(self):
        q = self._q()
        with self.assertRaises(TriageError):
            approve_question(q)
        q.refresh_from_db()
        self.assertEqual(q.status, QuestionStatus.TRIAGE)

    def test_classify_then_approve_gates(self):
        q = self._q()
        classify_question(q, domain=self.algebra, skill=self.linear, difficulty=Difficulty.EASY)
        approve_question(q)
        q.refresh_from_db()
        self.assertEqual(q.status, QuestionStatus.APPROVED)

    def test_skill_must_belong_to_domain(self):
        q = self._q()
        # linear belongs to Algebra, not Geometry → rejected
        with self.assertRaises(TriageError):
            classify_question(q, domain=self.geo, skill=self.linear, difficulty=Difficulty.EASY)

    def test_analytics_gate_excludes_triage(self):
        approved = self._q()
        classify_question(approved, domain=self.algebra, skill=self.linear, difficulty=Difficulty.MEDIUM)
        approve_question(approved)
        self._q()  # stays in triage
        self.assertEqual(BankQuestion.objects.count(), 2)
        self.assertEqual(BankQuestion.objects.approved().count(), 1)

    def test_archive_and_restore(self):
        q = self._q()
        classify_question(q, domain=self.algebra, skill=self.linear, difficulty=Difficulty.HARD)
        approve_question(q)
        archive_question(q)
        q.refresh_from_db()
        self.assertEqual(q.status, QuestionStatus.ARCHIVED)
        self.assertNotIn(q, BankQuestion.objects.approved())
        restore_question(q)
        q.refresh_from_db()
        self.assertEqual(q.status, QuestionStatus.APPROVED)  # fully classified → back to approved


class SuggestionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")

    def test_suggestion_is_advisory_only(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE",
            question_text="A circle has radius r; find its area and circumference.",
        )
        generate_suggestion(q, provider=HeuristicSuggestionProvider())
        q.refresh_from_db()
        # advisory fields populated, REAL taxonomy untouched, status unchanged
        self.assertIsNotNone(q.suggestion_model)
        self.assertIsNone(q.domain_id)
        self.assertIsNone(q.skill_id)
        self.assertEqual(q.status, QuestionStatus.TRIAGE)

    def test_accept_suggestion_requires_complete_suggestion(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="vague",
        )
        generate_suggestion(q, provider=HeuristicSuggestionProvider())
        q.refresh_from_db()
        # heuristic gives no difficulty → accepting must fail (no fabrication)
        with self.assertRaises(TriageError):
            accept_suggestion(q)
        q.refresh_from_db()
        self.assertIsNone(q.domain_id)
