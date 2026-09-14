"""The order of a class's assignment list, ``GET /api/classes/{id}/assignments/``.

Newest GIVEN first. A homework is given when it is published, but most homework never records
that moment: it is created straight as PUBLISHED, so ``published_at`` stays NULL and
``created_at`` stands in for it. Two rows given at the same moment put the higher id first.
Both branches of ``AssignmentViewSet.get_queryset`` sort this way: the teaching team's list,
and a student's, which is the same list without drafts.

Nothing downstream re-sorts, so this order is a contract:

- ``features/teacher/useGradebook.ts`` keeps the first 12 rows as the class's 12 newest
  homework, and a student's Trend depends on which end of those columns is the newest;
- ``features/teacher/useGradingQueue.ts`` keeps the first 12 rows of each class.

A frontend test mocks this list with rows already in order, so it cannot see a change here: the 12
homework the gradebook keeps, and the direction of every Trend, would change with nothing going
red. So the order is pinned here, for a teacher and for a student:

1. with nothing published through the action, the newest ``created_at`` comes first;
2. publishing an old draft floats it to the top, while a homework published a week ago still
   sits below one set yesterday;
3. two rows given at the same moment put the higher id first, even when one row's date is a
   ``published_at`` and the other's is a ``created_at``.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class AssignmentListOrderTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(
            "order_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.student = User.objects.create_user("order_student@t.com", "secret123", role=C.ROLE_STUDENT)
        self.classroom = Classroom.objects.create(
            name="Order", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.teacher
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.now = timezone.now()

    def _homework(self, title, *, days_ago, status=Assignment.STATUS_PUBLISHED):
        """A homework created ``days_ago`` days back. ``created_at`` is auto_now_add, so the date
        is written after the insert: each test decides the insert order, and so the ids."""
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=title,
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=status,
        )
        Assignment.objects.filter(pk=a.pk).update(created_at=self.now - timedelta(days=days_ago))
        return a

    def _titles(self, user):
        self.client.force_authenticate(user)
        resp = self.client.get(f"/api/classes/{self.classroom.id}/assignments/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        rows = data["items"] if isinstance(data, dict) else data
        return [r["title"] for r in rows]

    def _assert_order(self, *, teacher, student):
        for viewer, user, expected in (("teacher", self.teacher, teacher), ("student", self.student, student)):
            with self.subTest(viewer=viewer):
                self.assertEqual(self._titles(user), expected)

    def test_newest_created_first_when_nothing_went_through_publish(self):
        # Inserted out of date order, so neither the ids nor the insert order line up with the
        # dates, in either direction.
        self._homework("Set two days ago", days_ago=2)
        self._homework("Set yesterday", days_ago=1)
        self._homework("Set three days ago", days_ago=3)

        expected = ["Set yesterday", "Set two days ago", "Set three days ago"]
        self._assert_order(teacher=expected, student=expected)

    def test_publishing_an_old_draft_floats_it_to_the_top(self):
        draft = self._homework("Drafted ten days ago", days_ago=10, status=Assignment.STATUS_DRAFT)
        self._homework("Set three days ago", days_ago=3)
        self._homework("Set yesterday", days_ago=1)
        # Until it is published the teacher finds the draft by the day it was drafted, and a
        # student does not see it at all.
        self._assert_order(
            teacher=["Set yesterday", "Set three days ago", "Drafted ten days ago"],
            student=["Set yesterday", "Set three days ago"],
        )

        self.client.force_authenticate(self.teacher)
        resp = self.client.post(f"/api/classes/{self.classroom.id}/assignments/{draft.id}/publish/")
        self.assertEqual(resp.status_code, 200)
        draft.refresh_from_db()
        # Its created_at is untouched: the published_at the action stamped is what lifts it.
        self.assertEqual(draft.created_at, self.now - timedelta(days=10))
        self.assertIsNotNone(draft.published_at)

        expected = ["Drafted ten days ago", "Set yesterday", "Set three days ago"]
        self._assert_order(teacher=expected, student=expected)

    def test_a_homework_published_last_week_stays_below_one_set_yesterday(self):
        # ``published_at`` says WHEN a homework was given, not that it ranks higher. A row that has
        # one must not jump ahead of newer homework that went out without one, which on production
        # is nearly all of it.
        published = self._homework("Drafted last month, published last week", days_ago=30)
        Assignment.objects.filter(pk=published.pk).update(published_at=self.now - timedelta(days=7))
        self._homework("Set two weeks ago", days_ago=14)
        self._homework("Set yesterday", days_ago=1)

        expected = ["Set yesterday", "Drafted last month, published last week", "Set two weeks ago"]
        self._assert_order(teacher=expected, student=expected)

    def test_the_same_given_moment_puts_the_higher_id_first(self):
        first = self._homework("Made first", days_ago=2)
        second = self._homework("Made second", days_ago=2)
        # Created a week earlier but published at the very moment the other two were created, so
        # the three tie on the date the list sorts by, and on neither column alone.
        third = self._homework("Made third, published at that moment", days_ago=9)
        Assignment.objects.filter(pk=third.pk).update(published_at=self.now - timedelta(days=2))
        self.assertLess(first.pk, second.pk)
        self.assertLess(second.pk, third.pk)

        expected = ["Made third, published at that moment", "Made second", "Made first"]
        self._assert_order(teacher=expected, student=expected)
