"""The number a classroom row shows under a "Students" label must be the students.

The ops directory annotated a bare ``Count("memberships")``. That counted the teacher, every
support teacher and TA, and — because removal is a soft delete — every student who had ever
been removed. A class of two could read as five, right next to a Students button that opened
a list of two.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership

User = get_user_model()
DIRECTORY = "/api/classes/directory/"
MY_CLASSES = "/api/classes/"


class ClassroomStudentCountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("count_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user(
            "count_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.support = User.objects.create_user(
            "count_support@t.com", "secret123",
            role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH,
        )
        self.classroom = Classroom.objects.create(
            name="Counting 101", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin, teacher=self.teacher,
        )

        def member(user, role, status=ClassroomMembership.STATUS_ACTIVE):
            return ClassroomMembership.objects.create(
                classroom=self.classroom, user=user, role=role, status=status
            )

        # The teaching side of the room: neither is a student.
        member(self.teacher, ClassroomMembership.ROLE_TEACHER)
        member(self.support, ClassroomMembership.ROLE_TA)
        # Two students actually enrolled.
        for i in range(2):
            member(
                User.objects.create_user(f"count_s{i}@t.com", "secret123", role=C.ROLE_STUDENT),
                ClassroomMembership.ROLE_STUDENT,
            )
        # One who left. The row survives as a soft delete and must not be counted.
        member(
            User.objects.create_user("count_gone@t.com", "secret123", role=C.ROLE_STUDENT),
            ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.client.force_authenticate(self.admin)

    def _row(self, url):
        body = self.client.get(url).json()
        rows = body["results"] if isinstance(body, dict) and "results" in body else body
        return next(r for r in rows if r["id"] == self.classroom.id)

    def test_directory_counts_enrolled_students_only(self):
        self.assertEqual(self._row(DIRECTORY)["student_count"], 2)

    def test_directory_members_count_excludes_the_removed_student(self):
        # teacher + support teacher + 2 students; the removed row is a soft delete.
        self.assertEqual(self._row(DIRECTORY)["members_count"], 4)

    def test_the_two_counts_disagree_and_that_is_the_point(self):
        row = self._row(DIRECTORY)
        self.assertLess(row["student_count"], row["members_count"])

    def test_my_classes_reports_the_same_student_count(self):
        # The membership-scoped list feeds the student's and teacher's own class cards,
        # which carry the same "N students" label as the ops directory.
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.admin,
            role=ClassroomMembership.ROLE_ADMIN, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.assertEqual(self._row(MY_CLASSES)["student_count"], 2)

    def test_an_invited_student_is_not_yet_enrolled(self):
        # The roster the button opens filters to ACTIVE, so the number beside it must too.
        ClassroomMembership.objects.create(
            classroom=self.classroom,
            user=User.objects.create_user("count_inv@t.com", "secret123", role=C.ROLE_STUDENT),
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_INVITED,
        )
        self.assertEqual(self._row(DIRECTORY)["student_count"], 2)

    def test_a_classroom_with_no_students_reports_zero_not_null(self):
        empty = Classroom.objects.create(
            name="Nobody yet", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        body = self.client.get(DIRECTORY).json()
        rows = body["results"] if isinstance(body, dict) and "results" in body else body
        row = next(r for r in rows if r["id"] == empty.id)
        self.assertEqual(row["student_count"], 0)
