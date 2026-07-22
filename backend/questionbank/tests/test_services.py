from django.test import TestCase

from questionbank.content_hash import compute_question_content_hash
from questionbank.models import BankQuestion, QbIdCounter, QuestionStatus, Subject
from questionbank.qb_id import allocate_qb_id, format_qb_id
from questionbank.services import create_bank_question, update_bank_question


class QbIdTests(TestCase):
    def test_ids_are_monotonic_and_per_subject(self):
        self.assertEqual(allocate_qb_id(Subject.ENGLISH), "QB-ENG-000001")
        self.assertEqual(allocate_qb_id(Subject.ENGLISH), "QB-ENG-000002")
        self.assertEqual(allocate_qb_id(Subject.MATH), "QB-MATH-000001")
        self.assertEqual(QbIdCounter.objects.get(subject=Subject.ENGLISH).last_value, 2)

    def test_ids_never_reused_after_archive(self):
        q = create_bank_question(
            subject=Subject.ENGLISH, question_type="MULTIPLE_CHOICE", question_text="A?",
        )
        first_id = q.qb_id
        # A question can never be hard-deleted while versions exist (PROTECT) — it is
        # archived instead. The counter is monotonic regardless, so a new question
        # never reuses an old number.
        q.status = QuestionStatus.ARCHIVED
        q.save(update_fields=["status"])
        q2 = create_bank_question(
            subject=Subject.ENGLISH, question_type="MULTIPLE_CHOICE", question_text="B?",
        )
        self.assertNotEqual(first_id, q2.qb_id)
        self.assertEqual(q2.qb_id, "QB-ENG-000002")

    def test_format(self):
        self.assertEqual(format_qb_id(Subject.MATH, 42), "QB-MATH-000042")


class ContentHashTests(TestCase):
    def test_normalisation_stable_across_case_and_whitespace(self):
        h1 = compute_question_content_hash(question_text=" Hello  World ", options=["a", "b"], correct_answer="A")
        h2 = compute_question_content_hash(question_text="hello world", options=["A", "B"], correct_answer=["a"])
        self.assertEqual(h1, h2)

    def test_option_order_matters(self):
        h1 = compute_question_content_hash(question_text="q", options=["a", "b"], correct_answer="A")
        h2 = compute_question_content_hash(question_text="q", options=["b", "a"], correct_answer="A")
        self.assertNotEqual(h1, h2)


class LiveEditTests(TestCase):
    """A bank question is the LIVE source of truth — edits mutate the row in place
    (no version chain) and recompute content_hash."""

    def test_create_lands_in_triage_with_hash(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="2+2?",
            option_a="3", option_b="4", correct_answer="B",
        )
        self.assertTrue(q.content_hash)
        self.assertEqual(q.status, QuestionStatus.TRIAGE)

    def test_edit_mutates_in_place_and_rehashes(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="2+2?",
            option_a="3", option_b="4", correct_answer="B",
        )
        original_hash = q.content_hash
        update_bank_question(q, question_text="2+3?", correct_answer="B")
        q.refresh_from_db()
        self.assertEqual(q.question_text, "2+3?")
        self.assertNotEqual(q.content_hash, original_hash)
        # No version rows exist — same single row is edited.
        self.assertEqual(BankQuestion.objects.filter(pk=q.pk).count(), 1)
