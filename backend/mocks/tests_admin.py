"""Admin/builder tests for full mocks (create -> 4 modules provisioned -> add questions -> publish).

    python manage.py test mocks.tests_admin --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from mocks.models import Mock

User = get_user_model()
BASE = "/api/mocks/admin/mocks/"


class AdminMockBuilderTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create(username="admin", email="a@x.io", is_staff=True, is_superuser=True)
        self.c = APIClient()
        self.c.force_authenticate(self.staff)

    def test_create_provisions_four_modules_and_publish_flow(self):
        r = self.c.post(BASE, {"title": "Mock 1", "break_minutes": 10}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        mid = r.json()["id"]
        # 2 sections (English + Math), each with 2 modules = 4 modules.
        sections = r.json()["sections"]
        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0]["subject"], "READING_WRITING")  # English first
        self.assertEqual(len(sections[0]["modules"]), 2)
        self.assertEqual(len(sections[1]["modules"]), 2)
        self.assertFalse(r.json()["publish_ready"])

        # Publish blocked (no questions).
        r = self.c.post(f"{BASE}{mid}/publish/", {}, format="json")
        self.assertEqual(r.status_code, 400, r.content)

        # Add one question to every module.
        mock = Mock.objects.get(pk=mid)
        module_ids = [m.id for sec in mock.sections.all() for m in sec.modules()]
        self.assertEqual(len(module_ids), 4)
        for module_id in module_ids:
            qr = self.c.post(f"{BASE}{mid}/modules/{module_id}/questions/", {}, format="json")
            self.assertEqual(qr.status_code, 201, qr.content)

        r = self.c.get(f"{BASE}{mid}/")
        self.assertEqual(r.json()["question_count"], 4)
        self.assertTrue(r.json()["publish_ready"])

        r = self.c.post(f"{BASE}{mid}/publish/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["is_published"])

    def test_module_must_belong_to_mock(self):
        r = self.c.post(BASE, {"title": "A"}, format="json")
        mid = r.json()["id"]
        # A module id from a different mock is rejected.
        r2 = self.c.post(BASE, {"title": "B"}, format="json")
        other = Mock.objects.get(pk=r2.json()["id"])
        foreign_module = other.sections.first().module1_id
        qr = self.c.post(f"{BASE}{mid}/modules/{foreign_module}/questions/", {}, format="json")
        self.assertEqual(qr.status_code, 400, qr.content)

    def test_student_cannot_author(self):
        student = User.objects.create(username="s", email="s@x.io")
        c = APIClient()
        c.force_authenticate(student)
        r = c.post(BASE, {"title": "x"}, format="json")
        self.assertIn(r.status_code, (401, 403))
