"""Phase B triage write API — classify/approve/reject/accept-suggestion + bulk, with audit."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from assessments.models import GovernanceEvent
from questionbank.models import BankDomain, BankSkill, QuestionStatus, Subject
from questionbank.services import create_bank_question

User = get_user_model()


class QbTriageApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.domain = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra")
        cls.skill = BankSkill.objects.create(domain=cls.domain, name="Linear", code="linear")
        cls.admin = User.objects.create_user(
            email="t-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        cls.student = User.objects.create_user(email="t-stu@example.com", password="pw", role="student")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE",
            question_text="2x=4?", status=QuestionStatus.TRIAGE,
            option_a="1", option_b="2", correct_answer="B",
        )

    def _classify_payload(self):
        return {"domain": self.domain.id, "skill": self.skill.id, "difficulty": "EASY"}

    # ── Permission ───────────────────────────────────────────────────────────
    def test_non_staff_denied(self):
        self.client.force_authenticate(self.student)
        res = self.client.post(reverse("questionbank:question-approve", args=[self.q.id]))
        self.assertEqual(res.status_code, 403)

    # ── Classify ─────────────────────────────────────────────────────────────
    def test_classify_assigns_taxonomy_and_audits(self):
        res = self.client.post(reverse("questionbank:question-classify", args=[self.q.id]), self._classify_payload())
        self.assertEqual(res.status_code, 200)
        self.q.refresh_from_db()
        self.assertEqual(self.q.domain_id, self.domain.id)
        self.assertEqual(self.q.skill_id, self.skill.id)
        self.assertEqual(self.q.difficulty, "EASY")
        self.assertTrue(
            GovernanceEvent.objects.filter(
                event_type="qb_question_classify", entity_type="BankQuestion", entity_id=self.q.id
            ).exists()
        )

    def test_classify_rejects_mismatched_skill(self):
        other_domain = BankDomain.objects.create(subject=Subject.ENGLISH, name="Craft", code="craft")
        other_skill = BankSkill.objects.create(domain=other_domain, name="Words", code="words")
        res = self.client.post(
            reverse("questionbank:question-classify", args=[self.q.id]),
            {"domain": self.domain.id, "skill": other_skill.id, "difficulty": "EASY"},
        )
        self.assertEqual(res.status_code, 400)

    # ── Approve ──────────────────────────────────────────────────────────────
    def test_approve_unclassified_is_400(self):
        res = self.client.post(reverse("questionbank:question-approve", args=[self.q.id]))
        self.assertEqual(res.status_code, 400)

    def test_classify_then_approve(self):
        self.client.post(reverse("questionbank:question-classify", args=[self.q.id]), self._classify_payload())
        res = self.client.post(reverse("questionbank:question-approve", args=[self.q.id]))
        self.assertEqual(res.status_code, 200)
        self.q.refresh_from_db()
        self.assertEqual(self.q.status, QuestionStatus.APPROVED)
        self.assertTrue(GovernanceEvent.objects.filter(event_type="qb_question_approve", entity_id=self.q.id).exists())

    # ── Reject ───────────────────────────────────────────────────────────────
    def test_reject_records_reason(self):
        res = self.client.post(reverse("questionbank:question-reject", args=[self.q.id]), {"reason": "off-spec"})
        self.assertEqual(res.status_code, 200)
        self.q.refresh_from_db()
        self.assertEqual(self.q.status, QuestionStatus.REJECTED)
        self.assertEqual(self.q.metadata.get("rejection_reason"), "off-spec")

    # ── Accept suggestion ────────────────────────────────────────────────────
    def test_accept_suggestion_applies_advisory(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="x+1?",
            status=QuestionStatus.TRIAGE,
            suggested_domain=self.domain, suggested_skill=self.skill, suggested_difficulty="MEDIUM",
        )
        res = self.client.post(reverse("questionbank:question-accept-suggestion", args=[q.id]))
        self.assertEqual(res.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.domain_id, self.domain.id)
        self.assertEqual(q.difficulty, "MEDIUM")
        self.assertTrue(GovernanceEvent.objects.filter(event_type="qb_question_accept_suggestion", entity_id=q.id).exists())

    def test_accept_suggestion_without_one_is_400(self):
        res = self.client.post(reverse("questionbank:question-accept-suggestion", args=[self.q.id]))
        self.assertEqual(res.status_code, 400)

    # ── Bulk ─────────────────────────────────────────────────────────────────
    def test_bulk_classify_then_approve(self):
        q2 = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="3x=9?",
            status=QuestionStatus.TRIAGE,
        )
        ids = [self.q.id, q2.id]
        c = self.client.post(
            reverse("questionbank:question-bulk"),
            {"action": "classify", "ids": ids, **self._classify_payload()}, format="json",
        )
        self.assertEqual(c.status_code, 200)
        self.assertTrue(all(r["ok"] for r in c.data["results"]))

        a = self.client.post(
            reverse("questionbank:question-bulk"), {"action": "approve", "ids": ids}, format="json"
        )
        self.assertTrue(all(r["ok"] for r in a.data["results"]))
        self.assertEqual(
            list(self.q.__class__.objects.filter(id__in=ids).values_list("status", flat=True)),
            [QuestionStatus.APPROVED, QuestionStatus.APPROVED],
        )

    def test_bulk_classify_requires_taxonomy(self):
        res = self.client.post(
            reverse("questionbank:question-bulk"), {"action": "classify", "ids": [self.q.id]}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_bulk_reports_per_id_errors(self):
        # approve an unclassified question in bulk → that id fails, others reported independently
        res = self.client.post(
            reverse("questionbank:question-bulk"), {"action": "approve", "ids": [self.q.id, 999999]}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        by_id = {r["id"]: r for r in res.data["results"]}
        self.assertFalse(by_id[self.q.id]["ok"])       # unclassified → TriageError
        self.assertFalse(by_id[999999]["ok"])          # missing → not found
