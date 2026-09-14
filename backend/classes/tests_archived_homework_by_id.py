"""The teaching team edits and deletes archived work by id.

``AssignmentViewSet.get_queryset`` leaves ARCHIVED work out of what it gives the teaching team unless the
request says ``include_archived``. That is the Assignments tab's "Show archived" switch, a rule for the
LIST. The by-id routes went through the same queryset, so on every archived row Edit and Delete answered
404: the edit page failed at load, and Delete said "No Assignment matches the given query." and left the
row. Only Unarchive worked, because it looks the homework up itself.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class ArchivedWorkByIdTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("byid_owner@t.com", "secret123")
        self.teacher = User.objects.create_user("byid_teacher@t.com", "secret123")
        self.ta = User.objects.create_user("byid_ta@t.com", "secret123")
        self.student = User.objects.create_user("byid_student@t.com", "secret123")
        self.classroom = self._classroom("Middle G13")
        for user, role in (
            (self.owner, ClassroomMembership.ROLE_OWNER),
            (self.teacher, ClassroomMembership.ROLE_TEACHER),
            (self.ta, ClassroomMembership.ROLE_TA),
            (self.student, ClassroomMembership.ROLE_STUDENT),
        ):
            ClassroomMembership.objects.create(classroom=self.classroom, user=user, role=role)
        self.homework = self._archived("Unit 3 review")
        self.client = APIClient()

    def _classroom(self, name):
        return Classroom.objects.create(
            name=name, subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.owner
        )

    def _archived(self, title, classroom=None, category=Assignment.CATEGORY_HOMEWORK):
        return Assignment.objects.create(
            classroom=classroom or self.classroom, created_by=self.owner, title=title, instructions="Chapter 3.",
            category=category, max_score=100, status=Assignment.STATUS_ARCHIVED,
        )

    def _url(self, assignment):
        return f"/api/classes/{self.classroom.id}/assignments/{assignment.id}/"

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def test_the_edit_page_gets_an_archived_homework_without_asking_for_archived_work(self):
        for user in (self.owner, self.teacher, self.ta):
            with self.subTest(user=user.email):
                resp = self._as(user).get(self._url(self.homework))

                self.assertEqual(resp.status_code, 200, resp.content)
                self.assertEqual(resp.json()["status"], Assignment.STATUS_ARCHIVED)

    def test_the_teaching_team_saves_an_edit_and_the_homework_stays_archived(self):
        edits = (
            (self.owner, "Unit 3 review (owner)"),
            (self.teacher, "Unit 3 review (teacher)"),
            (self.ta, "Unit 3 review (TA)"),
        )
        for user, title in edits:
            with self.subTest(user=user.email):
                resp = self._as(user).patch(self._url(self.homework), {"title": title}, format="json")

                self.assertEqual(resp.status_code, 200, resp.content)
                self.homework.refresh_from_db()
                self.assertEqual(self.homework.title, title)
                self.assertEqual(self.homework.status, Assignment.STATUS_ARCHIVED)

    def test_a_full_update_finds_it_too(self):
        resp = self._as(self.owner).put(
            self._url(self.homework), {"title": "Unit 3 review, again", "instructions": "Chapter 3 and 4."}, format="json"
        )

        self.assertEqual(resp.status_code, 200, resp.content)
        self.homework.refresh_from_db()
        self.assertEqual((self.homework.title, self.homework.status), ("Unit 3 review, again", Assignment.STATUS_ARCHIVED))

    def test_an_owner_or_a_teacher_deletes_an_archived_homework(self):
        for user in (self.owner, self.teacher):
            with self.subTest(user=user.email):
                homework = self._archived(f"Old homework for {user.email}")

                resp = self._as(user).delete(self._url(homework))

                self.assertEqual(resp.status_code, 204, resp.content)
                self.assertFalse(Assignment.objects.filter(pk=homework.pk).exists())

    def test_a_ta_still_cannot_delete_it(self):
        resp = self._as(self.ta).delete(self._url(self.homework))

        # The capability check answers now, not a missing row: a TA archives instead.
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertTrue(Assignment.objects.filter(pk=self.homework.pk).exists())

    def test_archived_classwork_is_edited_and_deleted_the_same_way(self):
        classwork = self._archived("Lesson 12 classwork", category=Assignment.CATEGORY_CLASSWORK)
        client = self._as(self.owner)

        self.assertEqual(client.patch(self._url(classwork), {"title": "Lesson 12"}, format="json").status_code, 200)
        self.assertEqual(client.delete(self._url(classwork)).status_code, 204)
        self.assertFalse(Assignment.objects.filter(pk=classwork.pk).exists())

    def test_the_list_still_leaves_archived_work_out_unless_asked(self):
        published = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Unit 4", instructions="Chapter 4.",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        client = self._as(self.owner)
        list_url = f"/api/classes/{self.classroom.id}/assignments/"

        def ids(resp):
            body = resp.json()
            return {row["id"] for row in (body if isinstance(body, list) else body["items"])}

        self.assertEqual(ids(client.get(list_url)), {published.id})
        self.assertEqual(ids(client.get(list_url, {"include_archived": "1"})), {published.id, self.homework.id})

    def test_a_student_still_gets_nothing_by_id(self):
        client = self._as(self.student)

        self.assertEqual(client.get(self._url(self.homework)).status_code, 404)
        self.assertEqual(client.patch(self._url(self.homework), {"title": "Mine now"}, format="json").status_code, 404)
        self.assertEqual(client.delete(self._url(self.homework)).status_code, 404)
        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "Unit 3 review")

    def test_a_homework_of_another_class_is_not_found_through_this_class(self):
        elsewhere = self._archived("Unit 3 review", classroom=self._classroom("Middle G14"))
        client = self._as(self.owner)

        self.assertEqual(client.patch(self._url(elsewhere), {"title": "Moved"}, format="json").status_code, 404)
        self.assertEqual(client.delete(self._url(elsewhere)).status_code, 404)
        elsewhere.refresh_from_db()
        self.assertEqual(elsewhere.title, "Unit 3 review")
