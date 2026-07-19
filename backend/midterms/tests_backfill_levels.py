"""backfill_midterm_levels: copy legacy MockExam.midterm_level onto the Midterm mirror.

Regression context: mirrors created before `level` was synced kept `level=''`, which the
teacher classroom picker treats as "matches no leveled classroom" — hiding those midterms
from every leveled class.

    python manage.py test midterms.tests_backfill_levels
"""
from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from exams.models import Module, MockExam
from midterms.models import Midterm


def _legacy(level: str, title: str = "Legacy") -> MockExam:
    return MockExam.objects.create(title=title, kind=MockExam.KIND_MIDTERM, midterm_level=level)


def _mirror(legacy_id: int | None, level: str, title: str = "Mirror") -> Midterm:
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
    return Midterm.objects.create(
        title=title,
        subject=Midterm.MATH,
        level=level,
        scoring_scale=Midterm.SCALE_100,
        duration_minutes=30,
        question_module=module,
        is_published=True,
        legacy_mock_exam_id=legacy_id,
    )


def _run(*args) -> str:
    out = StringIO()
    call_command("backfill_midterm_levels", *args, stdout=out)
    return out.getvalue()


class BackfillMidtermLevelsTests(TestCase):
    def test_dry_run_reports_but_does_not_change(self):
        mt = _mirror(_legacy("junior").id, "")
        out = _run()
        self.assertIn("dry-run", out)
        mt.refresh_from_db()
        self.assertEqual(mt.level, "")

    def test_commit_fills_blank_level_from_legacy(self):
        mt = _mirror(_legacy("foundation").id, "")
        _run("--commit")
        mt.refresh_from_db()
        self.assertEqual(mt.level, "foundation")

    def test_mismatched_level_kept_unless_overwrite(self):
        mt = _mirror(_legacy("middle").id, "junior")
        _run("--commit")
        mt.refresh_from_db()
        self.assertEqual(mt.level, "junior")  # untouched by default

        _run("--commit", "--overwrite")
        mt.refresh_from_db()
        self.assertEqual(mt.level, "middle")

    def test_blank_legacy_is_left_alone(self):
        mt = _mirror(_legacy("").id, "")
        _run("--commit")
        mt.refresh_from_db()
        self.assertEqual(mt.level, "")

    def test_mirror_without_legacy_anchor_is_skipped(self):
        mt = _mirror(None, "")
        _run("--commit")
        mt.refresh_from_db()
        self.assertEqual(mt.level, "")

    def test_questions_are_never_touched(self):
        """The whole point of this command over a full resync: question rows keep their ids."""
        legacy = _legacy("junior")
        mt = _mirror(legacy.id, "")
        from exams.models import Question
        q = Question.objects.create(
            module=mt.question_module, question_type="MATH", question_text="Q",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", is_math_input=False, score=10, order=0,
        )
        _run("--commit")
        mt.refresh_from_db()
        self.assertEqual(mt.level, "junior")
        q.refresh_from_db()
        self.assertEqual(q.correct_answers, "a")
        self.assertEqual(Question.objects.filter(module=mt.question_module).count(), 1)
