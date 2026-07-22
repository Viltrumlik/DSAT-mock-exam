"""
M4 — Question Bank → Assessment integration tests (assessments only).

Covers the six required scenarios plus a backward-compatibility guard that
non-bank assessments are completely unaffected.
"""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase

from assessments.domain.bank_integration import create_question_from_bank
from assessments.models import AssessmentQuestion, AssessmentSet
from questionbank.models import BankDomain, BankSkill, Difficulty, QuestionStatus, Subject
from questionbank.services import create_bank_question
from questionbank.triage import approve_question, classify_question

User = get_user_model()


class M4AssessmentBankIntegrationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")
        cls.user = User.objects.create(username="m4", email="m4@test.local")
        cls.domain = BankDomain.objects.get(subject=Subject.MATH, name="Algebra")
        cls.skill = BankSkill.objects.get(domain=cls.domain, name="Linear functions")

    def _approved_bank_q(self, text="What is the slope of y = 2x + 1?"):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text=text,
            option_a="2", option_b="1", correct_answer="A",
        )
        classify_question(q, domain=self.domain, skill=self.skill, difficulty=Difficulty.EASY)
        approve_question(q)  # cuts version 2; current_version = v2
        q.refresh_from_db()
        return q

    def _set(self):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra › Linear functions", title="M4 Set", created_by=self.user,
        )

    # 1 ─────────────────────────────────────────────────────────────────────
    def test_select_approved_creates_linked_question(self):
        bank = self._approved_bank_q()
        aset = self._set()
        aq = create_question_from_bank(aset, bank)
        self.assertEqual(aq.bank_question_id, bank.id)
        self.assertEqual(aq.prompt, bank.question_text)
        self.assertEqual([c["id"] for c in aq.choices], ["A", "B"])
        self.assertEqual(aq.correct_answer, "A")

    def test_from_bank_always_appends_dense_order(self):
        # order is server-owned: repeated bank-adds to a set get dense 0..n-1 and
        # can never collide under UNIQUE(assessment_set, order). The function no
        # longer accepts a caller-supplied order (which could trip the constraint).
        aset = self._set()
        a = create_question_from_bank(aset, self._approved_bank_q("Q1?"))
        b = create_question_from_bank(aset, self._approved_bank_q("Q2?"))
        c = create_question_from_bank(aset, self._approved_bank_q("Q3?"))
        self.assertEqual([a.order, b.order, c.order], [0, 1, 2])
        with self.assertRaises(TypeError):
            create_question_from_bank(aset, self._approved_bank_q("Q4?"), order=0)

    # 2 ─────────────────────────────────────────────────────────────────────
    def test_cannot_select_triage_question(self):
        triage = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="unreviewed",
            option_a="1", option_b="2", correct_answer="A",
        )  # stays TRIAGE
        self.assertEqual(triage.status, QuestionStatus.TRIAGE)
        aset = self._set()
        with self.assertRaises(ValidationError):
            create_question_from_bank(aset, triage)
        self.assertEqual(AssessmentQuestion.objects.filter(assessment_set=aset).count(), 0)

    # 3 ─────────────────────────────────────────────────────────────────────
    def test_editing_bank_question_propagates_to_linked_assessment(self):
        # Live shared reference: an edit in the bank flows to the linked assessment.
        from assessments.domain.bank_integration import propagate_bank_question_to_consumers
        from questionbank.services import update_bank_question

        bank = self._approved_bank_q("Original?")
        aset = self._set()
        aq = create_question_from_bank(aset, bank)
        update_bank_question(bank, question_text="Edited everywhere?", correct_answer="B")
        propagate_bank_question_to_consumers(bank)
        aq.refresh_from_db()
        self.assertEqual(aq.prompt, "Edited everywhere?")
        self.assertEqual(aq.correct_answer, "B")
