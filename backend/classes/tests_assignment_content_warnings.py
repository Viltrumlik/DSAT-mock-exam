"""Re-assigning an assessment set the classroom already has must WARN, not go silent.

The picker used to keep an "Already given" set selectable (amber badge), as if a teacher
could hand the same set out again with the next homework. uniq_assessment_hw_classroom_set
makes that create() a no-op, and it was swallowed — so the teacher got a clean 201 for a
homework with NO assessment in it, whose instructions still promised one. The student saw
a bare "Upload work" card and nothing to open.

The constraint stands (health checks, the audit/repair commands and journals all rely on
it); what changes is that the skipped set is now reported back to the teacher.
"""
from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from assessments.models import AssessmentSet
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class ReassignAlreadyGivenSetTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("ag_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="AG", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.aset = AssessmentSet.objects.create(
            subject="english", title="sqb", source=AssessmentSet.SOURCE_MATHBOOK,
            level="junior", created_by=self.owner,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _create(self, title):
        r = self.client.post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {
                "title": title,
                "instructions": "do sqb",
                "category": Assignment.CATEGORY_HOMEWORK,
                "assessment_set_ids": json.dumps([self.aset.id]),
                "allow_file_upload": "true",
                "status": Assignment.STATUS_PUBLISHED,
            },
            format="multipart",
        )
        self.assertIn(r.status_code, (200, 201), getattr(r, "data", r.content))
        return r.data

    def test_second_homework_with_the_same_set_warns_instead_of_going_silent(self):
        """The classroom-scoped constraint still wins — but the teacher must be TOLD,
        instead of getting a clean 201 for a homework with no assessment in it."""
        first = self._create("Week 1")
        self.assertEqual(len(first["assessment_homeworks"]), 1, "first assign should work")
        self.assertNotIn("content_warnings", first, "a clean assign must not warn")

        second = self._create("Week 2")
        self.assertEqual(len(second["assessment_homeworks"]), 0)
        warnings = second.get("content_warnings") or []
        print("\n[2nd] content_warnings =", warnings)
        self.assertEqual(len(warnings), 1, "the skipped set must be reported to the teacher")
        self.assertIn("sqb", warnings[0])
        self.assertIn("already given", warnings[0])

    def test_edit_that_adds_an_already_given_set_also_warns(self):
        self._create("Week 1")
        blank = self.client.post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {"title": "Week 2", "instructions": "do sqb",
             "category": Assignment.CATEGORY_HOMEWORK, "status": Assignment.STATUS_PUBLISHED},
            format="multipart",
        )
        aid = blank.data["id"]
        r = self.client.patch(
            f"/api/classes/{self.classroom.id}/assignments/{aid}/",
            {"assessment_set_ids": [self.aset.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, getattr(r, "data", r.content))
        warnings = r.data.get("content_warnings") or []
        print("[edit] content_warnings =", warnings)
        self.assertEqual(len(warnings), 1)
        self.assertIn("sqb", warnings[0])

    def test_a_missing_set_is_reported_too(self):
        r = self.client.post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {"title": "Ghost", "instructions": "x", "category": Assignment.CATEGORY_HOMEWORK,
             "assessment_set_ids": json.dumps([999999]), "status": Assignment.STATUS_PUBLISHED},
            format="multipart",
        )
        self.assertIn(r.status_code, (200, 201), getattr(r, "data", r.content))
        warnings = r.data.get("content_warnings") or []
        print("[ghost] content_warnings =", warnings)
        self.assertEqual(len(warnings), 1)
        self.assertIn("no longer exists", warnings[0])
