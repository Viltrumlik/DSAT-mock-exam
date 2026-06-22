"""Regression: authoring APIs must work on main host (same-origin SPA + API)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest

User = get_user_model()

_ADMIN_HOST_KWARGS = {"HTTP_HOST": "admin.mastersat.uz"}
_QUESTIONS_HOST_KWARGS = {"HTTP_HOST": "questions.mastersat.uz"}

# Mirrors production nginx server_name for subdomain guards.
_ALLOWED_FOR_SUBDOMAIN_TESTS = (
    "testserver",
    "localhost",
    "127.0.0.1",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
)


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_FOR_SUBDOMAIN_TESTS))
class PastPapersAdminMainDomainTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.test_admin = User.objects.create_user(
            email="pastpapers_main@example.com",
            password="secret",
            role=acc_const.ROLE_TEST_ADMIN,
        )

    def test_admin_tests_list_standalone_on_main_host_not_403_from_middleware(self):
        self.client.force_authenticate(user=self.test_admin)
        resp = self.client.get(
            "/api/exams/admin/tests/?standalone=1",
            # Default ``testserver`` is in ALLOWED_HOSTS; subdomain detection treats unknown
            # non-admin/non-questions hosts as main console (same routing as apex domain).
            HTTP_HOST="testserver",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

    def test_section_create_patch_on_admin_host_not_blocked_by_http_guard(self):
        """Middleware must not deny CRUD so staff can manage content from hosted admin SPA."""
        self.client.force_authenticate(user=self.test_admin)
        resp = self.client.post(
            "/api/exams/admin/tests/",
            data={
                "subject": "MATH",
                "title": "October form",
                "collection_name": "October",
                "practice_date": "2024-10-05",
                "label": "A",
                "form_type": "INTERNATIONAL",
            },
            format="json",
            **_ADMIN_HOST_KWARGS,
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json().get("title"), "October form")
        section_id = resp.json()["id"]
        patched = self.client.patch(
            f"/api/exams/admin/tests/{section_id}/",
            data={"title": "October form — updated"},
            format="json",
            **_ADMIN_HOST_KWARGS,
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(PracticeTest.objects.get(pk=section_id).title, "October form — updated")

    def test_section_delete_on_admin_host_not_blocked(self):
        section = PracticeTest.objects.create(
            title="Trash me", subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        self.client.force_authenticate(user=self.test_admin)
        resp = self.client.delete(f"/api/exams/admin/tests/{section.pk}/", **_ADMIN_HOST_KWARGS)
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(PracticeTest.objects.filter(pk=section.pk).exists())

    def test_questions_host_public_practice_catalog_200_for_test_admin(self):
        """Pastpaper SPA on ``questions.*`` loads GET /api/exams/ — must not hard-fail authoring roles."""
        self.client.force_authenticate(user=self.test_admin)
        resp = self.client.get("/api/exams/", **_QUESTIONS_HOST_KWARGS)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIsInstance(body, list)

