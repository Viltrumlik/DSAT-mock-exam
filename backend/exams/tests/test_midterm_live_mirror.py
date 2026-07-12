"""Integration: builder question edits keep the midterm MIRROR live (no frozen snapshot).

Regression for the production bug where a midterm published with N questions kept showing
the old N in the runner after the teacher added more in the builder — the mirror was a
copy refreshed only on publish and frozen once an attempt existed. Now the AdminQuestionViewSet
mutation hooks re-mirror the owning midterm in place on every add/edit/delete.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest, Question
from midterms.models import Midterm, MidtermAttempt
from midterms.sync import upsert_midterm_from_legacy

User = get_user_model()

_ALLOWED_HOSTS = ("testserver", "localhost", "127.0.0.1", "questions.mastersat.uz")
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class MidtermLiveMirrorTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="mt-live-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(self.admin)

        self.exam = MockExam.objects.create(
            title="Live midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_100,
            midterm_module_count=1, midterm_module_question_limit=30, is_published=True,
        )
        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=self.exam,
            title="Section", skip_default_modules=True,
        )
        self.mod = Module.objects.create(practice_test=self.pt, module_order=1, time_limit_minutes=35)
        for i in range(3):
            Question.objects.create(module=self.mod, question_type="MATH", question_text=f"Q{i}",
                                    option_a="A", option_b="B", option_c="C", option_d="D",
                                    correct_answers="a", score=10, order=i)
        # Mirror created with 3 questions (as if published early).
        self.mirror = upsert_midterm_from_legacy(self.exam, sync_questions=True)
        self.assertEqual(self.mirror.questions().count(), 3)

    def _q_url(self):
        return f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/"

    def test_adding_a_question_via_builder_updates_mirror_live(self):
        # Even with an attempt present (previously froze the mirror at 3), a new question
        # added through the builder API must appear live in the mirror.
        student = User.objects.create(username="live-s1")
        MidtermAttempt.objects.create(midterm=self.mirror, student=student)

        r = self.client.post(self._q_url(), {}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)

        self.mirror.refresh_from_db()
        self.assertEqual(self.mirror.questions().count(), 4)  # live, not frozen at 3

    def test_editing_a_question_via_builder_updates_mirror_content(self):
        q = Question.objects.filter(module=self.mod).order_by("order").first()
        mirror_q_id_before = self.mirror.questions().order_by("order").first().id

        r = self.client.patch(
            f"{self._q_url()}{q.id}/",
            {"question_text": "REVISED", "correct_answer": "b"},
            format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)

        first = self.mirror.questions().order_by("order").first()
        self.assertEqual(first.id, mirror_q_id_before)   # in place, same id
        self.assertEqual(first.question_text, "REVISED")
        self.assertEqual(first.correct_answers, "b")

    def test_deleting_a_question_via_builder_shrinks_mirror(self):
        q = Question.objects.filter(module=self.mod).order_by("-order").first()
        r = self.client.delete(f"{self._q_url()}{q.id}/", **_QHOST)
        self.assertEqual(r.status_code, 204, r.content)
        self.mirror.refresh_from_db()
        self.assertEqual(self.mirror.questions().count(), 2)
