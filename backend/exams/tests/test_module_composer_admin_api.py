from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import Module, ModuleQuestion, PracticeTest, Question
from exams.question_ordering import assign_question_to_module_dense_locked

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
class ModuleComposerAdminApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="module_composer_admin@example.com",
            password="x",
            role=acc_const.ROLE_ADMIN,
        )
        self.client.force_authenticate(user=self.admin)

        self.pt = PracticeTest.objects.create(
            subject="MATH",
            title="Composer API test",
            form_type="INTERNATIONAL",
            mock_exam=None,
            skip_default_modules=True,
        )
        self.mod = Module.objects.create(
            practice_test=self.pt,
            module_order=1,
            time_limit_minutes=35,
        )

        self.q_linked = Question.objects.create(
            question_type="MATH",
            question_text="Linked alpha",
            correct_answers="1",
            is_active=True,
        )
        assign_question_to_module_dense_locked(module_id=self.mod.id, question=self.q_linked, insert_at=0)

        self.q_standalone = Question.objects.create(
            question_type="MATH",
            question_text="Standalone beta unique",
            correct_answers="2",
            is_active=True,
        )

    def test_unlink_from_module_removes_link_keeps_question(self):
        """POST unlink-from-module drops ModuleQuestion; Question row remains."""
        url = (
            f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/"
            f"{self.q_linked.id}/unlink-from-module/"
        )
        r = self.client.post(url, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(
            ModuleQuestion.objects.filter(module_id=self.mod.id, question_id=self.q_linked.id).exists()
        )
        self.assertTrue(Question.objects.filter(pk=self.q_linked.id).exists())

    def test_second_unlink_returns_404_outside_nested_queryset(self):
        """After unlinking, Question is excluded from nested list/detail scope; repeated POST yields 404."""
        url = (
            f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/"
            f"{self.q_linked.id}/unlink-from-module/"
        )
        r1 = self.client.post(url, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r1.status_code, status.HTTP_200_OK)
        r2 = self.client.post(url, format="json", **_QUESTIONS_HOST)
        self.assertEqual(r2.status_code, status.HTTP_404_NOT_FOUND)

    def test_composer_list_excludes_module_question_ids(self):
        """composer=1&exclude_module omits questions already linked to that module."""
        base = "/api/exams/admin/questions/"
        r_all = self.client.get(
            base,
            {"composer": "1", "subject": "MATH", "is_active": "1"},
            **_QUESTIONS_HOST,
        )
        self.assertEqual(r_all.status_code, status.HTTP_200_OK)
        data_all = r_all.json()
        ids_all = {row["id"] for row in (data_all if isinstance(data_all, list) else data_all.get("results", []))}
        self.assertIn(self.q_linked.id, ids_all)

        r_ex = self.client.get(
            base,
            {
                "composer": "1",
                "subject": "MATH",
                "is_active": "1",
                "exclude_module": str(self.mod.id),
            },
            **_QUESTIONS_HOST,
        )
        self.assertEqual(r_ex.status_code, status.HTTP_200_OK)
        data_ex = r_ex.json()
        ids_ex = {row["id"] for row in (data_ex if isinstance(data_ex, list) else data_ex.get("results", []))}
        self.assertNotIn(self.q_linked.id, ids_ex)
        self.assertIn(self.q_standalone.id, ids_ex)

    def test_composer_limit_offset_slice(self):
        """limit and offset slice the queryset after filters."""
        for i in range(5):
            Question.objects.create(
                question_type="MATH",
                question_text=f"Slice filler {i}",
                correct_answers=str(i),
                is_active=True,
            )

        r = self.client.get(
            "/api/exams/admin/questions/",
            {
                "composer": "1",
                "subject": "MATH",
                "is_active": "1",
                "exclude_module": str(self.mod.id),
                "limit": "2",
                "offset": "0",
            },
            **_QUESTIONS_HOST,
        )
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        body = r.json()
        rows = body if isinstance(body, list) else body.get("results", [])
        self.assertEqual(len(rows), 2)

        r2 = self.client.get(
            "/api/exams/admin/questions/",
            {
                "composer": "1",
                "subject": "MATH",
                "is_active": "1",
                "exclude_module": str(self.mod.id),
                "limit": "2",
                "offset": "2",
            },
            **_QUESTIONS_HOST,
        )
        self.assertEqual(r2.status_code, status.HTTP_200_OK)
        body2 = r2.json()
        rows2 = body2 if isinstance(body2, list) else body2.get("results", [])
        self.assertEqual(len(rows2), 2)
        ids_page1 = {row["id"] for row in rows}
        ids_page2 = {row["id"] for row in rows2}
        self.assertTrue(ids_page1.isdisjoint(ids_page2))
