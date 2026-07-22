"""Live shared reference: editing a Question Bank question propagates to every
assessment that uses it (no more frozen copies).

Covers the propagation helper directly and the real QB edit API endpoint.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from assessments.domain.bank_integration import (
    create_question_from_bank,
    propagate_bank_question_to_consumers,
)
from assessments.models import AssessmentQuestion, AssessmentSet
from questionbank.models import BankDomain, BankSkill, Difficulty, Subject
from questionbank.services import create_bank_question, update_bank_question
from questionbank.triage import approve_question, classify_question

User = get_user_model()


class BankPropagationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")
        cls.user = User.objects.create(username="prop", email="prop@test.local")
        cls.domain = BankDomain.objects.get(subject=Subject.MATH, name="Algebra")
        cls.skill = BankSkill.objects.get(domain=cls.domain, name="Linear functions")

    def _approved_bank_q(self, text="Original?", **over):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text=text,
            option_a="1", option_b="2", correct_answer="A", **over,
        )
        classify_question(q, domain=self.domain, skill=self.skill, difficulty=Difficulty.EASY)
        approve_question(q)
        q.refresh_from_db()
        return q

    def _set(self):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra › Linear functions", title="Set", created_by=self.user,
        )

    def test_helper_pushes_content_to_linked_questions(self):
        bank = self._approved_bank_q("Original prompt?")
        aset = self._set()
        aq = create_question_from_bank(aset, bank)
        self.assertEqual(aq.prompt, "Original prompt?")

        # Edit the bank question's content, then propagate.
        update_bank_question(
            bank, question_text="Edited prompt?", option_a="10", option_b="20", correct_answer="B",
            explanation="Because B.",
        )
        n = propagate_bank_question_to_consumers(bank)
        self.assertEqual(n, 1)

        aq.refresh_from_db()
        self.assertEqual(aq.prompt, "Edited prompt?")
        self.assertEqual(aq.correct_answer, "B")
        self.assertEqual([c["text"] for c in aq.choices], ["10", "20"])
        self.assertEqual(aq.explanation, "Because B.")

    def test_propagates_to_every_consumer(self):
        bank = self._approved_bank_q("Shared?")
        aq1 = create_question_from_bank(self._set(), bank)
        aq2 = create_question_from_bank(self._set(), bank)
        update_bank_question(bank, question_text="Now shared everywhere?")
        self.assertEqual(propagate_bank_question_to_consumers(bank), 2)
        aq1.refresh_from_db(); aq2.refresh_from_db()
        self.assertEqual(aq1.prompt, "Now shared everywhere?")
        self.assertEqual(aq2.prompt, "Now shared everywhere?")

    def test_qb_edit_api_propagates(self):
        bank = self._approved_bank_q("API original?")
        aset = self._set()
        aq = create_question_from_bank(aset, bank)

        admin = User.objects.create(
            username="qbadmin", email="qbadmin@test.local", is_superuser=True, is_staff=True,
        )
        client = APIClient()
        client.force_authenticate(admin)
        r = client.patch(
            f"/api/questionbank/questions/{bank.id}/",
            {"question_text": "API edited?", "correct_answer": "B"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        aq.refresh_from_db()
        self.assertEqual(aq.prompt, "API edited?")
        self.assertEqual(aq.correct_answer, "B")
