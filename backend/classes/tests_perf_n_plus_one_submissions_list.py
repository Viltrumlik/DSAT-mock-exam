"""What the grading list costs, per student on it.

``GET /api/classes/<class>/assignments/<homework>/submissions/`` is the read behind the
teacher's grading screen and behind every column of the gradebook. It is a class-sized list —
one row per student — and a gradebook load asks for twelve of them.

``SubmissionSerializer.composed_grade`` was added to that row. It reaches for
``submission.assignment`` to ask whether the homework gives the teacher's mark a share of the
grade, and the queryset did not select the assignment: one extra query per row, on EVERY
homework, including the overwhelming majority that never opted in and get a null back. Twenty
students across a twelve-homework gradebook is 240 queries spent fetching a homework the view
is already holding.

The test pins the SHAPE, not a number. An absolute count moves whenever an unrelated field
lands on the row, and a test that hard-codes one is a test somebody eventually deletes. What
must not move is that the cost does not grow with the size of the class.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from assessments.models import AssessmentQuestion, AssessmentSet, HomeworkAssignment
from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()


class GradingListCostPerStudentTests(TestCase):
    """The same ordinary homework, read once for a small class and once for a larger one."""

    def setUp(self):
        self.teacher = User.objects.create_user("sq_teacher@t.com", "secret123")
        self.api = APIClient()
        self.api.force_authenticate(self.teacher)

    def _class_with(self, students: int, *, share: int | None = None) -> tuple[Classroom, Assignment]:
        classroom = Classroom.objects.create(
            name=f"SQ {students}",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="10:00",
            created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        assignment = Assignment.objects.create(
            classroom=classroom,
            created_by=self.teacher,
            title="Week 1",
            category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED,
            allow_file_upload=True,
            manual_grade_weight_percent=share,
        )
        if share is not None:
            # An opted-in homework has something on the automatic side to compose WITH;
            # without it the composition short-circuits and measures nothing.
            aset = AssessmentSet.objects.create(
                title="Set 1",
                subject="math",
                level="middle",
                created_by=self.teacher,
                review_status=AssessmentSet.STATUS_APPROVED,
            )
            AssessmentQuestion.objects.create(
                assessment_set=aset,
                order=0,
                prompt="Q0",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
                correct_answer="A",
                points=1,
            )
            HomeworkAssignment.objects.create(
                classroom=classroom,
                assessment_set=aset,
                assignment=assignment,
                assigned_by=self.teacher,
            )
        for i in range(students):
            student = User.objects.create_user(f"sq_s{students}_{i}@t.com", "secret123")
            ClassroomMembership.objects.create(
                classroom=classroom, user=student, role=ClassroomMembership.ROLE_STUDENT
            )
            Submission.objects.create(
                assignment=assignment, student=student, status=Submission.STATUS_SUBMITTED
            )
        return classroom, assignment

    def _queries_for(self, students: int, *, share: int | None = None) -> int:
        classroom, assignment = self._class_with(students, share=share)
        url = f"/api/classes/{classroom.id}/assignments/{assignment.id}/submissions/"
        with CaptureQueriesContext(connection) as ctx:
            resp = self.api.get(url)
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(len(resp.json()), students)
        return len(ctx)

    def test_the_list_does_not_cost_a_query_per_student(self):
        """Homework with no manual share — every row's composition is a null.

        Three students and eight students must cost the same. Before the assignment was
        selected with the row the difference was exactly five: one query per extra student,
        spent on a homework the view already held.
        """
        small = self._queries_for(3)
        large = self._queries_for(8)
        self.assertEqual(
            large,
            small,
            f"the grading list costs {large - small} more queries for 5 more students — "
            "something on the row is reaching back to the database once per student",
        )

    def test_an_opted_in_homework_stays_within_its_known_per_student_cost(self):
        """Homework that DID opt in — here the cost per student is real, and bounded.

        Composing one student's grade means reading what the engines recorded FOR THAT
        STUDENT, so unlike the list above this one cannot be flat: the work is genuinely
        per-student. What it must not do is quietly get worse.

        Measured here, on a homework carrying ONE assessment: 21 queries for 3 students, 41
        for 8 — 4 per student. The figure scales with the size of the bundle, because each
        attached assessment is another per-student read, so a four-assessment homework costs
        roughly four times that per student. That cost is real and it is not addressed here:
        batching it means teaching ``rewards.homework.bundle_items`` to read a whole class at
        once, which is a change to the points ledger and wants its own measurement.

        The ceiling is deliberately loose. It is not a target — it is a tripwire for a new
        loop appearing inside the composition, which is how the flat case above went wrong
        in the first place.
        """
        small = self._queries_for(3, share=20)
        large = self._queries_for(8, share=20)
        per_student = (large - small) / 5
        self.assertLessEqual(
            per_student,
            12,
            f"composing an opted-in homework now costs {per_student:.1f} queries per student "
            f"({small} for 3, {large} for 8) — something new is looping inside the composition",
        )
