"""The leaderboard's homework completion: which homework it is measured against, and what counts as
turned in.

``GET /api/classes/<pk>/leaderboard/`` sends each student's ``homework_completion_rate_pct`` in
``homework_grade_leaderboard.rows``. The teacher portal showed it as the student's "Completion" on
the Students page, and a student under 40% is flagged "watch" ("N% turned in"). That page
(``/teacher/students``) was retired in the teacher rebuild; the figure still reaches a teacher
through /teacher/analytics and the classroom's own overview, so what it counts still matters.

It was the student's non-draft submissions in the class ÷ every assignment in the class:
- assessment homework is turned in as an ``AssessmentAttempt``, not a ``Submission``, so it never
  counted (on prod, 167 of the 335 published homework are assessments);
- drafts and archived homework stayed in the denominator;
- a homework given today, due next lesson, pulled every student down until they turned it in.

The rule now:
- the class's PUBLISHED homework (classwork is not homework);
- turned in = a SUBMITTED, REVIEWED or RETURNED submission, or a submitted or graded attempt on any
  of the homework's assessments, which is what the interventions endpoint counts as turned in;
- rate = turned in ÷ (turned in + missing), where missing is past its due date and not turned in,
  the interventions endpoint's "overdue". So a homework that is not due yet counts once the student
  turns it in, and never against them before that;
- null when there is nothing to measure yet, which the portal shows as "—".
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from assessments.models import AssessmentAttempt, AssessmentSet, HomeworkAssignment
from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()


class LeaderboardCompletionFixture(TestCase):
    """A math class with its teacher and one student; each test sets its own homework."""

    def setUp(self):
        self.teacher = User.objects.create_user(
            "lbc_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.classroom = Classroom.objects.create(
            name="Completion", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        self.student = self._student("lbc_student@t.com")
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _student(self, email):
        user = User.objects.create_user(email, "secret123", role=C.ROLE_STUDENT)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
        )
        return user

    def _homework(self, title, *, due_in_days=-1, status=Assignment.STATUS_PUBLISHED,
                  category=Assignment.CATEGORY_HOMEWORK):
        """Due ``due_in_days`` from now: negative is past due, ``None`` is no due date."""
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=title, category=category,
            status=status,
            due_at=None if due_in_days is None else timezone.now() + timedelta(days=due_in_days),
            archived_at=timezone.now() if status == Assignment.STATUS_ARCHIVED else None,
        )

    def _assessment(self, assignment):
        """An assessment on ``assignment``. A student turns it in by submitting an attempt."""
        return HomeworkAssignment.objects.create(
            classroom=self.classroom, assignment=assignment, assigned_by=self.teacher,
            assessment_set=AssessmentSet.objects.create(
                subject=AssessmentSet.SUBJECT_MATH, category="Algebra", title=f"{assignment.title} set",
                source=AssessmentSet.SOURCE_MATHBOOK, level=AssessmentSet.LEVEL_JUNIOR,
                created_by=self.teacher,
            ),
        )

    def _attempt(self, homework, student, status=AssessmentAttempt.STATUS_GRADED):
        turned_in = status in (AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED)
        return AssessmentAttempt.objects.create(
            homework=homework, student=student, status=status,
            submitted_at=timezone.now() if turned_in else None,
        )

    def _submission(self, assignment, student, status=Submission.STATUS_SUBMITTED):
        return Submission.objects.create(
            assignment=assignment, student=student, status=status,
            submitted_at=None if status == Submission.STATUS_DRAFT else timezone.now(),
        )

    def _board(self):
        response = self.client.get(f"/api/classes/{self.classroom.id}/leaderboard/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["homework_grade_leaderboard"]

    def _rows(self):
        return {row["user_id"]: row for row in self._board()["rows"]}

    def _completion(self, student):
        return self._rows()[student.id]["homework_completion_rate_pct"]


class AssessmentHomeworkTurnInTests(LeaderboardCompletionFixture):
    """Assessment homework is turned in as an attempt, and has to count as turned in."""

    def test_an_assessment_turned_in_as_an_attempt_counts(self):
        # Both are past due. The student took the quiz and skipped the essay; a classmate did neither,
        # so an attempt that counted for the whole class would show.
        quiz = self._homework("Linear equations quiz")
        self._attempt(self._assessment(quiz), self.student)
        self._homework("Essay")
        classmate = self._student("lbc_classmate@t.com")

        rows = self._rows()

        self.assertEqual(rows[self.student.id]["homework_completion_rate_pct"], 50.0)
        self.assertEqual(rows[self.student.id]["classwork_turn_in_count"], 1)
        self.assertEqual(rows[classmate.id]["homework_completion_rate_pct"], 0.0)
        self.assertEqual(rows[classmate.id]["classwork_turn_in_count"], 0)

    def test_an_attempt_waiting_for_its_grade_is_turned_in(self):
        quiz = self._homework("Linear equations quiz")
        self._attempt(self._assessment(quiz), self.student, AssessmentAttempt.STATUS_SUBMITTED)

        self.assertEqual(self._completion(self.student), 100.0)

    def test_an_attempt_in_progress_or_abandoned_is_not_turned_in(self):
        # The essay is turned in, so a figure that ignored attempts altogether would still read 50.
        self._submission(self._homework("Essay"), self.student)
        quiz = self._homework("Linear equations quiz")
        attempt = self._attempt(self._assessment(quiz), self.student, AssessmentAttempt.STATUS_IN_PROGRESS)
        for status in (AssessmentAttempt.STATUS_IN_PROGRESS, AssessmentAttempt.STATUS_ABANDONED):
            with self.subTest(status=status):
                AssessmentAttempt.objects.filter(pk=attempt.pk).update(status=status)

                self.assertEqual(self._completion(self.student), 50.0)

    def test_an_assessment_that_also_has_a_submission_counts_once(self):
        # Submitting an attempt on a homework with one assessment also writes its class submission
        # (``sync_assessment_submission``), so most assessment homework has both.
        quiz = self._homework("Linear equations quiz")
        self._attempt(self._assessment(quiz), self.student)
        self._submission(quiz, self.student, Submission.STATUS_REVIEWED)
        self._homework("Essay")

        row = self._rows()[self.student.id]

        self.assertEqual(row["homework_completion_rate_pct"], 50.0)
        self.assertEqual(row["classwork_turn_in_count"], 1)

    def test_a_homework_with_several_assessments_is_turned_in_once_any_of_them_is(self):
        # A bundle never gets a class submission from its attempts (``is_multi_content``), so the
        # attempt is the only record. The interventions endpoint counts the bundle as turned in on
        # the first submitted attempt, and this figure has to agree with it.
        bundle = self._homework("Unit test, two parts")
        part_one = self._assessment(bundle)
        self._assessment(bundle)
        self._attempt(part_one, self.student)
        self._homework("Essay")

        self.assertEqual(self._completion(self.student), 50.0)


class SubmissionTurnInTests(LeaderboardCompletionFixture):
    def test_submitted_reviewed_and_returned_work_is_turned_in_and_a_draft_is_not(self):
        submission = self._submission(self._homework("Essay"), self.student)
        for status, expected in (
            (Submission.STATUS_SUBMITTED, 100.0),
            (Submission.STATUS_REVIEWED, 100.0),
            # Returned for revision: the student turned it in and the teacher sent it back. The
            # gradebook calls that NEEDS_REVISION, not MISSING.
            (Submission.STATUS_RETURNED, 100.0),
            (Submission.STATUS_DRAFT, 0.0),
        ):
            with self.subTest(status=status):
                Submission.objects.filter(pk=submission.pk).update(status=status)

                self.assertEqual(self._completion(self.student), expected)


class WhichHomeworkCountsTests(LeaderboardCompletionFixture):
    def test_drafts_archived_homework_and_classwork_are_left_out(self):
        self._submission(self._homework("Essay"), self.student)
        # Nobody was asked to turn in a draft. Archived work is retired, turned in or not.
        self._homework("Unpublished essay", status=Assignment.STATUS_DRAFT)
        self._submission(self._homework("Last term's essay", status=Assignment.STATUS_ARCHIVED), self.student)
        # A past date on purpose: the category leaves it out, not a missing deadline.
        self._homework("Lesson 12 classwork", category=Assignment.CATEGORY_CLASSWORK)

        board = self._board()
        (row,) = [r for r in board["rows"] if r["user_id"] == self.student.id]

        self.assertEqual(row["homework_completion_rate_pct"], 100.0)
        self.assertEqual(row["classwork_turn_in_count"], 1)
        self.assertEqual(board["classwork_assignment_count"], 1)  # the legacy key counts that homework

    def test_homework_not_due_yet_counts_once_it_is_turned_in(self):
        this_week = self._homework("Essay", due_in_days=-2)
        next_week = self._homework("Next week's quiz", due_in_days=3)
        undated = self._homework("Reading log", due_in_days=None)
        self._submission(this_week, self.student)
        early = self._student("lbc_early@t.com")  # did next week's work and not this week's
        self._submission(next_week, early)
        ahead = self._student("lbc_ahead@t.com")
        for homework in (this_week, next_week, undated):
            self._submission(homework, ahead)
        behind = self._student("lbc_behind@t.com")

        rows = self._rows()

        self.assertEqual(rows[self.student.id]["homework_completion_rate_pct"], 100.0)
        self.assertEqual(rows[early.id]["homework_completion_rate_pct"], 50.0)
        self.assertEqual(rows[ahead.id]["homework_completion_rate_pct"], 100.0)
        self.assertEqual(rows[ahead.id]["classwork_turn_in_count"], 3)
        self.assertEqual(rows[behind.id]["homework_completion_rate_pct"], 0.0)

    def test_nothing_due_and_nothing_turned_in_is_no_rate_rather_than_zero(self):
        self.assertIsNone(self._completion(self.student))  # no homework at all

        # Only a homework given today. 0% would flag every student in the class as "watch".
        self._homework("Next week's quiz", due_in_days=3)

        row = self._rows()[self.student.id]
        self.assertIn("homework_completion_rate_pct", row)
        self.assertIsNone(row["homework_completion_rate_pct"])
        self.assertEqual(row["classwork_turn_in_count"], 0)
