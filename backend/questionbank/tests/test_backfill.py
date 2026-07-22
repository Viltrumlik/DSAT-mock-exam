from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from assessments.models import AssessmentQuestion, AssessmentSet
from exams.models import Question
from questionbank.models import BankQuestion, QuestionStatus

User = get_user_model()


class BackfillTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="qbtest", email="qb@test.local")
        call_command("seed_question_bank_taxonomy")

        # exam MC
        Question.objects.create(
            question_type="READING", question_text="The author implies that...",
            option_a="X", option_b="Y", option_c="Z", option_d="W",
            correct_answers="B", explanation="B is right", score=10,
        )
        # exam math-input
        Question.objects.create(
            question_type="MATH", question_text="Solve 2x=4", is_math_input=True,
            correct_answers="2, 2.0", explanation="x=2", score=10,
        )
        # duplicate of the MC (same normalized content) -> should dedup
        Question.objects.create(
            question_type="READING", question_text="the author IMPLIES that...",
            option_a="X", option_b="Y", option_c="Z", option_d="W", correct_answers="b", score=5,
        )
        # assessment MC with a real category -> advisory suggestion
        aset = AssessmentSet.objects.create(
            subject="math", category="Algebra › Linear functions", title="Algebra Set", created_by=cls.user,
        )
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=0, prompt="What is the slope?", question_type="multiple_choice",
            choices=[{"id": "A", "text": "1"}, {"id": "B", "text": "2"}], correct_answer="A",
            points=1, explanation="slope is 1",
        )

    def test_dry_run_commits_nothing(self):
        call_command("backfill_question_bank", "--dry-run")
        self.assertEqual(BankQuestion.objects.count(), 0)
        self.assertFalse(Question.objects.exclude(bank_question__isnull=True).exists())

    def test_backfill_creates_links_dedups_and_lands_in_triage(self):
        call_command("backfill_question_bank")

        # 3 exam questions but 2 are duplicates -> 2 unique exam bank rows; +1 assessment = 3 bank rows
        self.assertEqual(BankQuestion.objects.count(), 3)

        # Everything lands in TRIAGE with NO fabricated taxonomy.
        self.assertEqual(BankQuestion.objects.filter(status=QuestionStatus.TRIAGE).count(), 3)
        self.assertEqual(BankQuestion.objects.filter(domain__isnull=False).count(), 0)
        self.assertEqual(BankQuestion.objects.filter(skill__isnull=False).count(), 0)

        # All consumer rows linked, both duplicate exam rows share the same bank row.
        self.assertFalse(Question.objects.filter(bank_question__isnull=True).exists())
        dup_a = Question.objects.get(correct_answers="B")
        dup_b = Question.objects.get(correct_answers="b")
        self.assertEqual(dup_a.bank_question_id, dup_b.bank_question_id)

        # Math question mapped to STUDENT_PRODUCED with list correct answer.
        math_bank = BankQuestion.objects.get(source_reference__startswith="exams.Question", question_type="STUDENT_PRODUCED")
        self.assertEqual(math_bank.correct_answer, ["2", "2.0"])

        # Assessment question carries ADVISORY suggestion but is NOT auto-classified.
        a_bank = BankQuestion.objects.get(source_type="MIGRATED_ASSESSMENT")
        self.assertIsNone(a_bank.domain_id)
        self.assertIsNotNone(a_bank.suggested_domain_id)
        self.assertEqual(a_bank.suggested_domain.name, "Algebra")
        self.assertEqual(a_bank.suggested_skill.name, "Linear functions")
        self.assertEqual(a_bank.suggestion_model, "migration:assessment_category")

    def test_backfill_is_idempotent(self):
        call_command("backfill_question_bank")
        n = BankQuestion.objects.count()
        call_command("backfill_question_bank")  # second run
        self.assertEqual(BankQuestion.objects.count(), n)  # no new rows
