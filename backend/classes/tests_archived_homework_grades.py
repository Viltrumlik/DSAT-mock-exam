"""What an archived homework's page and its gradebook link rely on. No view changes with these tests.

The page asks for the homework with ``include_archived=1``, because the teaching team's queryset leaves
archived work out unless asked. The gradebook opens its grades by id, because the gradebook's list leaves
archived work out. A student who asks the same way still gets nothing, and a homework of another class
is not found. The frontend tests mock exactly these answers, so these tests keep the mocks honest.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership, Submission, SubmissionReview

User = get_user_model()


class ArchivedHomeworkGradesTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("arch_owner@t.com", "secret123")
        self.classroom = self._classroom("Middle G13")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("arch_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.homework = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Unit 3 review",
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=Assignment.STATUS_ARCHIVED,
        )
        submission = Submission.objects.create(
            assignment=self.homework, student=self.student, status=Submission.STATUS_REVIEWED
        )
        SubmissionReview.objects.create(submission=submission, teacher=self.owner, grade=80)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _classroom(self, name):
        return Classroom.objects.create(
            name=name, subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.owner
        )

    def _page_url(self):
        return f"/api/classes/{self.classroom.id}/assignments/{self.homework.id}/"

    def test_the_teaching_team_gets_an_archived_homework_when_the_page_asks_for_it(self):
        resp = self.client.get(self._page_url(), {"include_archived": "1"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], Assignment.STATUS_ARCHIVED)

    def test_a_student_who_asks_the_same_way_still_gets_nothing(self):
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get(self._page_url(), {"include_archived": "1"}).status_code, 404)

    def test_the_gradebook_opens_an_archived_homework_by_id_with_its_grades(self):
        base = f"/api/classes/{self.classroom.id}/gradebook"

        # The list leaves it out, which is why the link names the homework.
        self.assertEqual([row["id"] for row in self.client.get(f"{base}/").json()["assignments"]], [])
        resp = self.client.get(f"{base}/assignments/{self.homework.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["assignment"]["status"], Assignment.STATUS_ARCHIVED)
        self.assertEqual(
            [(row["status"], row["grade"]) for row in resp.json()["roster"]], [("GRADED", "80.00")]
        )

    def test_the_gradebook_does_not_find_a_homework_of_another_class(self):
        elsewhere = Assignment.objects.create(
            classroom=self._classroom("Middle G14"), created_by=self.owner, title="Unit 3 review",
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=Assignment.STATUS_ARCHIVED,
        )

        resp = self.client.get(f"/api/classes/{self.classroom.id}/gradebook/assignments/{elsewhere.id}/")
        self.assertEqual(resp.status_code, 404)
