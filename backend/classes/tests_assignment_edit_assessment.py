"""Editing an assignment must reconcile its attached assessments.

Regression: AssignmentViewSet.update() historically ignored assessment_set_ids, so a
teacher who edited an assignment to add/change an assessment saw nothing happen. update()
now attaches newly-selected sets and detaches de-selected ones — but never deletes a
homework a student has already started (attempts CASCADE-delete with it).
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from assessments.models import AssessmentAttempt, AssessmentSet
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class AssignmentEditAssessmentTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("ea_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Edit", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("ea_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        # Approved so the assign guard lets them attach — these tests cover
        # attach/detach mechanics, not the approval gate.
        self.set_a = AssessmentSet.objects.create(
            subject="math", title="Set A", source=AssessmentSet.SOURCE_MATHBOOK,
            level="junior", created_by=self.owner,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self.set_b = AssessmentSet.objects.create(
            subject="math", title="Set B", source=AssessmentSet.SOURCE_MATHBOOK,
            level="junior", created_by=self.owner,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _url(self):
        return f"/api/classes/{self.classroom.id}/assignments/{self.assignment.id}/"

    def _attached(self):
        return set(self.assignment.assessment_homeworks.values_list("assessment_set_id", flat=True))

    def test_edit_adds_assessment(self):
        self.assertEqual(self._attached(), set())
        resp = self.client.patch(self._url(), {"assessment_set_ids": [self.set_a.id]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._attached(), {self.set_a.id})

    def test_edit_swaps_assessment(self):
        self.client.patch(self._url(), {"assessment_set_ids": [self.set_a.id]}, format="json")
        resp = self.client.patch(self._url(), {"assessment_set_ids": [self.set_b.id]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._attached(), {self.set_b.id})

    def test_edit_removes_assessment_without_attempts(self):
        self.client.patch(self._url(), {"assessment_set_ids": [self.set_a.id]}, format="json")
        resp = self.client.patch(self._url(), {"assessment_set_ids": []}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._attached(), set())

    def test_edit_keeps_assessment_with_attempts(self):
        self.client.patch(self._url(), {"assessment_set_ids": [self.set_a.id]}, format="json")
        hw = self.assignment.assessment_homeworks.get(assessment_set=self.set_a)
        AssessmentAttempt.objects.create(homework=hw, student=self.student)
        resp = self.client.patch(self._url(), {"assessment_set_ids": []}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        # Not detached — the student has work that would be destroyed.
        self.assertEqual(self._attached(), {self.set_a.id})

    def test_omitting_key_leaves_assessments_untouched(self):
        self.client.patch(self._url(), {"assessment_set_ids": [self.set_a.id]}, format="json")
        resp = self.client.patch(self._url(), {"title": "HW renamed"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._attached(), {self.set_a.id})
