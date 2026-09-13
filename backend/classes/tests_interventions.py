"""The teacher's intervention signals: what counts as turned in, and which students count.

``GET /api/classes/<pk>/interventions/`` feeds the teacher portal: Submission rate, Class health,
"Students needing support" ("N missing"), Lagging submissions, and the at-risk and "% turned in"
figures on the analytics pages. Those pages read any error as "no data", so every defect here
showed up as a wrong number or a missing class, never as an error. Each class below pins one.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from assessments.models import AssessmentAttempt, AssessmentResult, AssessmentSet, HomeworkAssignment
from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()


class InterventionsFixture(TestCase):
    """A math class with its teacher, one student, and one published homework that is past due."""

    def setUp(self):
        self.teacher = User.objects.create_user(
            "iv_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.classroom = Classroom.objects.create(
            name="Interventions", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        self.student = self._student("iv_done@t.com")
        # Past due, so anyone who has not turned it in is overdue.
        self.homework = self._homework("Essay")
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _student(self, email, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(email, "secret123", role=C.ROLE_STUDENT)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT, status=status
        )
        return user

    def _homework(self, title, status=Assignment.STATUS_PUBLISHED):
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=title,
            category=Assignment.CATEGORY_HOMEWORK, status=status,
            due_at=timezone.now() - timedelta(days=1),
            archived_at=timezone.now() if status == Assignment.STATUS_ARCHIVED else None,
        )

    def _submission(self, student, status):
        return Submission.objects.create(
            assignment=self.homework, student=student, status=status,
            submitted_at=None if status == Submission.STATUS_DRAFT else timezone.now(),
        )

    def _interventions(self):
        response = self.client.get(f"/api/classes/{self.classroom.id}/interventions/")
        self.assertEqual(response.status_code, 200)
        return response.json()

    @staticmethod
    def _overdue_ids(data):
        return [row["student_id"] for row in data["overdue_students"]]

    @staticmethod
    def _figures(data):
        """The figures the teacher portal reads off one response, as a single comparable value."""
        return {
            "student_count": data["class_stats"]["student_count"],
            "assignment_count": data["class_stats"]["assignment_count"],
            "overall_completion_pct": data["class_stats"]["overall_completion_pct"],
            # assignment_id → (turned in, out of, %)
            "completion": {
                row["assignment_id"]: (row["submitted_count"], row["student_count"], row["completion_pct"])
                for row in data["completion_summary"]
            },
            "overdue_count": {row["student_id"]: row["overdue_count"] for row in data["overdue_students"]},
            "inactive": sorted(row["student_id"] for row in data["inactive_students"]),
        }


class InterventionsTurnInTests(InterventionsFixture):
    """A homework the student turned in must read as turned in.

    The view tested ``Submission.status`` against lowercase ``("submitted", "reviewed",
    "returned")``, but ``Submission`` stores its statuses UPPERCASE. No classroom submission ever
    matched: every file, past-paper and practice homework read 0% turned in, and a past-due one
    listed every student in the class as missing it. Only assessment homework counted, because
    ``AssessmentAttempt`` statuses really are lowercase.
    """

    def test_a_submitted_homework_is_complete(self):
        self._submission(self.student, Submission.STATUS_SUBMITTED)

        data = self._interventions()

        (row,) = data["completion_summary"]
        self.assertEqual(row["assignment_id"], self.homework.id)
        self.assertEqual(row["submitted_count"], 1)
        self.assertEqual(row["completion_pct"], 100.0)
        self.assertEqual(data["class_stats"]["overall_completion_pct"], 100.0)
        self.assertNotIn(self.student.id, self._overdue_ids(data))

    def test_only_the_student_who_has_not_turned_it_in_is_overdue(self):
        # Without a student who really is overdue, an empty list would prove nothing.
        missing = self._student("iv_missing@t.com")
        self._submission(self.student, Submission.STATUS_SUBMITTED)

        data = self._interventions()

        self.assertEqual(self._overdue_ids(data), [missing.id])
        self.assertEqual(data["completion_summary"][0]["completion_pct"], 50.0)
        self.assertEqual(data["class_stats"]["overall_completion_pct"], 50.0)

    def test_graded_and_returned_work_is_still_turned_in(self):
        # RETURNED is "returned for revision": the student turned it in and the teacher sent it
        # back. The gradebook calls that NEEDS_REVISION, not MISSING, so a teacher returning work
        # must not put the student back on the missing list.
        submission = self._submission(self.student, Submission.STATUS_REVIEWED)
        for status in (Submission.STATUS_REVIEWED, Submission.STATUS_RETURNED):
            with self.subTest(status=status):
                Submission.objects.filter(pk=submission.pk).update(status=status)

                data = self._interventions()

                self.assertEqual(data["completion_summary"][0]["completion_pct"], 100.0)
                self.assertEqual(data["class_stats"]["overall_completion_pct"], 100.0)
                self.assertNotIn(self.student.id, self._overdue_ids(data))

    def test_a_draft_is_not_turned_in(self):
        self._submission(self.student, Submission.STATUS_DRAFT)

        data = self._interventions()

        self.assertEqual(data["completion_summary"][0]["completion_pct"], 0.0)
        self.assertEqual(data["class_stats"]["overall_completion_pct"], 0.0)
        self.assertEqual(self._overdue_ids(data), [self.student.id])


class InterventionsStudentsTests(InterventionsFixture):
    """Only the students in the class count: ACTIVE memberships.

    The student query had no status filter. Removal is a soft delete (``status=REMOVED``), so a
    student taken off the class stayed in every denominator, on the missing and inactive lists and
    in the class average. This is the bug #125 fixed for the ops directory's student count. An
    INVITED student has not joined yet, and is not told about new homework either. The classroom's
    student count, the gradebook and class analytics already count ACTIVE students only.
    """

    def test_removed_and_invited_students_are_not_counted(self):
        missing = self._student("iv_missing@t.com")
        # Turned the essay in, then left: out of the "turned in" count as well as the class size.
        left = self._student("iv_left@t.com", status=ClassroomMembership.STATUS_REMOVED)
        self._student("iv_removed@t.com", status=ClassroomMembership.STATUS_REMOVED)
        self._student("iv_invited@t.com", status=ClassroomMembership.STATUS_INVITED)
        self._submission(self.student, Submission.STATUS_SUBMITTED)
        self._submission(left, Submission.STATUS_SUBMITTED)

        data = self._interventions()

        self.assertEqual(
            self._figures(data),
            {
                "student_count": 2,
                "assignment_count": 1,
                "overall_completion_pct": 50.0,
                "completion": {self.homework.id: (1, 2, 50.0)},
                "overdue_count": {missing.id: 1},
                "inactive": [missing.id],
            },
        )

    def test_a_removed_students_score_leaves_the_class_average(self):
        # A low scorer still in the class, so the list below cannot pass by being empty.
        struggling = self._student("iv_struggling@t.com")
        left = self._student("iv_left@t.com", status=ClassroomMembership.STATUS_REMOVED)
        assessment = HomeworkAssignment.objects.create(
            classroom=self.classroom, assignment=self.homework, assigned_by=self.teacher,
            assessment_set=AssessmentSet.objects.create(
                subject=AssessmentSet.SUBJECT_MATH, category="Algebra", title="Linear equations",
                source=AssessmentSet.SOURCE_MATHBOOK, level=AssessmentSet.LEVEL_JUNIOR,
                created_by=self.teacher,
            ),
        )
        for student, percent in ((self.student, 90), (struggling, 50), (left, 10)):
            attempt = AssessmentAttempt.objects.create(
                homework=assessment, student=student,
                status=AssessmentAttempt.STATUS_GRADED, submitted_at=timezone.now(),
            )
            AssessmentResult.objects.create(attempt=attempt, percent=percent)

        data = self._interventions()

        self.assertEqual(data["class_stats"]["avg_assessment_score_pct"], 70.0)
        self.assertEqual(
            [(row["student_id"], row["avg_score_pct"]) for row in data["low_score_students"]],
            [(struggling.id, 50.0)],
        )
