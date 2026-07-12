from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import MockExam, PracticeTest

User = get_user_model()

_ALLOWED_FOR_SUBDOMAIN_TESTS = (
    "testserver",
    "localhost",
    "127.0.0.1",
    "admin.mastersat.uz",
    "questions.mastersat.uz",
    "teacher.mastersat.uz",
)

_ADMIN_HOST = {"HTTP_HOST": "admin.mastersat.uz"}
_QUESTIONS_HOST = {"HTTP_HOST": "questions.mastersat.uz"}
_TEACHER_HOST = {"HTTP_HOST": "teacher.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_FOR_SUBDOMAIN_TESTS))
class RBACSubdomainFlowsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.test_admin = User.objects.create_user(
            email="ta@example.com",
            password="pw",
            role=acc_const.ROLE_TEST_ADMIN,
        )
        self.admin = User.objects.create_user(
            email="admin@example.com",
            password="pw",
            role=acc_const.ROLE_ADMIN,
        )

    def test_test_admin_questions_host_can_list_and_create_tests(self):
        self.client.force_authenticate(user=self.test_admin)

        # Seed one mock exam and one standalone (pastpaper-like) section.
        MockExam.objects.create(title="Mock A", practice_date="2024-10-01", kind=MockExam.KIND_MOCK_SAT)
        PracticeTest.objects.create(
            subject="MATH",
            form_type="INTERNATIONAL",
            mock_exam=None,
            title="Standalone Section",
            skip_default_modules=True,
        )

        r1 = self.client.get("/api/exams/admin/mock-exams/", **_QUESTIONS_HOST)
        self.assertEqual(r1.status_code, 200)
        self.assertIsInstance(r1.json(), list)
        self.assertGreaterEqual(len(r1.json()), 1)

        r2 = self.client.get("/api/exams/admin/tests/", **_QUESTIONS_HOST)
        self.assertEqual(r2.status_code, 200)
        self.assertIsInstance(r2.json(), list)
        self.assertGreaterEqual(len(r2.json()), 1)

        created = self.client.post(
            "/api/exams/admin/tests/",
            data={
                "title": "Created by test_admin",
                "subject": "READING_WRITING",
                "form_type": "INTERNATIONAL",
                "label": "A",
            },
            format="json",
            **_QUESTIONS_HOST,
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json().get("title"), "Created by test_admin")

    def test_teacher_hostguard_allows_readonly_assessment_sets_blocks_authoring(self):
        """Teacher console may READ assessment sets (for the practice runner) but not author.

        Regression guard for the /teacher/assessments practice page: it GETs
        /api/assessments/admin/sets/, which the teacher host-guard block must allow
        (read-only). Tested at the middleware directly because the positive teacher
        role-gate reads request.user before DRF auth (force_authenticate is too late).
        """
        from django.test import RequestFactory

        from access.host_guard import SubdomainAPIGuardMiddleware

        rf = RequestFactory()
        teacher = User(role=acc_const.ROLE_TEACHER)  # in-memory; is_authenticated=True, no DB save
        sentinel = object()
        mw = SubdomainAPIGuardMiddleware(lambda req: sentinel)  # get_response → sentinel = "allowed through"

        # GET the set library on the teacher host → passes the guard.
        get_req = rf.get("/api/assessments/admin/sets/", HTTP_HOST="teacher.mastersat.uz")
        get_req.user = teacher
        self.assertIs(mw(get_req), sentinel)

        # Authoring (POST) stays blocked on the teacher console.
        post_req = rf.post("/api/assessments/admin/sets/", HTTP_HOST="teacher.mastersat.uz")
        post_req.user = teacher
        post_resp = mw(post_req)
        self.assertIsNot(post_resp, sentinel)
        self.assertEqual(post_resp.status_code, 403)

    def test_questions_host_public_practice_catalog_is_reachable(self):
        """``questions.*`` allows ``GET /api/exams/`` (see ``SubdomainAPIGuardMiddleware``)."""
        self.client.force_authenticate(user=self.test_admin)
        r = self.client.get("/api/exams/", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_admin_host_lists_standalone_sections_for_assignment_console(self):
        self.client.force_authenticate(user=self.admin)

        # Standalone pastpaper sections, grouped only by their collection_name label.
        PracticeTest.objects.create(
            mock_exam=None,
            collection_name="October form",
            subject="MATH",
            form_type="INTERNATIONAL",
            title="Pack Math",
            skip_default_modules=True,
        )
        PracticeTest.objects.create(
            mock_exam=None,
            collection_name="October form",
            subject="READING_WRITING",
            form_type="INTERNATIONAL",
            title="Pack RW",
            skip_default_modules=True,
        )
        PracticeTest.objects.create(
            mock_exam=None,
            subject="READING_WRITING",
            form_type="INTERNATIONAL",
            title="Orphan RW",
            skip_default_modules=True,
        )

        standalone = self.client.get("/api/exams/admin/tests/?standalone=1", **_ADMIN_HOST)
        self.assertEqual(standalone.status_code, 200)
        self.assertIsInstance(standalone.json(), list)
        self.assertGreaterEqual(len(standalone.json()), 3)

