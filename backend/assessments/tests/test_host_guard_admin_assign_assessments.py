from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const


User = get_user_model()

_ALLOWED_SUBDOMAIN_HOSTS = (
    "localhost",
    "127.0.0.1",
    "testserver",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
)

_ADMIN_HOST = {"HTTP_HOST": "admin.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_SUBDOMAIN_HOSTS))
class AdminAssignAssessmentsHostGuardSurfaceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="admin_assign_assessments_host@example.com",
            password="x",
            role=acc_const.ROLE_ADMIN,
        )

    def test_admin_host_allows_assessments_homework_assign_endpoint(self):
        """
        Host guard must allow /api/assessments/homework/assign/ on admin.*.
        Payload/permissions may still reject, but it must not be the host-guard 403.
        """
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(
            "/api/assessments/homework/assign/",
            data={},
            format="json",
            **_ADMIN_HOST,
        )
        self.assertIn(r.status_code, (400, 403))
        detail = str((r.json() or {}).get("detail") or "").lower()
        self.assertNotIn("not available on admin subdomain", detail)

    def test_questions_host_blocks_assessment_homework_assign_post(self):
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(
            "/api/assessments/homework/assign/",
            data={"classroom_id": 0, "set_id": 0},
            format="json",
            HTTP_HOST="questions.mastersat.uz",
        )
        self.assertEqual(r.status_code, 403)
        self.assertIn("console", (r.json().get("detail") or "").lower())

    def test_main_host_blocks_assessment_homework_assign_post(self):
        """Apex/main API host cannot assign assessments (admin console only)."""
        self.client.force_authenticate(user=self.admin)
        r = self.client.post(
            "/api/assessments/homework/assign/",
            data={"classroom_id": 0, "set_id": 0},
            format="json",
            HTTP_HOST="testserver",
        )
        self.assertEqual(r.status_code, 403)
        self.assertIn("console", (r.json().get("detail") or "").lower())

