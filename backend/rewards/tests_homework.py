"""Homework is one award for the whole bundle — the school's rule, and its worked example."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from assessments.models import (
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentResult,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from exams.models import PracticeTest, TestAttempt
from rewards.homework import bundle_percent, recompute_bundle
from rewards.models import PointAward
from rewards.services import balance
from vocabulary.models import VocabHomework, VocabSection, VocabSet, VocabStudySession

User = get_user_model()


def _u(email):
    return User.objects.create_user(email, "secret123")


class BundleFixture(TestCase):
    def setUp(self):
        self.teacher = _u("hw_t@t.com")
        self.classroom = Classroom.objects.create(
            name="Bundle", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = _u("hw_s@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, title="Week 1",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher,
        )
        self.section = VocabSection.objects.create(title="Bank", slug="bank")

    # ── builders ──────────────────────────────────────────────────────────────

    def add_assessment(self, title, *, questions=4):
        aset = AssessmentSet.objects.create(title=title, created_by=self.teacher)
        for i in range(questions):
            AssessmentQuestion.objects.create(
                assessment_set=aset, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
                correct_answer="A", points=1,
            )
        return HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=self.assignment, assigned_by=self.teacher,
        )

    def grade(self, homework, percent, *, answered=None):
        """A graded attempt. ``answered`` pins ``question_order`` — a shorter list is what a
        "retry incorrect only" sitting produces."""
        order = answered if answered is not None else list(
            homework.assessment_set.questions.values_list("id", flat=True)
        )
        attempt = AssessmentAttempt.objects.create(
            homework=homework, student=self.student,
            status=AssessmentAttempt.STATUS_GRADED,
            submitted_at=timezone.now(), question_order=order,
        )
        AssessmentResult.objects.create(
            attempt=attempt, score_points=percent, max_points=100, percent=percent
        )
        return attempt

    def add_vocab(self, title="Set 1"):
        vset = VocabSet.objects.create(section=self.section, title=title)
        VocabHomework.objects.create(
            classroom=self.classroom, assignment=self.assignment, vocab_set=vset
        )
        return vset

    def finish_vocab(self, vset):
        VocabStudySession.objects.create(
            user=self.student, vocab_set=vset, mode="flashcards",
            completed_at=timezone.now(),
        )

    def add_pastpaper(self, sections=1):
        tests = [
            PracticeTest.objects.create(subject="MATH", title=f"PP{i}", skip_default_modules=True)
            for i in range(sections)
        ]
        self.assignment.practice_test_ids = [t.id for t in tests]
        self.assignment.save(update_fields=["practice_test_ids"])
        return tests

    def sit(self, test, *, score=1200):
        return TestAttempt.objects.create(
            practice_test=test, student=self.student, score=score,
            is_completed=True, current_state=TestAttempt.STATE_COMPLETED,
            completed_at=timezone.now(),
        )

    def settle(self):
        return recompute_bundle(self.assignment, self.student)


class TheSchoolsWorkedExampleTests(BundleFixture):
    """2 assessments + 1 pastpaper + 1 vocabulary set; three done, one assessment untouched."""

    def test_three_of_four_items_is_seventy_five_percent_and_earns_five(self):
        done_assessment = self.add_assessment("A")
        self.add_assessment("B")                      # never attempted
        vocab = self.add_vocab()
        (paper,) = self.add_pastpaper()

        self.grade(done_assessment, 100)
        self.finish_vocab(vocab)
        self.sit(paper)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 75.0)
        self.settle()
        self.assertEqual(balance(self.student), 5)

    def test_a_partial_score_pulls_the_bundle_down_a_band(self):
        """Same three-of-four shape, but the completed assessment scored 60 rather than 100:
        (60 + 100 + 100 + 0) / 4 = 65% — still the 60–79 band."""
        done_assessment = self.add_assessment("A")
        self.add_assessment("B")
        vocab = self.add_vocab()
        (paper,) = self.add_pastpaper()

        self.grade(done_assessment, 60)
        self.finish_vocab(vocab)
        self.sit(paper)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 65.0)
        self.settle()
        self.assertEqual(balance(self.student), 5)


class BandTests(BundleFixture):
    def test_everything_finished_perfectly_earns_fifteen(self):
        a = self.add_assessment("A")
        vocab = self.add_vocab()
        self.grade(a, 100)
        self.finish_vocab(vocab)

        self.settle()
        self.assertEqual(balance(self.student), 15)

    def test_eighty_earns_ten(self):
        a = self.add_assessment("A")
        self.grade(a, 80)
        self.settle()
        self.assertEqual(balance(self.student), 10)

    def test_under_sixty_earns_nothing_at_all(self):
        a = self.add_assessment("A")
        self.grade(a, 59)
        self.settle()

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(PointAward.objects.count(), 0)   # no row, not a zero row

    def test_an_untouched_bundle_earns_nothing(self):
        self.add_assessment("A")
        self.settle()
        self.assertEqual(balance(self.student), 0)

    def test_a_bundle_with_nothing_scoreable_is_skipped_rather_than_scored_zero(self):
        """An announcement-only assignment was never work to do."""
        self.assertIsNone(bundle_percent(self.assignment, self.student))
        self.settle()
        self.assertEqual(PointAward.objects.count(), 0)


class AntiFarmingTests(BundleFixture):
    def test_a_retry_over_a_subset_of_questions_is_ignored(self):
        """"Retry incorrect only" mints an attempt over a SUBSET whose percent is measured
        against that subset. Answering the one remaining question reads as 100% — the easiest
        way to farm the whole system."""
        a = self.add_assessment("A", questions=4)
        self.grade(a, 50)                       # full-length sitting
        self.grade(a, 100, answered=[1])        # one-question retry

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 50.0)
        self.settle()
        self.assertEqual(balance(self.student), 0)   # 50% earns nothing

    def test_the_best_full_attempt_wins_not_the_latest(self):
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.grade(a, 20)     # a later, worse sitting must not lower a banked award

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_an_attempt_with_no_recorded_order_still_counts(self):
        """Blank ``question_order`` means "not recorded", not "zero questions". Treating it as
        a subset would silently discard a student's only real attempt."""
        a = self.add_assessment("A")
        self.grade(a, 100, answered=[])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_repeated_settling_never_stacks_a_second_award(self):
        a = self.add_assessment("A")
        self.grade(a, 100)
        for _ in range(5):
            self.settle()

        self.assertEqual(balance(self.student), 15)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)


