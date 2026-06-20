"""M9 — student practice API: APPROVED-only, no answer leak, grade + record."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from questionbank.models import BankDomain, BankQuestionAttempt, BankSkill, QuestionStatus, Subject
from questionbank.services import create_bank_question
from questionbank.triage import approve_question, classify_question

User = get_user_model()


class PracticeApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.domain = BankDomain.objects.create(subject=Subject.ENGLISH, name="Information and Ideas", code="info")
        cls.skill = BankSkill.objects.create(domain=cls.domain, name="Inferences", code="inf")
        cls.student = User.objects.create_user(email="prac-stu@example.com", password="pw", role="student")

        cls.approved = cls._make("Approved Q", QuestionStatus.IMPORTED, approve=True)
        cls.triage = cls._make("Triage Q", QuestionStatus.TRIAGE, approve=False)

    @classmethod
    def _make(cls, text, status, *, approve):
        q = create_bank_question(
            subject=Subject.ENGLISH, question_type="MULTIPLE_CHOICE", question_text=text,
            option_a="one", option_b="two", correct_answer="B", explanation="Two is right.",
            status=status,
        )
        if approve:
            classify_question(q, domain=cls.domain, skill=cls.skill, difficulty="MEDIUM")
            approve_question(q)
            q.refresh_from_db()
        return q

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(reverse("questionbank:practice-list")).status_code, (401, 403))

    def test_list_only_approved(self):
        res = self.client.get(reverse("questionbank:practice-list"))
        self.assertEqual(res.status_code, 200)
        ids = {row["id"] for row in res.data["results"]}
        self.assertIn(self.approved.id, ids)
        self.assertNotIn(self.triage.id, ids)  # TRIAGE never shown to students

    def test_list_and_detail_never_leak_answer(self):
        row = self.client.get(reverse("questionbank:practice-list")).data["results"][0]
        self.assertNotIn("correct_answer", row)
        self.assertNotIn("explanation", row)
        detail = self.client.get(reverse("questionbank:practice-detail", args=[self.approved.id])).data
        self.assertNotIn("correct_answer", detail)
        self.assertNotIn("explanation", detail)
        self.assertNotIn("student_answer", detail)
        self.assertEqual([c["id"] for c in detail["choices"]], ["A", "B"])

    def test_detail_404_for_unapproved(self):
        self.assertEqual(
            self.client.get(reverse("questionbank:practice-detail", args=[self.triage.id])).status_code, 404
        )

    def test_filter_by_domain_and_difficulty(self):
        url = reverse("questionbank:practice-list")
        self.assertEqual(self.client.get(url, {"domain": self.domain.id}).data["count"], 1)
        self.assertEqual(self.client.get(url, {"difficulty": "MEDIUM"}).data["count"], 1)
        self.assertEqual(self.client.get(url, {"difficulty": "EASY"}).data["count"], 0)

    def test_answer_grades_records_and_reveals(self):
        url = reverse("questionbank:practice-answer", args=[self.approved.id])
        wrong = self.client.post(url, {"answer": "A"})
        self.assertEqual(wrong.status_code, 200)
        self.assertFalse(wrong.data["is_correct"])
        self.assertEqual(wrong.data["correct_answer"], "B")
        self.assertEqual(wrong.data["explanation"], "Two is right.")

        right = self.client.post(url, {"answer": "b"})  # case-insensitive
        self.assertTrue(right.data["is_correct"])

        self.assertEqual(BankQuestionAttempt.objects.filter(user=self.student).count(), 2)

    def test_cannot_answer_unapproved(self):
        res = self.client.post(reverse("questionbank:practice-answer", args=[self.triage.id]), {"answer": "B"})
        self.assertEqual(res.status_code, 404)

    def test_taxonomy_lists_used_domains(self):
        res = self.client.get(reverse("questionbank:practice-taxonomy"))
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.domain.id, {d["id"] for d in res.data["domains"]})
        self.assertIn(self.skill.id, {s["id"] for s in res.data["skills"]})
