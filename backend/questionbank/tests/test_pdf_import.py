from django.test import TestCase

from questionbank.import_pipeline import create_batch_from_pages, promote_batch
from questionbank.import_validation import validate_parsed
from questionbank.models import BankQuestion, ImportCandidate, QuestionStatus
from questionbank.pdf_parser import parse_pages


# A single question whose rationale is split across TWO pages.
PAGE_1 = """Assessment SAT
Test: Math
Domain: Algebra
Skill: Linear functions
Difficulty: Medium

Question
If 2x + 3 = 11, what is the value of x?

A. 2
B. 4
C. 7
D. 8

Correct Answer: B

Rationale
Choice B is correct because subtracting 3 from both sides gives 2x = 8, and
1
"""

PAGE_2 = """2
dividing both sides by 2 yields x = 4. Choices A, C, and D are incorrect because
they result from arithmetic errors.

Assessment SAT
Test: Math
Domain: Algebra
Skill: Linear functions
Difficulty: Easy

Question
What is the slope of the line y = 5x - 2?

A. -2
B. 2
C. 5
D. 7

Correct Answer: C

Rationale
Choice C is correct because the equation is in slope-intercept form y = mx + b,
where m is the slope, so the slope is 5.
"""


class MultiPageRationaleTests(TestCase):
    def test_rationale_merges_across_page_break(self):
        questions = parse_pages([PAGE_1, PAGE_2])
        self.assertEqual(len(questions), 2)
        q1 = questions[0]
        # The explanation must include text from BOTH pages, with the bare page
        # numbers ("1", "2") stripped, and not be cut at the page boundary.
        self.assertIn("subtracting 3 from both sides", q1.explanation)
        self.assertIn("dividing both sides by 2 yields x = 4", q1.explanation)
        self.assertNotIn(" 1 ", f" {q1.explanation} ")
        self.assertEqual(q1.page_start, 1)
        self.assertEqual(q1.page_end, 2)
        # Boundary correctly detected: q1 stops where the next "Question" begins.
        self.assertNotIn("slope", q1.explanation)

    def test_fields_parsed(self):
        q1, q2 = parse_pages([PAGE_1, PAGE_2])
        self.assertEqual(q1.subject, "MATH")
        self.assertEqual(q1.raw_domain, "Algebra")
        self.assertEqual(q1.raw_skill, "Linear functions")
        self.assertEqual(q1.raw_difficulty, "Medium")
        self.assertEqual(q1.question_text, "If 2x + 3 = 11, what is the value of x?")
        self.assertEqual(q1.options["B"], "4")
        self.assertEqual(q1.correct_answer, "B")
        self.assertEqual(q2.correct_answer, "C")


# Import policy is English text-only, so pipeline/validation fixtures use R&W.
ENG_PAGE_1 = """Assessment SAT
Test: Reading and Writing
Domain: Information and Ideas
Skill: Inferences
Difficulty: Medium

Question
The passage emphasizes that the results were unexpected.
Which choice best states the main idea of the passage?

A. The results were expected.
B. The results were unexpected and notable.
C. The results were unrelated.
D. The results were minor.

Correct Answer: B

Rationale
Choice B is correct because the passage stresses how unexpected the results were.
"""

ENG_PAGE_2 = """Assessment SAT
Test: Reading and Writing
Domain: Craft and Structure
Skill: Words in Context

Question
As used in the passage, the word notable most nearly means

A. ordinary
B. remarkable
C. hidden
D. brief

Correct Answer: B

Rationale
Choice B is correct because notable means worthy of attention.
"""


class ValidationTests(TestCase):
    def test_missing_answer_is_error(self):
        (q,) = parse_pages([
            "Test: Reading and Writing\nQuestion\nWhich choice is best?\nA. one\nB. two\nRationale\nIt is two.\n"
        ])
        status, messages = validate_parsed(q)
        self.assertEqual(status, ImportCandidate.Validation.ERROR)
        self.assertTrue(any("correct answer" in m.lower() for m in messages))

    def test_truncated_rationale_warns(self):
        (q,) = parse_pages([
            "Test: Reading and Writing\nQuestion\nPick one.\nA. x\nB. y\nCorrect Answer: A\n"
            "Rationale\nChoice A is correct because it is the only option that\n"
        ])
        status, messages = validate_parsed(q)
        self.assertEqual(status, ImportCandidate.Validation.WARNING)
        self.assertTrue(any("truncat" in m.lower() for m in messages))

    def test_math_is_excluded_by_policy(self):
        (q,) = parse_pages([PAGE_1])  # Test: Math
        status, messages = validate_parsed(q)
        self.assertEqual(status, ImportCandidate.Validation.ERROR)
        self.assertTrue(any("math" in m.lower() for m in messages))


class PipelineTests(TestCase):
    def test_batch_stage_and_promote_to_triage(self):
        batch = create_batch_from_pages([ENG_PAGE_1, ENG_PAGE_2], filename="sat_rw.pdf")
        self.assertEqual(batch.candidates.count(), 2)
        self.assertEqual(
            batch.candidates.filter(validation_status=ImportCandidate.Validation.VALID).count(), 2
        )

        promoted = promote_batch(batch)
        self.assertEqual(promoted, 2)
        # Promoted questions land in TRIAGE, unclassified, with provenance.
        self.assertEqual(BankQuestion.objects.count(), 2)
        self.assertEqual(BankQuestion.objects.filter(status=QuestionStatus.TRIAGE).count(), 2)
        self.assertEqual(BankQuestion.objects.filter(domain__isnull=True).count(), 2)
        q = BankQuestion.objects.first()
        self.assertEqual(q.source_type, "PDF_IMPORT")
        self.assertEqual(q.source_reference, "sat_rw.pdf")

    def test_math_batch_is_not_promoted(self):
        batch = create_batch_from_pages([PAGE_1, PAGE_2], filename="sat_math.pdf")
        # Both Math candidates are excluded by policy → none promotable.
        self.assertEqual(
            batch.candidates.filter(validation_status=ImportCandidate.Validation.ERROR).count(), 2
        )
        self.assertEqual(promote_batch(batch), 0)
        self.assertEqual(BankQuestion.objects.count(), 0)

    def test_duplicate_detection_against_existing_bank(self):
        batch1 = create_batch_from_pages([ENG_PAGE_1, ENG_PAGE_2])
        promote_batch(batch1)
        # Re-import the same PDF → all candidates flagged DUPLICATE.
        batch2 = create_batch_from_pages([ENG_PAGE_1, ENG_PAGE_2])
        dups = batch2.candidates.filter(validation_status=ImportCandidate.Validation.DUPLICATE).count()
        self.assertEqual(dups, 2)
        # Promoting the duplicate batch creates no new bank rows.
        before = BankQuestion.objects.count()
        promote_batch(batch2)
        self.assertEqual(BankQuestion.objects.count(), before)

    def test_idempotent_promotion(self):
        batch = create_batch_from_pages([ENG_PAGE_1, ENG_PAGE_2])
        promote_batch(batch)
        n = BankQuestion.objects.count()
        promote_batch(batch)  # again
        self.assertEqual(BankQuestion.objects.count(), n)
