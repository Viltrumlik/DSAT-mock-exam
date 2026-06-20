from django.test import TestCase

from questionbank.import_pipeline import create_batch_from_pages, promote_batch
from questionbank.models import BankPassage, BankQuestion, ImportCandidate, Subject
from questionbank.pdf_parser import parse_pages
from questionbank.services import create_bank_question


# One passage shared by two R&W questions.
RW_PASSAGE_PDF = """Passage
The history of jazz is a story of constant reinvention. Early forms gave way to
swing, bebop, and beyond.

Assessment SAT
Test: Reading and Writing
Domain: Information and Ideas
Skill: Central Ideas and Details

Question
The main idea of the passage is that jazz...

A. never changed
B. constantly reinvented itself
C. began with bebop
D. is unpopular

Correct Answer: B

Rationale
Choice B is correct because the passage emphasizes constant reinvention.

Assessment SAT
Test: Reading and Writing
Domain: Information and Ideas
Skill: Inferences

Question
It can be inferred that swing came...

A. before early forms
B. after bebop
C. after early forms
D. never

Correct Answer: C

Rationale
Choice C is correct because swing is listed after early forms.
"""


class PassageParsingTests(TestCase):
    def test_passage_shared_across_questions(self):
        qs = parse_pages([RW_PASSAGE_PDF])
        self.assertEqual(len(qs), 2)
        self.assertIn("constant reinvention", qs[0].passage_text)
        # Both questions carry the SAME passage text (sticky passage).
        self.assertEqual(qs[0].passage_text, qs[1].passage_text)
        # Passage text is NOT mixed into the stem.
        self.assertNotIn("history of jazz", qs[0].question_text)

    def test_math_question_has_no_passage(self):
        pdf = (
            "Passage\nIgnore me.\n\nTest: Math\nDomain: Algebra\n\n"
            "Question\nSolve x+1=2.\nA. 0\nB. 1\nCorrect Answer: B\nRationale\nx=1.\n"
        )
        (q,) = parse_pages([pdf])
        self.assertEqual(q.subject, "MATH")
        self.assertEqual(q.passage_text, "")  # Test: Math clears the sticky passage


class PassagePopulationTests(TestCase):
    def test_promotion_creates_one_passage_for_shared_questions(self):
        batch = create_batch_from_pages([RW_PASSAGE_PDF], filename="rw.pdf")
        self.assertEqual(batch.candidates.count(), 2)
        promote_batch(batch)

        # Two distinct questions, ONE shared passage row (no duplication).
        self.assertEqual(BankQuestion.objects.count(), 2)
        self.assertEqual(BankPassage.objects.count(), 1)
        passage = BankPassage.objects.get()
        self.assertEqual(
            set(BankQuestion.objects.values_list("passage_id", flat=True)),
            {passage.id},
        )
        self.assertIn("constant reinvention", passage.passage_text)
        self.assertEqual(passage.subject, Subject.ENGLISH)
        self.assertTrue(passage.content_hash)


class DedupUnificationTests(TestCase):
    def test_intra_batch_duplicate_flagged_and_not_promoted(self):
        # Import policy is English text-only, so use an R&W question.
        single = (
            "Test: Reading and Writing\nDomain: Information and Ideas\n\nQuestion\nWhich choice is best?\n"
            "A. one\nB. two\nCorrect Answer: B\nRationale\nIt is two.\n"
        )
        batch = create_batch_from_pages([single, single])  # same question twice
        statuses = list(batch.candidates.order_by("order").values_list("validation_status", flat=True))
        self.assertEqual(statuses[0], ImportCandidate.Validation.VALID)
        self.assertEqual(statuses[1], ImportCandidate.Validation.DUPLICATE)
        promote_batch(batch)
        self.assertEqual(BankQuestion.objects.count(), 1)  # duplicate not promoted

    def test_import_dedups_against_existing_bank_by_subject_and_hash(self):
        # Pre-seed the bank with a question identical to one we will "import".
        create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="What is 1+1?",
            option_a="1", option_b="2", correct_answer="B", explanation="It is two.",
        )
        pdf = (
            "Test: Math\nDomain: Algebra\n\nQuestion\nWhat is 1+1?\n"
            "A. 1\nB. 2\nCorrect Answer: B\nRationale\nIt is two.\n"
        )
        batch = create_batch_from_pages([pdf])
        cand = batch.candidates.get()
        self.assertEqual(cand.validation_status, ImportCandidate.Validation.DUPLICATE)
        self.assertIsNotNone(cand.duplicate_of_id)

    def test_same_hash_different_subject_is_not_a_duplicate(self):
        from questionbank.dedup import find_duplicate

        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="ambiguous",
            option_a="a", option_b="b", correct_answer="A",
        )
        h = q.content_hash  # the canonical hash the bank actually stored
        # Same content hash, different subject → NOT a duplicate.
        self.assertIsNone(find_duplicate(subject=Subject.ENGLISH, content_hash=h))
        self.assertIsNotNone(find_duplicate(subject=Subject.MATH, content_hash=h))
