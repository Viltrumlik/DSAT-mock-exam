from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import Module, PracticeTest, Question

User = get_user_model()

_ALLOWED_SUBDOMAIN_HOSTS = (
    "localhost",
    "127.0.0.1",
    "testserver",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
)

_QUESTIONS_HOST = {"HTTP_HOST": "questions.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_SUBDOMAIN_HOSTS))
class QuestionLifecycleReviewApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.test_admin = User.objects.create_user(
            email="lifecycle_ta@example.com",
            password="x",
            role=acc_const.ROLE_TEST_ADMIN,
        )
        self.publisher = User.objects.create_user(
            email="lifecycle_adm@example.com",
            password="x",
            role=acc_const.ROLE_ADMIN,
        )
        self.q = Question.objects.create(
            question_type="MATH",
            question_text="Lifecycle flow",
            correct_answers="1",
            is_active=True,
            status=Question.STATUS_DRAFT,
        )

    def test_submit_for_review_requires_draft(self):
        """Author (test_admin) can move draft → review."""
        url = f"/api/exams/admin/questions/{self.q.id}/submit-for-review/"
        self.client.force_authenticate(user=self.test_admin)
        self.q.refresh_from_db()
        self.assertEqual(self.q.status, Question.STATUS_DRAFT)
        r = self.client.post(url, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.q.refresh_from_db()
        self.assertEqual(self.q.status, Question.STATUS_REVIEW)

    def test_test_admin_cannot_approve(self):
        self.q.status = Question.STATUS_REVIEW
        self.q.save(update_fields=["status"])
        url = f"/api/exams/admin/questions/{self.q.id}/approve/"
        self.client.force_authenticate(user=self.test_admin)
        r = self.client.post(url, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, status.HTTP_403_FORBIDDEN)

    def test_publisher_can_approve(self):
        self.q.status = Question.STATUS_REVIEW
        self.q.save(update_fields=["status"])
        url = f"/api/exams/admin/questions/{self.q.id}/approve/"
        self.client.force_authenticate(user=self.publisher)
        r = self.client.post(url, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.q.refresh_from_db()
        self.assertEqual(self.q.status, Question.STATUS_APPROVED)

    def test_publisher_can_reject_with_comment(self):
        self.q.status = Question.STATUS_REVIEW
        self.q.save(update_fields=["status"])
        url = f"/api/exams/admin/questions/{self.q.id}/reject/"
        self.client.force_authenticate(user=self.publisher)
        r = self.client.post(url, {"comment": "Fix typo in stem"}, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.q.refresh_from_db()
        self.assertEqual(self.q.status, Question.STATUS_DRAFT)
        self.assertEqual(self.q.review_comment, "Fix typo in stem")


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_SUBDOMAIN_HOSTS))
class QuestionLifecycleAssignRestrictionTests(TestCase):
    """assign-question rejects non-approved statuses."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="assign_lc@example.com",
            password="x",
            role=acc_const.ROLE_ADMIN,
        )
        self.client.force_authenticate(user=self.admin)
        self.pt = PracticeTest.objects.create(
            subject="MATH",
            title="Assign lifecycle",
            form_type="INTERNATIONAL",
            mock_exam=None,
            skip_default_modules=True,
        )
        self.mod = Module.objects.create(
            practice_test=self.pt,
            module_order=1,
            time_limit_minutes=35,
        )

    def test_assign_rejects_draft_question(self):
        draft = Question.objects.create(
            question_type="MATH",
            question_text="Not ready",
            correct_answers="1",
            is_active=True,
            status=Question.STATUS_DRAFT,
        )
        url = f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/assign-question/"
        r = self.client.post(url, {"question_id": draft.id}, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
