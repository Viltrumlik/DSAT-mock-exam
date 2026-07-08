"""Engine + scorer smoke tests for the midterms app.

Run locally (bypasses the known local exams migration drift):
    python manage.py test midterms.tests_engine --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt
from midterms.scoring import score_midterm_attempt
from midterms.state_machine import STATE_ACTIVE, STATE_COMPLETED, STATE_NOT_STARTED, STATE_SCORING
from midterms.timing import get_midterm_timing

User = get_user_model()


def _make_midterm(scale=Midterm.SCALE_100, n_questions=4, correct_letter="a"):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
    mt = Midterm.objects.create(
        title="Diagnostic",
        subject=Midterm.READING_WRITING,
        scoring_scale=scale,
        duration_minutes=30,
        question_module=module,
    )
    for i in range(n_questions):
        Question.objects.create(
            module=module,
            question_type="READING",
            question_text=f"Q{i}",
            option_a="A",
            option_b="B",
            option_c="C",
            option_d="D",
            correct_answers=correct_letter,
            is_math_input=False,
            score=10,
            order=i,
        )
    return mt


class MidtermEngineTests(TestCase):
    def setUp(self):
        self.student = User.objects.create(username="s1", email="s1@x.io")

    def _run(self, mt, answers):
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        self.assertEqual(att.current_state, STATE_NOT_STARTED)
        self.assertTrue(att.start_attempt())
        self.assertEqual(att.current_state, STATE_ACTIVE)
        self.assertIsNotNone(att.started_at)
        # idempotent start
        self.assertFalse(att.start_attempt())
        self.assertTrue(att.submit(answers=answers))
        self.assertEqual(att.current_state, STATE_SCORING)
        # idempotent submit
        self.assertFalse(att.submit(answers=answers))
        self.assertTrue(att.complete())
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertTrue(att.is_completed)
        # idempotent complete
        self.assertFalse(att.complete())
        return att

    def test_scale_100_all_correct(self):
        mt = _make_midterm(scale=Midterm.SCALE_100, n_questions=4, correct_letter="a")
        qids = [str(q.id) for q in mt.questions()]
        att = self._run(mt, {qid: "a" for qid in qids})
        self.assertEqual(att.score, 100)

    def test_scale_100_half_correct(self):
        mt = _make_midterm(scale=Midterm.SCALE_100, n_questions=4, correct_letter="a")
        qids = [str(q.id) for q in mt.questions()]
        answers = {qids[0]: "a", qids[1]: "a", qids[2]: "b", qids[3]: "b"}
        att = self._run(mt, answers)
        self.assertEqual(att.score, 50)

    def test_scale_800_perfect_is_800(self):
        mt = _make_midterm(scale=Midterm.SCALE_800, n_questions=5, correct_letter="a")
        qids = [str(q.id) for q in mt.questions()]
        att = self._run(mt, {qid: "a" for qid in qids})
        self.assertEqual(att.score, 800)  # 200 + round(1.0*600)

    def test_scale_800_empty_is_200(self):
        mt = _make_midterm(scale=Midterm.SCALE_800, n_questions=5, correct_letter="a")
        att = self._run(mt, {})
        self.assertEqual(att.score, 200)  # 200 + round(0*600)

    def test_scale_800_partial(self):
        mt = _make_midterm(scale=Midterm.SCALE_800, n_questions=4, correct_letter="a")
        qids = [str(q.id) for q in mt.questions()]
        att = self._run(mt, {qids[0]: "a", qids[1]: "a"})  # 2/4 = 0.5
        self.assertEqual(att.score, 500)  # 200 + round(0.5*600)

    def test_omitted_counts_against_denominator(self):
        mt = _make_midterm(scale=Midterm.SCALE_100, n_questions=4, correct_letter="a")
        qids = [str(q.id) for q in mt.questions()]
        # answer only 1 of 4 correctly, leave 3 blank
        att = self._run(mt, {qids[0]: "a"})
        self.assertEqual(att.score, 25)

    def test_uniq_active_attempt_blocks_second(self):
        from django.db import IntegrityError

        mt = _make_midterm()
        MidtermAttempt.objects.create(midterm=mt, student=self.student)
        with self.assertRaises(IntegrityError):
            MidtermAttempt.objects.create(midterm=mt, student=self.student)

    def test_timing_expiry(self):
        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=1)
        mt = Midterm.objects.create(
            title="T", subject=Midterm.MATH, scoring_scale=Midterm.SCALE_100,
            duration_minutes=1, question_module=module,
        )
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        att.start_attempt()
        from django.utils import timezone
        timing = get_midterm_timing(att, now=att.started_at + timezone.timedelta(seconds=30))
        self.assertFalse(timing.is_expired)
        self.assertEqual(timing.remaining_seconds, 30)
        timing2 = get_midterm_timing(att, now=att.started_at + timezone.timedelta(seconds=61))
        self.assertTrue(timing2.is_expired)
        self.assertEqual(timing2.remaining_seconds, 0)

    def test_pure_scorer_matches(self):
        mt = _make_midterm(scale=Midterm.SCALE_800, n_questions=4, correct_letter="a")
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        qids = [str(q.id) for q in mt.questions()]
        att.answers = {qids[0]: "a", qids[1]: "a", qids[2]: "a"}  # 3/4
        result = score_midterm_attempt(att)
        self.assertEqual(result["correct_count"], 3)
        self.assertEqual(result["total_count"], 4)
        self.assertEqual(result["score"], 200 + round(0.75 * 600))  # 650
