"""How many of a class's students have turned a homework in: ``turned_in_count`` on the teaching
team's assignment list.

The grading hub (``/teacher/homework/grading``) showed "N missing" and "All in" as
``members_count - submissions_count``. ``submissions_count`` is ``Count("submissions")``: every row.
A row starts as DRAFT when a student first uploads a file, stays when work is RETURNED for revision,
and outlives the membership of a student who leaves the class, so all three read as turned in.

``turned_in_count`` counts what the grading page lists as submitted, SUBMITTED or REVIEWED, and only
for the class's ACTIVE students. Those are the students the class row's ``student_count`` counts, so
the hub can subtract one from the other. ``submissions_count`` keeps its meaning.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()
M = ClassroomMembership


class AssignmentTurnedInCountTests(TestCase):
    def setUp(self):
        def user(email):
            return User.objects.create_user(email, "secret123")

        def homework(classroom, title):
            return Assignment.objects.create(
                classroom=classroom, created_by=self.teacher, title=title,
                category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=Assignment.STATUS_PUBLISHED,
            )

        self.teacher = user("tic_teacher@t.com")
        self.ta = user("tic_ta@t.com")
        self.classroom = Classroom.objects.create(
            name="Algebra 2", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.teacher
        )
        M.objects.create(classroom=self.classroom, user=self.teacher, role=M.ROLE_TEACHER)
        M.objects.create(classroom=self.classroom, user=self.ta, role=M.ROLE_TA)
        self.worksheet = homework(self.classroom, "Worksheet")
        self.reading = homework(self.classroom, "Reading")

        # One active student in each state a submission can be in, and one who never started.
        self.students = {}
        for state in (
            Submission.STATUS_SUBMITTED,
            Submission.STATUS_REVIEWED,
            Submission.STATUS_DRAFT,
            Submission.STATUS_RETURNED,
            "NOT_STARTED",
        ):
            student = self.students[state] = user(f"tic_{state.lower()}@t.com")
            M.objects.create(classroom=self.classroom, user=student, role=M.ROLE_STUDENT)
            if state != "NOT_STARTED":
                Submission.objects.create(assignment=self.worksheet, student=student, status=state)

        # Turned it in, then moved to the evening group. Removal is a soft delete, and the
        # submission row stays with the homework.
        moved = user("tic_moved@t.com")
        M.objects.create(classroom=self.classroom, user=moved, role=M.ROLE_STUDENT, status=M.STATUS_REMOVED)
        evening = Classroom.objects.create(
            name="Algebra 2 (evening)", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_EVEN,
            created_by=self.teacher,
        )
        M.objects.create(classroom=evening, user=moved, role=M.ROLE_STUDENT)
        Submission.objects.create(assignment=self.worksheet, student=moved, status=Submission.STATUS_SUBMITTED)

        # Turned it in, then was made a TA from the roster. The row stays here too.
        promoted = user("tic_promoted@t.com")
        M.objects.create(classroom=self.classroom, user=promoted, role=M.ROLE_TA)
        Submission.objects.create(assignment=self.worksheet, student=promoted, status=Submission.STATUS_REVIEWED)

        self.client = APIClient()

    def _rows(self, who):
        """The class's assignment list as ``who`` receives it, by assignment id."""
        self.client.force_authenticate(who)
        resp = self.client.get(f"/api/classes/{self.classroom.id}/assignments/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        rows = body["results"] if isinstance(body, dict) else body
        return {row["id"]: row for row in rows}

    def test_counts_the_submitted_and_reviewed_work_of_active_students(self):
        row = self._rows(self.teacher)[self.worksheet.id]
        # SUBMITTED and REVIEWED. Not the draft, not the work returned for revision, not the
        # student who moved to the evening group, and not the student who is a TA now.
        self.assertEqual(row.get("turned_in_count"), 2)

    def test_reads_zero_for_homework_nobody_has_turned_in(self):
        self.assertEqual(self._rows(self.teacher)[self.reading.id].get("turned_in_count"), 0)

    def test_a_ta_gets_the_same_count(self):
        # TAs grade, and the hub lists their classes.
        self.assertEqual(self._rows(self.ta)[self.worksheet.id].get("turned_in_count"), 2)

    def test_submissions_count_still_counts_every_row(self):
        # Draft, returned, submitted, reviewed, the moved student's and the TA's: six rows. A count
        # that joined anything more would multiply this.
        rows = self._rows(self.teacher)
        self.assertEqual(rows[self.worksheet.id]["submissions_count"], 6)
        self.assertEqual(rows[self.reading.id]["submissions_count"], 0)

    def test_a_student_is_not_sent_the_class_count(self):
        row = self._rows(self.students[Submission.STATUS_SUBMITTED])[self.worksheet.id]
        self.assertNotIn("turned_in_count", row)
