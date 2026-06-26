from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()

_ALLOWED_FOR_SUBDOMAIN_TESTS = (
    "testserver",
    "localhost",
    "127.0.0.1",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
)
_ADMIN_HOST = {"HTTP_HOST": "admin.mastersat.uz"}
_QUESTIONS_HOST = {"HTTP_HOST": "questions.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_FOR_SUBDOMAIN_TESTS))
class PastpaperSystemHardeningTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.test_admin = User.objects.create_user(
            email="pp_test_admin@example.com",
            password="pw",
            role=acc_const.ROLE_TEST_ADMIN,
        )
        self.admin = User.objects.create_user(
            email="pp_admin@example.com",
            password="pw",
            role=acc_const.ROLE_ADMIN,
        )
        self.student = User.objects.create_user(
            email="pp_student@example.com",
            password="pw",
            role=acc_const.ROLE_STUDENT,
        )

    def test_test_admin_can_create_and_edit_standalone_section(self):
        self.client.force_authenticate(user=self.test_admin)

        created = self.client.post(
            "/api/exams/admin/tests/",
            data={
                "subject": "MATH",
                "title": "Math Section",
                "collection_name": "October form",
                "practice_date": "2024-10-01",
                "label": "A",
                "form_type": "INTERNATIONAL",
            },
            format="json",
            **_QUESTIONS_HOST,
        )
        self.assertEqual(created.status_code, 201, created.content)
        section_id = int(created.json()["id"])
        self.assertEqual(created.json()["collection_name"], "October form")

        patched = self.client.patch(
            f"/api/exams/admin/tests/{section_id}/",
            data={"title": "Math Section (edited)"},
            format="json",
            **_QUESTIONS_HOST,
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(PracticeTest.objects.get(pk=section_id).title, "Math Section (edited)")

    def test_admin_can_browse_standalone_sections_on_admin_host(self):
        PracticeTest.objects.create(
            mock_exam=None,
            collection_name="Visible form",
            subject="MATH",
            form_type="INTERNATIONAL",
            title="Pack Math",
            skip_default_modules=True,
        )
        self.client.force_authenticate(user=self.admin)
        r = self.client.get("/api/exams/admin/tests/?standalone=1", **_ADMIN_HOST)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_admin_publish_blocked_when_incomplete(self):
        # Section-level publish enforces full SAT structure (same rule the old pack
        # publish applied per section): an under-seeded Math module is blocked.
        section = PracticeTest.objects.create(
            mock_exam=None,
            collection_name="Pub form",
            subject="MATH",
            form_type="INTERNATIONAL",
            title="Pub Section",
            skip_default_modules=False,
        )
        seed_mc_questions_for_practice_test(section, questions_per_module=1)
        self.client.force_authenticate(user=self.admin)

        blocked = self.client.post(
            f"/api/exams/admin/tests/{section.pk}/publish/", format="json", **_ADMIN_HOST
        )
        self.assertEqual(blocked.status_code, 400, blocked.content)
        self.assertTrue(blocked.json().get("violations"))
        section.refresh_from_db()
        self.assertFalse(section.is_published)

    def test_admin_can_publish_complete_section_then_unpublish(self):
        # Math requires exactly 22 questions per module to be structurally complete.
        section = PracticeTest.objects.create(
            mock_exam=None,
            collection_name="Pub form 2",
            subject="MATH",
            form_type="INTERNATIONAL",
            title="Pub Section 2",
            skip_default_modules=False,
        )
        seed_mc_questions_for_practice_test(section, questions_per_module=22)
        self.client.force_authenticate(user=self.admin)

        pub = self.client.post(
            f"/api/exams/admin/tests/{section.pk}/publish/", format="json", **_ADMIN_HOST
        )
        self.assertEqual(pub.status_code, 200, pub.content)
        section.refresh_from_db()
        self.assertTrue(section.is_published)

        unpub = self.client.post(
            f"/api/exams/admin/tests/{section.pk}/unpublish/", format="json", **_ADMIN_HOST
        )
        self.assertEqual(unpub.status_code, 200, unpub.content)
        section.refresh_from_db()
        self.assertFalse(section.is_published)

    def test_admin_can_assign_pastpaper_section_and_student_can_start(self):
        section = PracticeTest.objects.create(
            mock_exam=None,
            collection_name="Assign form",
            subject="MATH",
            form_type="INTERNATIONAL",
            title="Assign Section",
            skip_default_modules=False,
        )
        seed_mc_questions_for_practice_test(section)

        # Assign via canonical bulk-assign endpoint (admin host)
        self.client.force_authenticate(user=self.admin)
        assign = self.client.post(
            "/api/exams/bulk_assign/",
            data={"user_ids": [self.student.pk], "practice_test_ids": [section.pk], "exam_ids": [], "assignment_type": "FULL"},
            format="json",
            **_ADMIN_HOST,
        )
        self.assertIn(assign.status_code, (200, 201), assign.content)

        # Student can start attempt on main host
        self.client.force_authenticate(user=self.student)
        start = self.client.post("/api/exams/attempts/", data={"practice_test": section.pk}, format="json", HTTP_HOST="testserver")
        self.assertIn(start.status_code, (200, 201), start.content)
        self.assertTrue(start.json().get("id"))

    def test_published_pastpaper_hidden_until_assigned(self):
        """Publishing alone must not expose a pastpaper to every student — only an
        explicit assignment makes it visible in the student list."""
        from django.urls import reverse

        section = PracticeTest.objects.create(
            mock_exam=None,
            collection_name="Visibility",
            subject="MATH",
            form_type="INTERNATIONAL",
            title="Published Unassigned",
            skip_default_modules=False,
            is_published=True,
        )
        seed_mc_questions_for_practice_test(section)

        list_url = reverse("practice-test-list")
        self.client.force_authenticate(user=self.student)

        # Published but NOT assigned → must not appear.
        r = self.client.get(list_url, HTTP_HOST="testserver")
        self.assertEqual(r.status_code, 200, r.content)
        ids = {row["id"] for row in r.json()}
        self.assertNotIn(section.pk, ids)

        # Assign to the student → now appears.
        section.assigned_users.add(self.student)
        r = self.client.get(list_url, HTTP_HOST="testserver")
        ids = {row["id"] for row in r.json()}
        self.assertIn(section.pk, ids)
