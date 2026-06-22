"""Tests for the redesigned /ops/access console backend additions:
- resource picker surfaces standalone practice sections (not mock) with a `group`
- grant list supports a `resource_id` filter and returns a human `resource_label`.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from access import resources
from access.engine.access_service import AccessService
from exams.models import MockExam, PracticeTest

User = get_user_model()


class AccessConsoleViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email="ac_admin@e.com", password="x", role=C.ROLE_ADMIN)
        self.student = User.objects.create_user(email="ac_stu@e.com", password="x", role=C.ROLE_STUDENT)

        # Standalone pastpaper section (grantable) + a mock section (must NOT appear).
        self.section = PracticeTest.objects.create(
            subject="MATH",
            title="March Math",
            collection_name="March 2024",
            form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        self.mock = MockExam.objects.create(title="Full mock", kind=MockExam.KIND_MOCK_SAT)
        self.mock_section = PracticeTest.objects.create(
            subject="MATH", title="Mock Math", mock_exam=self.mock, skip_default_modules=True
        )

    def test_resource_search_excludes_mock_sections_and_returns_group(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/access/resources/", {"type": "practice_test"})
        self.assertEqual(r.status_code, 200, r.content)
        results = r.json()["results"]
        ids = {item["resource_id"] for item in results}
        self.assertIn(self.section.id, ids)
        self.assertNotIn(self.mock_section.id, ids)  # mock sections are not grantable here
        section_item = next(i for i in results if i["resource_id"] == self.section.id)
        self.assertEqual(section_item["group"], "March 2024")

    def test_grant_list_resource_id_filter_and_label(self):
        AccessService.grant_resource(
            self.student, resources.RT_PRACTICE_TEST, self.section.id, granted_by=self.admin
        )
        self.client.force_authenticate(self.admin)
        r = self.client.get(
            "/api/access/grants/",
            {"resource_type": "practice_test", "resource_id": self.section.id},
        )
        self.assertEqual(r.status_code, 200, r.content)
        results = r.json()["results"]
        self.assertEqual(len(results), 1)
        grant = results[0]
        self.assertEqual(grant["resource_id"], self.section.id)
        self.assertIn("March 2024", grant["resource_label"])  # readable label, not practice_test#X

    def test_grant_list_resource_id_narrows_results(self):
        other = PracticeTest.objects.create(subject="READING_WRITING", title="Other", skip_default_modules=True)
        AccessService.grant_resource(self.student, resources.RT_PRACTICE_TEST, self.section.id, granted_by=self.admin)
        AccessService.grant_resource(self.student, resources.RT_PRACTICE_TEST, other.id, granted_by=self.admin)
        self.client.force_authenticate(self.admin)
        r = self.client.get(
            "/api/access/grants/",
            {"resource_type": "practice_test", "resource_id": self.section.id},
        )
        ids = {g["resource_id"] for g in r.json()["results"]}
        self.assertEqual(ids, {self.section.id})
