"""Regression: a completed MIDTERM attempt must not leak its score or per-question
answer key through the generic attempt payloads (``retrieve`` / ``status`` / ``list``)
until the teacher releases results.

Before this fix the release gate lived ONLY in the ``review`` action, so the default
DRF ``retrieve``, the ``status`` action and ``list`` — all TestAttemptSerializer, which
exposes ``score`` and ``module_results`` (full ``correct_answers``) — returned a
completed midterm's score and answer key before release.

Regular (non-midterm) attempts and RELEASED midterms must still return their score.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from exams.models import MockExam, Module, PracticeTest, Question, TestAttempt

from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule

User = get_user_model()


class MidtermResultMaskingTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("mask_owner@t.com", "secret123")
        self.student = User.objects.create_user("mask_student@t.com", "secret123")

        self.classroom = Classroom.objects.create(
            name="Mask Class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT,
        )

        self.midterm = MockExam.objects.create(
            title="Masked Midterm", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", midterm_scoring_scale=MockExam.SCALE_100,
        )
        self.section = PracticeTest.objects.create(
            subject="MATH", title="sec", collection_name="MID",
            form_type="INTERNATIONAL", mock_exam=self.midterm,
            skip_default_modules=True,
        )
        self.module = Module.objects.create(
            practice_test=self.section, module_order=1, time_limit_minutes=60
        )
        self.question = Question.objects.create(
            module=self.module, question_type="MATH", question_text="Q",
            option_a="A", option_b="B", correct_answers="a", order=0,
        )
        # One-per-(classroom, mock_exam); results start UNreleased.
        self.schedule = MidtermSchedule.objects.create(
            classroom=self.classroom, mock_exam=self.midterm,
            starts_at=timezone.now(),
        )
        self.attempt = self._completed_attempt(self.section, score=90, mock_exam=self.midterm)
        self.client.force_authenticate(self.student)

    def _completed_attempt(self, practice_test, *, score, mock_exam=None):
        return TestAttempt.objects.create(
            student=self.student, practice_test=practice_test, mock_exam=mock_exam,
            score=score, is_completed=True, current_state=TestAttempt.STATE_COMPLETED,
            completed_at=timezone.now(),
            module_answers={str(self.module.id): {str(self.question.id): "a"}},
        )

    # ── Withheld (not yet released) ───────────────────────────────────────────
    def test_status_masks_score_when_not_released(self):
        r = self.client.get(f"/api/exams/attempts/{self.attempt.pk}/status/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNone(r.data.get("score"))
        self.assertIsNone(r.data.get("module_results"))
        self.assertTrue(r.data.get("results_withheld"))

    def test_retrieve_masks_score_when_not_released(self):
        r = self.client.get(f"/api/exams/attempts/{self.attempt.pk}/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNone(r.data.get("score"))
        self.assertIsNone(r.data.get("module_results"))
        self.assertTrue(r.data.get("results_withheld"))

    def test_list_masks_score_when_not_released(self):
        r = self.client.get("/api/exams/attempts/")
        self.assertEqual(r.status_code, 200, r.content)
        rows = r.data["results"] if isinstance(r.data, dict) else r.data
        row = next(x for x in rows if x["id"] == self.attempt.pk)
        self.assertIsNone(row.get("score"))
        self.assertTrue(row.get("results_withheld"))

    # ── Released ──────────────────────────────────────────────────────────────
    def test_status_shows_score_once_released(self):
        self.schedule.results_released = True
        self.schedule.results_released_at = timezone.now()
        self.schedule.save(update_fields=["results_released", "results_released_at"])

        r = self.client.get(f"/api/exams/attempts/{self.attempt.pk}/status/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("score"), 90)
        self.assertFalse(r.data.get("results_withheld", False))

    # ── Non-midterm attempts are never masked ─────────────────────────────────
    def test_non_midterm_attempt_always_shows_score(self):
        standalone = PracticeTest.objects.create(
            subject="MATH", title="pp", form_type="INTERNATIONAL",
            skip_default_modules=True,
        )
        Module.objects.create(practice_test=standalone, module_order=1, time_limit_minutes=60)
        attempt = self._completed_attempt(standalone, score=77)

        r = self.client.get(f"/api/exams/attempts/{attempt.pk}/status/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data.get("score"), 77)
        self.assertFalse(r.data.get("results_withheld", False))
