"""Assessment review lifecycle: draft → needs_review → approved.

Covers the status-transition endpoint (submit / approve / send-back), the
approver-only gate on approval, approve-also-publishes, edit-resets-approved,
and the teacher assign guard that blocks not-yet-approved sets.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments.models import (
    AssessmentQuestion,
    AssessmentSet,
    AssessmentSetVersion,
    GovernanceEvent,
)
from classes.models import Classroom, ClassroomMembership

User = get_user_model()

_HOSTS = ("localhost", "127.0.0.1", "testserver", "admin.mastersat.uz", "questions.mastersat.uz")
# Assessment authoring writes (incl. the status transition endpoint) live on the
# `questions` console; homework assignment lives on the `admin`/teacher console.
_QHOST = "questions.mastersat.uz"
_AHOST = "admin.mastersat.uz"


def _publishable_set(creator, *, title="Set", **over):
    s = AssessmentSet.objects.create(
        subject="math", category="Algebra", title=title,
        source=AssessmentSet.SOURCE_MATHBOOK, level="junior",
        created_by=creator, **over,
    )
    AssessmentQuestion.objects.create(
        assessment_set=s, order=0, prompt="2+2?",
        question_type=AssessmentQuestion.TYPE_NUMERIC, correct_answer=4,
        points=1, is_active=True,
    )
    return s


def _status_url(pk):
    return f"/api/assessments/admin/sets/{pk}/status/"


@override_settings(ALLOWED_HOSTS=list(_HOSTS))
class ReviewStatusTransitionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("rs_admin@t.com", "x", role=acc_const.ROLE_ADMIN)
        self.test_admin = User.objects.create_user(
            "rs_ta@t.com", "x", role=acc_const.ROLE_TEST_ADMIN
        )
        self.teacher = User.objects.create_user(
            "rs_teacher@t.com", "x", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH
        )
        self.set = _publishable_set(self.test_admin)
        self.client = APIClient()

    def _post(self, user, status_value):
        self.client.force_authenticate(user)
        return self.client.post(
            _status_url(self.set.id), {"status": status_value}, format="json", HTTP_HOST=_QHOST
        )

    def test_default_status_is_draft(self):
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_DRAFT)

    def test_author_submits_for_review(self):
        r = self._post(self.test_admin, AssessmentSet.STATUS_NEEDS_REVIEW)
        self.assertEqual(r.status_code, 200, r.content)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_NEEDS_REVIEW)
        self.assertTrue(
            GovernanceEvent.objects.filter(
                event_type=GovernanceEvent.EVENT_SUBMIT_FOR_REVIEW,
                entity_type="AssessmentSet", entity_id=self.set.id,
            ).exists()
        )

    def test_test_admin_cannot_approve(self):
        self.set.review_status = AssessmentSet.STATUS_NEEDS_REVIEW
        self.set.save(update_fields=["review_status"])
        r = self._post(self.test_admin, AssessmentSet.STATUS_APPROVED)
        self.assertEqual(r.status_code, 403, r.content)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_NEEDS_REVIEW)

    def test_teacher_cannot_approve(self):
        # Teacher owns the subject so passes authoring, but not the approver gate.
        r = self._post(self.teacher, AssessmentSet.STATUS_APPROVED)
        self.assertEqual(r.status_code, 403, r.content)

    def test_admin_approves_and_publishes(self):
        self.assertFalse(AssessmentSetVersion.objects.filter(assessment_set=self.set).exists())
        r = self._post(self.admin, AssessmentSet.STATUS_APPROVED)
        self.assertEqual(r.status_code, 200, r.content)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_APPROVED)
        # Approval published an immutable version so homeworks can pin it.
        self.assertTrue(AssessmentSetVersion.objects.filter(assessment_set=self.set).exists())
        self.assertTrue(
            GovernanceEvent.objects.filter(
                event_type=GovernanceEvent.EVENT_APPROVE, entity_id=self.set.id
            ).exists()
        )

    def test_approve_incomplete_set_blocked(self):
        empty = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Empty",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.test_admin,
        )
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            _status_url(empty.id), {"status": AssessmentSet.STATUS_APPROVED},
            format="json", HTTP_HOST=_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json().get("code") is not None, True)
        empty.refresh_from_db()
        self.assertEqual(empty.review_status, AssessmentSet.STATUS_DRAFT)
        self.assertFalse(AssessmentSetVersion.objects.filter(assessment_set=empty).exists())

    def test_invalid_status_rejected(self):
        r = self._post(self.admin, "bogus")
        self.assertEqual(r.status_code, 400, r.content)

    def test_editing_metadata_resets_approved(self):
        self._post(self.admin, AssessmentSet.STATUS_APPROVED)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_APPROVED)
        # A metadata edit un-approves it.
        self.client.force_authenticate(self.admin)
        r = self.client.patch(
            f"/api/assessments/admin/sets/{self.set.id}/",
            {"title": "Renamed"}, format="json", HTTP_HOST=_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_NEEDS_REVIEW)

    def test_adding_question_resets_approved(self):
        self._post(self.admin, AssessmentSet.STATUS_APPROVED)
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            f"/api/assessments/admin/sets/{self.set.id}/questions/",
            {"prompt": "3+3?", "question_type": AssessmentQuestion.TYPE_NUMERIC,
             "correct_answer": 6, "points": 1},
            format="json", HTTP_HOST=_QHOST,
        )
        self.assertIn(r.status_code, (200, 201), r.content)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_NEEDS_REVIEW)

    def test_pure_is_active_toggle_does_not_reset_approved(self):
        self._post(self.admin, AssessmentSet.STATUS_APPROVED)
        self.client.force_authenticate(self.admin)
        r = self.client.patch(
            f"/api/assessments/admin/sets/{self.set.id}/",
            {"is_active": False}, format="json", HTTP_HOST=_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.set.refresh_from_db()
        self.assertEqual(self.set.review_status, AssessmentSet.STATUS_APPROVED)


@override_settings(ALLOWED_HOSTS=list(_HOSTS))
class AssignApprovalGuardTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            "ag_teacher@t.com", "x", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH
        )
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH, classroom=None, granted_by=self.teacher
        )
        self.classroom = Classroom.objects.create(
            name="Math", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        self.draft_set = _publishable_set(self.teacher, title="Draft set")
        self.approved_set = _publishable_set(
            self.teacher, title="Approved set", review_status=AssessmentSet.STATUS_APPROVED
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _assign(self, set_id, **extra):
        body = {"classroom_id": self.classroom.id, "set_id": set_id, "title": "HW"}
        body.update(extra)
        return self.client.post(
            "/api/assessments/homework/assign/", body, format="json", HTTP_HOST=_AHOST
        )

    def test_unapproved_set_blocked(self):
        r = self._assign(self.draft_set.id)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json().get("code"), "assessment_not_approved")

    def test_unapproved_set_allowed_with_confirm(self):
        r = self._assign(self.draft_set.id, allow_unapproved="true")
        self.assertEqual(r.status_code, 201, r.content)

    def test_approved_set_assigns_cleanly(self):
        r = self._assign(self.approved_set.id)
        self.assertEqual(r.status_code, 201, r.content)

    def test_assignment_options_exposes_review_status(self):
        r = self.client.get(
            f"/api/classes/{self.classroom.id}/assignment-options/", HTTP_HOST=_AHOST
        )
        self.assertEqual(r.status_code, 200, r.content)
        rows = {row["id"]: row for row in r.json()["assessment_sets"]}
        self.assertIn("review_status", rows[self.draft_set.id])
        self.assertFalse(rows[self.draft_set.id]["is_approved"])
        self.assertTrue(rows[self.approved_set.id]["is_approved"])
