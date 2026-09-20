"""Regression: publishing from the edit form must be a real publish, not just a status write.

The teacher panel's homework form has no dedicated publish call — it saves, and the button
decides whether the row goes out. That path used to write ``status`` alone, so a homework
published from the form carried no ``published_at`` and no ``due_at``. ``due_at`` is what
``rewards.tasks.settle_due_homework`` selects on (``due_at__lte=now, due_at__gte=since``), so
the class did the work and the sweep never found it to pay for.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class PublishViaUpdateTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("pvu_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="PVU",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            # A schedule is what makes a deadline computable at all — without a lesson time
            # homework_due_at returns None and this test would pass for the wrong reason.
            lesson_time="10:00",
            created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _draft(self, title="Draft HW", category=Assignment.CATEGORY_HOMEWORK):
        return Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.owner,
            title=title,
            instructions="do it",
            category=category,
            status=Assignment.STATUS_DRAFT,
            due_at=None,
        )

    def _url(self, a):
        return f"/api/classes/{self.classroom.id}/assignments/{a.id}/"

    def test_patching_status_published_gives_the_homework_a_deadline(self):
        a = self._draft()
        resp = self.client.patch(self._url(a), {"status": "PUBLISHED"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.status, Assignment.STATUS_PUBLISHED)
        self.assertIsNotNone(a.published_at, "publishing from the form must stamp published_at")
        self.assertIsNotNone(
            a.due_at,
            "no due_at means rewards.tasks.settle_due_homework never settles this homework",
        )

    def test_patching_status_draft_leaves_it_unpublished(self):
        # "Save as draft" on the edit form: the edits land, the class still sees nothing.
        a = self._draft()
        resp = self.client.patch(
            self._url(a), {"title": "Reworked", "status": "DRAFT"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.title, "Reworked")
        self.assertEqual(a.status, Assignment.STATUS_DRAFT)
        self.assertIsNone(a.published_at)
        self.assertIsNone(a.due_at)

    def test_editing_an_already_published_homework_keeps_its_first_deadline(self):
        # Not a transition, so the publish tail must not run again and re-date the deadline.
        a = self._draft()
        self.client.patch(self._url(a), {"status": "PUBLISHED"}, format="json")
        a.refresh_from_db()
        first_due, first_published = a.due_at, a.published_at

        resp = self.client.patch(
            self._url(a), {"title": "Typo fixed", "status": "PUBLISHED"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.due_at, first_due)
        self.assertEqual(a.published_at, first_published)

    def test_an_archived_homework_cannot_be_republished_by_a_save(self):
        """The edit form is not the door archived work comes back through.

        ``status`` is writable and the student queryset filters on it alone, so a PATCH
        carrying PUBLISHED over an ARCHIVED row would hand the whole class last term's
        homework — keeping its stale ``archived_at``, and skipping ``_open_to_class``,
        because the publish tail only fires on the DRAFT transition. So the launcher on a
        pastpaper homework would be dead on arrival. Unarchive is the action that does this
        properly; the refusal has to name it.
        """
        a = self._draft(title="Last term")
        self.client.patch(self._url(a), {"status": "PUBLISHED"}, format="json")
        self.client.post(f"{self._url(a)}archive/", {}, format="json")
        a.refresh_from_db()
        self.assertEqual(a.status, Assignment.STATUS_ARCHIVED)
        archived_at = a.archived_at

        resp = self.client.patch(
            self._url(a), {"title": "Typo fixed", "status": "PUBLISHED"}, format="json"
        )

        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("Unarchive", resp.json()["detail"])
        a.refresh_from_db()
        self.assertEqual(a.status, Assignment.STATUS_ARCHIVED)
        self.assertEqual(a.archived_at, archived_at)
        # And the edit that rode along with it did not land either — a refusal is not a
        # partial save.
        self.assertEqual(a.title, "Last term")

    def test_editing_archived_homework_without_touching_its_status_still_saves(self):
        """The guard is about republishing, not about editing. A typo fix must still work."""
        a = self._draft(title="Last term")
        self.client.patch(self._url(a), {"status": "PUBLISHED"}, format="json")
        self.client.post(f"{self._url(a)}archive/", {}, format="json")

        resp = self.client.patch(self._url(a), {"title": "Last term (fixed)"}, format="json")

        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.title, "Last term (fixed)")
        self.assertEqual(a.status, Assignment.STATUS_ARCHIVED)

    def test_publishing_classwork_from_the_form_still_has_no_deadline(self):
        # Classwork is done in the lesson and is paid by a teacher's hand. A deadline would
        # quietly enrol it in the automatic sweep — the same rule create() and publish() keep.
        a = self._draft(title="In-class work", category=Assignment.CATEGORY_CLASSWORK)
        resp = self.client.patch(self._url(a), {"status": "PUBLISHED"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        a.refresh_from_db()
        self.assertEqual(a.status, Assignment.STATUS_PUBLISHED)
        self.assertIsNone(a.due_at)
