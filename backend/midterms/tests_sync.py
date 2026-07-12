"""Tests for the legacy→new midterm mirror (midterms/sync.py)."""

from __future__ import annotations

from django.test import TestCase

from exams.models import MockExam, Module, PracticeTest, Question
from midterms.models import Midterm, MidtermAttempt
from midterms.sync import (
    delete_midterm_mirror,
    unpublish_midterm_mirror,
    upsert_midterm_from_legacy,
)


def _legacy_midterm(*, published=True, scale="SCALE_800", n_questions=3):
    """A legacy MockExam(kind=MIDTERM) with one section, one module, N questions."""
    exam = MockExam.objects.create(
        title="Legacy Midterm",
        kind=MockExam.KIND_MIDTERM,
        midterm_subject="MATH",
        midterm_scoring_scale=scale,
        midterm_module_count=1,
        midterm_module1_minutes=25,
        midterm_module_question_limit=30,
        is_published=published,
    )
    pt = PracticeTest.objects.create(
        mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
    )
    mod = Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=25)
    for i in range(n_questions):
        Question.objects.create(
            module=mod, question_type="MATH", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", score=10, order=i,
        )
    return exam, mod


class UpsertMidtermFromLegacyTests(TestCase):
    def test_creates_mirror_with_copied_questions(self):
        exam, _mod = _legacy_midterm(published=True, scale="SCALE_800", n_questions=4)

        mt = upsert_midterm_from_legacy(exam, sync_questions=True)

        self.assertIsNotNone(mt)
        self.assertEqual(mt.legacy_mock_exam_id, exam.id)
        self.assertEqual(mt.subject, "MATH")
        self.assertEqual(mt.scoring_scale, "SCALE_800")
        self.assertTrue(mt.is_published)
        self.assertEqual(mt.duration_minutes, 25)
        self.assertEqual(mt.questions().count(), 4)
        self.assertTrue(all(q.correct_answers == "a" for q in mt.questions()))

    def test_idempotent_and_refreshes_definition(self):
        exam, _mod = _legacy_midterm(published=False, scale="SCALE_100")
        first = upsert_midterm_from_legacy(exam)
        self.assertFalse(first.is_published)

        # Publish + retitle on the legacy row, re-sync.
        exam.is_published = True
        exam.title = "Renamed Midterm"
        exam.save()
        second = upsert_midterm_from_legacy(exam)

        self.assertEqual(first.id, second.id)  # same mirror row
        self.assertEqual(Midterm.objects.filter(legacy_mock_exam_id=exam.id).count(), 1)
        self.assertTrue(second.is_published)
        self.assertEqual(second.title, "Renamed Midterm")

    def test_question_edits_propagate_when_no_attempts(self):
        exam, mod = _legacy_midterm(n_questions=2)
        upsert_midterm_from_legacy(exam)

        # Add a legacy question, then re-sync.
        Question.objects.create(
            module=mod, question_type="MATH", question_text="Q-new",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="b", score=10, order=2,
        )
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.questions().count(), 3)

    def test_questions_stay_live_but_ids_preserved_with_attempts(self):
        # Live-content contract: adding a question in the builder AFTER an attempt exists
        # must show live (count grows), while the ORIGINAL question ids are preserved so the
        # attempt's answers (keyed on Question.id) survive.
        exam, mod = _legacy_midterm(n_questions=2)
        mt = upsert_midterm_from_legacy(exam)
        original_ids = sorted(q.id for q in mt.questions())

        from django.contrib.auth import get_user_model

        student = get_user_model().objects.create(username="s1")
        MidtermAttempt.objects.create(midterm=mt, student=student)

        Question.objects.create(
            module=mod, question_type="MATH", question_text="Q-new",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="b", score=10, order=2,
        )
        mt2 = upsert_midterm_from_legacy(exam, sync_questions=True)
        new_ids = sorted(q.id for q in mt2.questions())
        self.assertEqual(mt2.questions().count(), 3)  # live, not frozen
        self.assertTrue(set(original_ids).issubset(set(new_ids)))  # original ids preserved

    def test_content_edit_updates_in_place_same_id(self):
        # Editing a question's text/answer in the builder updates the mirror IN PLACE
        # (same Question.id, new content) — the edited variant shows, no second version.
        exam, mod = _legacy_midterm(n_questions=2)
        mt = upsert_midterm_from_legacy(exam)
        first = mt.questions().order_by("order").first()
        first_id = first.id

        src = mod.questions.order_by("order").first()
        src.question_text = "EDITED STEM"
        src.correct_answers = "c"
        src.save()

        mt2 = upsert_midterm_from_legacy(exam, sync_questions=True)
        refreshed = mt2.questions().order_by("order").first()
        self.assertEqual(refreshed.id, first_id)  # same row, not a new copy
        self.assertEqual(refreshed.question_text, "EDITED STEM")
        self.assertEqual(refreshed.correct_answers, "c")

    def test_removed_question_is_trimmed(self):
        exam, mod = _legacy_midterm(n_questions=3)
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.questions().count(), 3)
        mod.questions.order_by("-order").first().delete()  # remove the last live question
        mt2 = upsert_midterm_from_legacy(exam, sync_questions=True)
        self.assertEqual(mt2.questions().count(), 2)

    def test_non_midterm_is_ignored(self):
        exam = MockExam.objects.create(title="Full Mock", kind=MockExam.KIND_MOCK_SAT)
        self.assertIsNone(upsert_midterm_from_legacy(exam))
        self.assertFalse(Midterm.objects.filter(legacy_mock_exam_id=exam.id).exists())


class MirrorLifecycleTests(TestCase):
    def test_unpublish_hides_mirror(self):
        exam, _mod = _legacy_midterm(published=True)
        upsert_midterm_from_legacy(exam)
        unpublish_midterm_mirror(exam)
        self.assertFalse(Midterm.objects.get(legacy_mock_exam_id=exam.id).is_published)

    def test_delete_removes_mirror_without_attempts(self):
        exam, _mod = _legacy_midterm()
        upsert_midterm_from_legacy(exam)
        delete_midterm_mirror(exam)
        self.assertFalse(Midterm.objects.filter(legacy_mock_exam_id=exam.id).exists())

    def test_delete_preserves_mirror_with_attempts(self):
        exam, _mod = _legacy_midterm(published=True)
        mt = upsert_midterm_from_legacy(exam)
        from django.contrib.auth import get_user_model

        student = get_user_model().objects.create(username="s2")
        MidtermAttempt.objects.create(midterm=mt, student=student)

        delete_midterm_mirror(exam)
        mt.refresh_from_db()
        self.assertTrue(Midterm.objects.filter(legacy_mock_exam_id=exam.id).exists())
        self.assertFalse(mt.is_published)  # hidden, not deleted