class CorrectionTests(BundleFixture):
    def test_finishing_another_item_raises_the_award_in_place(self):
        a = self.add_assessment("A")
        vocab = self.add_vocab()
        self.grade(a, 100)
        self.settle()
        self.assertEqual(balance(self.student), 0)     # (100 + 0) / 2 = 50% — below the band

        self.finish_vocab(vocab)
        self.settle()

        self.assertEqual(balance(self.student), 15)    # (100 + 100) / 2 = 100%
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)

    def test_dropping_below_the_band_takes_the_points_back(self):
        a = self.add_assessment("A")
        result = self.grade(a, 100)
        self.settle()
        self.assertEqual(balance(self.student), 15)

        AssessmentResult.objects.filter(attempt=result).update(percent=10)
        self.settle()

        self.assertEqual(balance(self.student), 0)

    def test_draft_homework_is_never_scored(self):
        """Draft work has not been given to anyone. The academic leaderboard excludes drafts
        too, and a reward that disagreed with it about what "assigned" means is indefensible."""
        self.assignment.status = Assignment.STATUS_DRAFT
        self.assignment.save(update_fields=["status"])

        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()

        self.assertEqual(PointAward.objects.count(), 0)

    def test_unpublishing_does_not_confiscate_points_already_earned(self):
        """A deliberate asymmetry. Never-published work earns nothing, but work a student
        genuinely completed does not lose its points because a teacher later toggled the
        assignment back to draft."""
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.assertEqual(balance(self.student), 15)

        self.assignment.status = Assignment.STATUS_DRAFT
        self.assignment.save(update_fields=["status"])
        self.settle()

        self.assertEqual(balance(self.student), 15)


class ItemKindTests(BundleFixture):
    def test_a_pastpaper_needs_every_section_finished(self):
        first, second = self.add_pastpaper(sections=2)
        self.sit(first)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

        self.sit(second)
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_a_hand_in_counts_once_submitted_without_waiting_to_be_marked(self):
        """A student must not lose points to their teacher's marking backlog."""
        self.assignment.external_url = "https://example.com/worksheet"
        self.assignment.save(update_fields=["external_url"])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

        Submission.objects.create(
            assignment=self.assignment, student=self.student,
            status=Submission.STATUS_SUBMITTED, submitted_at=timezone.now(),
        )
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_the_award_records_the_classroom(self):
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()

        awarded = PointAward.objects.get(student=self.student)
        self.assertEqual(awarded.classroom_id, self.classroom.id)
        self.assertEqual(awarded.source_type, "assignment")
