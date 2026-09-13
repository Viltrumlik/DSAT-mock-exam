"""A homework the student turned in must read as turned in on the teacher's intervention signals.

``GET /api/classes/<pk>/interventions/`` tested ``Submission.status`` against lowercase
``("submitted", "reviewed", "returned")``, but ``Submission`` stores its statuses UPPERCASE. No
classroom submission ever matched: every file, past-paper and practice homework read 0% turned
in, and a past-due one listed every student in the class as missing it. Only assessment homework
counted, because ``AssessmentAttempt`` statuses really are lowercase.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()


class InterventionsTurnInTests(TestCase):
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
        self.homework = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="Essay",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            due_at=timezone.now() - timedelta(days=1),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _student(self, email):
        user = User.objects.create_user(email, "secret123", role=C.ROLE_STUDENT)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
        )
        return user

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
