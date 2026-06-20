"""Phase B import-batch management API — read, candidates filter, promote, exact-only dedup."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from assessments.models import GovernanceEvent
from questionbank.models import (
    BankQuestion,
    ImportBatch,
    ImportCandidate,
    QuestionStatus,
    SourceType,
    Subject,
)
from questionbank.services import create_bank_question

User = get_user_model()


class QbImportBatchApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            email="ib-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        cls.student = User.objects.create_user(email="ib-stu@example.com", password="pw", role="student")

        cls.existing = create_bank_question(
            subject=Subject.ENGLISH, question_type="MULTIPLE_CHOICE", question_text="Already here?",
            status=QuestionStatus.APPROVED,
        )
        cls.batch = ImportBatch.objects.create(
            source_type=SourceType.PDF_IMPORT, filename="sat.pdf",
            status=ImportBatch.Status.READY,
        )
        V = ImportCandidate.Validation
        cls.valid = ImportCandidate.objects.create(
            batch=cls.batch, order=0, subject=Subject.ENGLISH, question_text="Valid Q",
            option_a="a", option_b="b", correct_answer="A", content_hash="hash-valid",
            validation_status=V.VALID,
        )
        cls.error = ImportCandidate.objects.create(
            batch=cls.batch, order=1, subject=Subject.ENGLISH, question_text="",
            validation_status=V.ERROR, validation_messages=["Missing question text."],
        )
        cls.dup = ImportCandidate.objects.create(
            batch=cls.batch, order=2, subject=Subject.ENGLISH, question_text="Already here?",
            content_hash="hash-dup", validation_status=V.DUPLICATE, duplicate_of=cls.existing,
        )
        cls.batch.total_candidates = 3
        cls.batch.save(update_fields=["total_candidates"])

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    # ── Permission ───────────────────────────────────────────────────────────
    def test_non_staff_denied(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(reverse("questionbank:batch-list")).status_code, 403)

    # ── Read ─────────────────────────────────────────────────────────────────
    def test_list_status_label_is_validation_failed_when_errors_present(self):
        res = self.client.get(reverse("questionbank:batch-list"))
        self.assertEqual(res.status_code, 200)
        row = res.data["results"][0]
        self.assertEqual(row["status_display"], "Validation Failed")  # READY + ERROR candidate
        self.assertEqual(row["candidate_counts"], {"valid": 1, "warning": 0, "error": 1, "duplicate": 1})

    def test_candidates_filter_by_validation_status(self):
        url = reverse("questionbank:batch-candidates", args=[self.batch.id])
        self.assertEqual(self.client.get(url).data["count"], 3)
        self.assertEqual(self.client.get(url, {"validation_status": "DUPLICATE"}).data["count"], 1)
        dup_row = self.client.get(url, {"validation_status": "DUPLICATE"}).data["results"][0]
        self.assertEqual(dup_row["duplicate_of_qb_id"], self.existing.qb_id)

    def test_no_similarity_fields_leak(self):
        """Exact-only dedup: response must not expose fuzzy/similarity fields."""
        blob = str(self.client.get(reverse("questionbank:batch-candidates", args=[self.batch.id])).data)
        for forbidden in ("similar", "similarity_score", "merge_recommendation"):
            self.assertNotIn(forbidden, blob)

    # ── Promote ──────────────────────────────────────────────────────────────
    def test_promote_imports_valid_skips_error_and_audits(self):
        before = BankQuestion.objects.count()
        res = self.client.post(reverse("questionbank:batch-promote", args=[self.batch.id]))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["promoted_count"], 1)            # only the VALID candidate
        self.assertEqual(res.data["status"], ImportBatch.Status.PROMOTED)
        self.assertEqual(BankQuestion.objects.count(), before + 1)

        self.valid.refresh_from_db()
        self.assertIsNotNone(self.valid.promoted_question_id)
        self.assertEqual(self.valid.promoted_question.status, QuestionStatus.TRIAGE)  # never auto-approved

        self.error.refresh_from_db()
        self.assertIsNone(self.error.promoted_question_id)        # ERROR skipped

        self.assertTrue(
            GovernanceEvent.objects.filter(
                event_type="qb_batch_promote", entity_type="ImportBatch", entity_id=self.batch.id
            ).exists()
        )
