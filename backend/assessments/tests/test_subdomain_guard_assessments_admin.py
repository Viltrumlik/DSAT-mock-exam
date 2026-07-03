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
_QUESTIONS_HOST = {"HTTP_HOST": "questions.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_SUBDOMAIN_HOSTS))
class AssessmentsAdminSubdomainGuardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.test_admin = User.objects.create_user(
            email="testadmin_guard@example.com",
            password="x",
            role=acc_const.ROLE_TEST_ADMIN,
        )

    def test_admin_host_blocks_assessments_admin_writes(self):
        """
        Host guard must block assessment authoring writes on admin.* (GET-only),
        even for authorized staff roles.
        """
        self.client.force_authenticate(user=self.test_admin)
        r = self.client.post(
            "/api/assessments/admin/sets/",
            data={"subject": "math", "source": "SQB", "title": "Blocked on admin host", "category": "algebra"},
            format="json",
            **_ADMIN_HOST,
        )
        self.assertEqual(r.status_code, 403)
        self.assertIn("disabled on admin subdomain", (r.json().get("detail") or "").lower())

    def test_questions_host_allows_assessments_admin_writes_for_staff(self):
        """questions.* is the canonical authoring console for assessment CRUD."""
        self.client.force_authenticate(user=self.test_admin)
        r = self.client.post(
            "/api/assessments/admin/sets/",
            data={"subject": "math", "source": "SQB", "title": "Allowed on questions host", "category": "algebra"},
            format="json",
            **_QUESTIONS_HOST,
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual((r.json().get("title") or ""), "Allowed on questions host")

