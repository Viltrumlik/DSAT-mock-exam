"""A draft homework must stay out of the class stream until it is published.

The stream item used to be created the moment the row existed, with no status check, and
the stream query filters by classroom alone — so a student scrolling the class feed saw
homework the teacher had not finished writing. Everywhere else in the product a draft is
the teacher's own workbench (the homework list reads "Not published" and hides it), and the
feed is now the same: the entry appears when the work is published, and only once.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership, ClassroomStreamItem

User = get_user_model()


class DraftAssignmentStreamTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("sd_owner@t.com", "secret123")
        self.student = User.objects.create_user("sd_student@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="SD",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="10:00",
            created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.client = APIClient()

    def _mk(self, status_value, title="HW"):
        return Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.owner,
            title=title,
            instructions="do it",
            category=Assignment.CATEGORY_HOMEWORK,
            status=status_value,
        )

    def _items(self, a):
        return ClassroomStreamItem.objects.filter(
            stream_type=ClassroomStreamItem.TYPE_ASSIGNMENT, related_id=a.pk
        )

    def test_a_draft_makes_no_stream_item(self):
        a = self._mk(Assignment.STATUS_DRAFT)
        self.assertEqual(self._items(a).count(), 0)

    def test_a_student_does_not_see_a_draft_in_the_class_feed(self):
        draft = self._mk(Assignment.STATUS_DRAFT, title="Half-written")
        # The positive control. On an absence alone this test would pass on an empty page, a
        # 200 with no results, or a renamed payload key — it would be green for a feed that
        # shows the student nothing at all, which is not what it claims to prove.
        published = self._mk(Assignment.STATUS_PUBLISHED, title="Ready to do")
        self.client.force_authenticate(self.student)
        results = self.client.get(f"/api/classes/{self.classroom.pk}/stream/").json()["results"]
        titles = {
            r["assignment"]["title"] for r in results if r.get("assignment")
        }
        self.assertIn(published.title, titles, "the feed itself must be working for this to mean anything")
        self.assertNotIn(draft.title, titles)

    def test_publishing_a_draft_puts_it_in_the_feed(self):
        a = self._mk(Assignment.STATUS_DRAFT, title="Now ready")
        self.assertEqual(self._items(a).count(), 0)

        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f"/api/classes/{self.classroom.pk}/assignments/{a.pk}/publish/", {}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._items(a).count(), 1)

        self.client.force_authenticate(self.student)
        results = self.client.get(f"/api/classes/{self.classroom.pk}/stream/").json()["results"]
        titles = {r["assignment"]["title"] for r in results if r.get("assignment")}
        self.assertIn("Now ready", titles)

    def test_publishing_from_the_edit_form_puts_it_in_the_feed(self):
        # The teacher panel's form saves with status=PUBLISHED rather than calling publish/.
        a = self._mk(Assignment.STATUS_DRAFT, title="Saved live")
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(
            f"/api/classes/{self.classroom.pk}/assignments/{a.pk}/",
            {"status": "PUBLISHED"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._items(a).count(), 1)

    def test_publishing_twice_still_leaves_one_entry(self):
        a = self._mk(Assignment.STATUS_DRAFT)
        self.client.force_authenticate(self.owner)
        url = f"/api/classes/{self.classroom.pk}/assignments/{a.pk}/publish/"
        self.client.post(url, {}, format="json")
        self.client.post(url, {}, format="json")
        self.assertEqual(self._items(a).count(), 1)

    def test_work_created_already_published_still_reaches_the_feed(self):
        # The common path — Assignment.status defaults to PUBLISHED — must be unchanged.
        a = self._mk(Assignment.STATUS_PUBLISHED, title="Straight out")
        self.assertEqual(self._items(a).count(), 1)
