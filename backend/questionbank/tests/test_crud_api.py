"""M7 — QB content CRUD API: author / edit (any state, keeps status) / archive."""
from __future__ import annotations

import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from assessments.models import GovernanceEvent
from questionbank.models import BankDomain, BankSkill, QuestionStatus, Subject
from questionbank.services import create_bank_question
from questionbank.triage import approve_question, classify_question

User = get_user_model()


def _png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (6, 6), (10, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


class QbCrudApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.domain = BankDomain.objects.create(subject=Subject.ENGLISH, name="Information and Ideas", code="info")
        cls.skill = BankSkill.objects.create(domain=cls.domain, name="Inferences", code="inf")
        cls.admin = User.objects.create_user(
            email="crud-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        cls.student = User.objects.create_user(email="crud-stu@example.com", password="pw", role="student")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    # ── Create ───────────────────────────────────────────────────────────────
    def test_create_lands_in_triage(self):
        res = self.client.post(
            reverse("questionbank:question-list"),
            {
                "subject": "ENGLISH", "question_type": "MULTIPLE_CHOICE",
                "question_text": "Which choice is best?",
                "option_a": "one", "option_b": "two", "correct_answer": "B", "points": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], QuestionStatus.TRIAGE)
        self.assertTrue(res.data["qb_id"])
        self.assertTrue(GovernanceEvent.objects.filter(event_type="qb_question_create").exists())

    def test_create_requires_subject(self):
        res = self.client.post(
            reverse("questionbank:question-list"),
            {"question_type": "MULTIPLE_CHOICE", "question_text": "x"}, format="json",
        )
        self.assertEqual(res.status_code, 400)

    @override_settings(MEDIA_ROOT="/tmp/qb_crud_media")
    def test_create_with_image_multipart(self):
        res = self.client.post(
            reverse("questionbank:question-list"),
            {
                "subject": "ENGLISH", "question_type": "MULTIPLE_CHOICE",
                "question_text": "See the figure.",
                "correct_answer": "A",
                "question_image": SimpleUploadedFile("d.png", _png(), content_type="image/png"),
            },
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["question_image"])

    def test_create_rejects_mismatched_taxonomy(self):
        math_domain = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="alg")
        res = self.client.post(
            reverse("questionbank:question-list"),
            {
                "subject": "ENGLISH", "question_type": "MULTIPLE_CHOICE", "question_text": "q",
                "domain": math_domain.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    # ── Edit ─────────────────────────────────────────────────────────────────
    def _approved_q(self):
        q = create_bank_question(
            subject=Subject.ENGLISH, question_type="MULTIPLE_CHOICE", question_text="orig",
            option_a="a", option_b="b", correct_answer="A",
        )
        classify_question(q, domain=self.domain, skill=self.skill, difficulty="MEDIUM")
        approve_question(q)
        q.refresh_from_db()
        return q

    def test_edit_keeps_status_and_mutates_in_place(self):
        q = self._approved_q()
        res = self.client.patch(
            reverse("questionbank:question-detail", args=[q.id]),
            {"question_text": "edited stem"}, format="json",
        )
        self.assertEqual(res.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.question_text, "edited stem")
        self.assertEqual(q.status, QuestionStatus.APPROVED)  # status preserved
        self.assertTrue(GovernanceEvent.objects.filter(event_type="qb_question_update", entity_id=q.id).exists())

    def test_edit_can_change_taxonomy(self):
        q = self._approved_q()
        d2 = BankDomain.objects.create(subject=Subject.ENGLISH, name="Craft", code="craft")
        s2 = BankSkill.objects.create(domain=d2, name="Words", code="words")
        res = self.client.patch(
            reverse("questionbank:question-detail", args=[q.id]),
            {"domain": d2.id, "skill": s2.id, "difficulty": "HARD"}, format="json",
        )
        self.assertEqual(res.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.domain_id, d2.id)
        self.assertEqual(q.difficulty, "HARD")

    def test_edit_pdf_imported_question(self):
        q = create_bank_question(
            subject=Subject.ENGLISH, question_type="MULTIPLE_CHOICE", question_text="imported",
            status=QuestionStatus.IMPORTED,
        )
        res = self.client.patch(
            reverse("questionbank:question-detail", args=[q.id]),
            {"question_text": "fixed"}, format="json",
        )
        self.assertEqual(res.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.question_text, "fixed")
        self.assertEqual(q.status, QuestionStatus.IMPORTED)  # still imported

    # ── Archive / restore ────────────────────────────────────────────────────
    def test_archive_hides_from_approved_then_restore(self):
        from questionbank.models import BankQuestion

        q = self._approved_q()
        self.assertIn(q, BankQuestion.objects.approved())
        a = self.client.post(reverse("questionbank:question-archive", args=[q.id]))
        self.assertEqual(a.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, QuestionStatus.ARCHIVED)
        self.assertNotIn(q, BankQuestion.objects.approved())  # gone from consumer/student view

        r = self.client.post(reverse("questionbank:question-restore", args=[q.id]))
        self.assertEqual(r.status_code, 200)
        q.refresh_from_db()
        self.assertEqual(q.status, QuestionStatus.APPROVED)  # fully classified → back to approved
        self.assertTrue(GovernanceEvent.objects.filter(event_type="qb_question_archive", entity_id=q.id).exists())
        self.assertTrue(GovernanceEvent.objects.filter(event_type="qb_question_restore", entity_id=q.id).exists())

    # ── Permission ───────────────────────────────────────────────────────────
    def test_non_staff_cannot_author(self):
        self.client.force_authenticate(self.student)
        res = self.client.post(
            reverse("questionbank:question-list"),
            {"subject": "ENGLISH", "question_type": "MULTIPLE_CHOICE", "question_text": "x"}, format="json",
        )
        self.assertEqual(res.status_code, 403)
