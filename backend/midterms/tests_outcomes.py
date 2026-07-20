"""Score interpretation: normalization, pass marks, certificate tiers, verdicts, retakes.

The recurring hazard these tests guard is the SCALE_800 floor: a blank paper scores 200,
so any rule written as "percent of the ceiling" silently misclassifies every weak student.
Several tests below exist only to pin that.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from exams.models import Module, Question
from midterms.access import retake_eligibility, retake_eligible_students
from midterms.models import Midterm, MidtermAttempt, MidtermOutcome, MidtermQuestionResult
from midterms.outcomes import (
    DEFAULT_PASS_FRACTION,
    TIER_DEVELOPING,
    TIER_DISTINGUISHED,
    TIER_EMERGING,
    TIER_PROFICIENT,
    citation_for,
    default_pass_mark,
    fraction,
    is_passing,
    score_for_fraction,
    tier_for,
)
from midterms.scoring import SCALE_100, SCALE_800

User = get_user_model()


def _midterm(*, scale=SCALE_100, mtype=Midterm.TYPE_MIDTERM, pass_mark=None, parent=None, n=4):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=25)
    for i in range(n):
        Question.objects.create(
            module=module, question_type="MATH", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", score=10, order=i,
        )
    return Midterm.objects.create(
        title="MT", subject=Midterm.MATH, scoring_scale=scale, midterm_type=mtype,
        pass_mark=pass_mark, retake_of=parent, question_module=module, is_published=True,
    )


class FractionTests(TestCase):
    def test_scale_100_is_the_score_itself(self):
        self.assertAlmostEqual(fraction(0, SCALE_100), 0.0)
        self.assertAlmostEqual(fraction(50, SCALE_100), 0.50)
        self.assertAlmostEqual(fraction(100, SCALE_100), 1.0)

    def test_scale_800_measures_from_200_not_from_zero(self):
        # The whole point: a blank 800-scale paper is 0% of the work, not 25%.
        self.assertAlmostEqual(fraction(200, SCALE_800), 0.0)
        self.assertAlmostEqual(fraction(500, SCALE_800), 0.50)
        self.assertAlmostEqual(fraction(800, SCALE_800), 1.0)

    def test_none_reads_as_zero_never_as_a_pass(self):
        self.assertEqual(fraction(None, SCALE_100), 0.0)
        self.assertEqual(fraction(None, SCALE_800), 0.0)

    def test_out_of_range_legacy_scores_clamp(self):
        # Migrated attempts were scored under the old per-module cap and can sit outside
        # the current bounds; a negative fraction would corrupt every downstream rule.
        self.assertEqual(fraction(150, SCALE_800), 0.0)
        self.assertEqual(fraction(900, SCALE_800), 1.0)

    def test_round_trips_through_score_for_fraction(self):
        for scale in (SCALE_100, SCALE_800):
            for frac in (0.0, 0.3, 0.5, 0.8, 1.0):
                self.assertAlmostEqual(fraction(score_for_fraction(frac, scale), scale), frac, places=2)


class TierTests(TestCase):
    def test_scale_100_bands(self):
        self.assertEqual(tier_for(0, SCALE_100), TIER_EMERGING)
        self.assertEqual(tier_for(29, SCALE_100), TIER_EMERGING)
        self.assertEqual(tier_for(35, SCALE_100), TIER_DEVELOPING)
        self.assertEqual(tier_for(65, SCALE_100), TIER_PROFICIENT)
        self.assertEqual(tier_for(95, SCALE_100), TIER_DISTINGUISHED)

    def test_boundaries_belong_to_the_higher_band(self):
        # The stated bands (1-30, 30-50, 50-80, 80+) overlap; this pins the resolution.
        self.assertEqual(tier_for(30, SCALE_100), TIER_DEVELOPING)
        self.assertEqual(tier_for(50, SCALE_100), TIER_PROFICIENT)
        self.assertEqual(tier_for(80, SCALE_100), TIER_DISTINGUISHED)

    def test_scale_800_bands_match_the_same_share_of_work(self):
        self.assertEqual(tier_for(200, SCALE_800), TIER_EMERGING)  # blank paper
        self.assertEqual(tier_for(380, SCALE_800), TIER_DEVELOPING)  # exactly 30%
        self.assertEqual(tier_for(500, SCALE_800), TIER_PROFICIENT)  # exactly 50%
        self.assertEqual(tier_for(680, SCALE_800), TIER_DISTINGUISHED)  # exactly 80%

    def test_blank_800_paper_is_not_proficient(self):
        # The regression a percent-of-ceiling rule would introduce: 200/800 = 25%.
        self.assertNotEqual(tier_for(200, SCALE_800), TIER_PROFICIENT)

    def test_every_tier_has_distinct_wording(self):
        seen = {
            citation_for(s, SCALE_100, period="June 2026", subject="Math")["citation"]
            for s in (10, 40, 65, 95)
        }
        self.assertEqual(len(seen), 4)

    def test_citation_collapses_a_blank_period(self):
        text = citation_for(90, SCALE_100)["citation"]
        self.assertNotIn("  ", text)
        self.assertFalse(text.endswith(" "))


class PassMarkTests(TestCase):
    def test_default_is_half_the_questions_on_both_scales(self):
        self.assertEqual(default_pass_mark(SCALE_100), 50)
        self.assertEqual(default_pass_mark(SCALE_800), 500)
        self.assertAlmostEqual(fraction(default_pass_mark(SCALE_800), SCALE_800), DEFAULT_PASS_FRACTION)

    def test_explicit_pass_mark_wins(self):
        mt = _midterm(scale=SCALE_100, pass_mark=70)
        self.assertEqual(mt.effective_pass_mark, 70)
        self.assertFalse(is_passing(69, mt))
        self.assertTrue(is_passing(70, mt))  # inclusive

    def test_blank_pass_mark_falls_back_to_the_scale_default(self):
        mt = _midterm(scale=SCALE_800, pass_mark=None)
        self.assertEqual(mt.effective_pass_mark, 500)

    def test_unscored_attempt_never_passes(self):
        self.assertFalse(is_passing(None, _midterm(pass_mark=0)))


class OutcomeTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(username="s1", email="s1@example.com", password="x", role="student")

    def _completed(self, midterm, *, correct):
        """An attempt answering the first ``correct`` questions right, the rest wrong."""
        qs = list(midterm.questions())
        answers = {str(q.id): ("a" if i < correct else "b") for i, q in enumerate(qs)}
        attempt = MidtermAttempt.objects.create(midterm=midterm, student=self.student, answers=answers)
        attempt.start_attempt()
        attempt.submit()
        attempt.complete()
        attempt.refresh_from_db()
        return attempt

    def test_pass_is_recorded_with_the_mark_in_force(self):
        mt = _midterm(scale=SCALE_100, pass_mark=50, n=4)
        self._completed(mt, correct=3)  # 75/100
        outcome = MidtermOutcome.objects.get(midterm=mt, student=self.student)
        self.assertTrue(outcome.passed)
        self.assertEqual(outcome.score, 75)
        self.assertEqual(outcome.pass_mark, 50)

    def test_fail_is_recorded(self):
        mt = _midterm(scale=SCALE_100, pass_mark=50, n=4)
        self._completed(mt, correct=1)  # 25/100
        self.assertFalse(MidtermOutcome.objects.get(midterm=mt, student=self.student).passed)

    def test_pre_midterm_produces_no_verdict(self):
        mt = _midterm(mtype=Midterm.TYPE_PRE_MIDTERM, pass_mark=90, n=4)
        self._completed(mt, correct=0)
        self.assertFalse(MidtermOutcome.objects.filter(midterm=mt).exists())

    def test_later_pass_mark_change_does_not_rewrite_a_recorded_verdict(self):
        mt = _midterm(scale=SCALE_100, pass_mark=50, n=4)
        self._completed(mt, correct=3)  # 75 -> pass at 50
        Midterm.objects.filter(pk=mt.pk).update(pass_mark=90)
        outcome = MidtermOutcome.objects.get(midterm=mt, student=self.student)
        self.assertTrue(outcome.passed)
        self.assertEqual(outcome.pass_mark, 50)

    def test_one_verdict_per_student_per_midterm(self):
        mt = _midterm(scale=SCALE_100, n=4)
        self._completed(mt, correct=4)
        self.assertEqual(MidtermOutcome.objects.filter(midterm=mt, student=self.student).count(), 1)


class QuestionResultFreezeTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(username="s2", email="s2@example.com", password="x", role="student")

    def test_freezes_one_row_per_question_and_agrees_with_the_score(self):
        mt = _midterm(scale=SCALE_100, n=4)
        qs = list(mt.questions())
        answers = {str(qs[0].id): "a", str(qs[1].id): "a", str(qs[2].id): "b"}  # q3 omitted
        attempt = MidtermAttempt.objects.create(midterm=mt, student=self.student, answers=answers)
        attempt.start_attempt(); attempt.submit(); attempt.complete()
        attempt.refresh_from_db()

        rows = list(MidtermQuestionResult.objects.filter(attempt=attempt))
        self.assertEqual(len(rows), 4)
        self.assertEqual(sum(1 for r in rows if r.is_correct), 2)
        self.assertEqual(attempt.score, 50)  # 2 of 4
        self.assertEqual(sum(1 for r in rows if not r.answered), 1)

    def test_survives_the_question_being_deleted_afterwards(self):
        # The reason question_id is a plain integer: builder edits trim mirrored questions,
        # and a CASCADE would erase the history this table exists to keep.
        mt = _midterm(scale=SCALE_100, n=3)
        attempt = MidtermAttempt.objects.create(midterm=mt, student=self.student, answers={})
        attempt.start_attempt(); attempt.submit(); attempt.complete()
        self.assertEqual(MidtermQuestionResult.objects.filter(attempt=attempt).count(), 3)

        mt.questions().first().delete()
        self.assertEqual(MidtermQuestionResult.objects.filter(attempt=attempt).count(), 3)

    def test_denormalizes_skill_and_domain_names(self):
        from questionbank.models import BankDomain, BankSkill, Subject

        domain = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra")
        skill = BankSkill.objects.create(domain=domain, name="Linear functions", code="linear-functions")
        mt = _midterm(scale=SCALE_100, n=2)
        mt.questions().update(skill=skill)

        attempt = MidtermAttempt.objects.create(midterm=mt, student=self.student, answers={})
        attempt.start_attempt(); attempt.submit(); attempt.complete()

        row = MidtermQuestionResult.objects.filter(attempt=attempt).first()
        self.assertEqual(row.skill_name, "Linear functions")
        self.assertEqual(row.domain_name, "Algebra")

    def test_renaming_the_skill_later_does_not_rewrite_history(self):
        from questionbank.models import BankDomain, BankSkill, Subject

        domain = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra")
        skill = BankSkill.objects.create(domain=domain, name="Linear functions", code="linear-functions")
        mt = _midterm(scale=SCALE_100, n=2)
        mt.questions().update(skill=skill)
        attempt = MidtermAttempt.objects.create(midterm=mt, student=self.student, answers={})
        attempt.start_attempt(); attempt.submit(); attempt.complete()

        skill.name = "Renamed skill"
        skill.save(update_fields=["name"])

        self.assertEqual(MidtermQuestionResult.objects.filter(attempt=attempt).first().skill_name,
                         "Linear functions")


class RetakeGateTests(TestCase):
    def setUp(self):
        self.passer = User.objects.create_user(username="p", email="p@example.com", password="x", role="student")
        self.failer = User.objects.create_user(username="f", email="f@example.com", password="x", role="student")
        self.absentee = User.objects.create_user(username="a", email="a@example.com", password="x", role="student")
        self.parent = _midterm(scale=SCALE_100, pass_mark=60, n=4)
        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.passer, score=80, pass_mark=60,
            scoring_scale=SCALE_100, passed=True,
        )
        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.failer, score=40, pass_mark=60,
            scoring_scale=SCALE_100, passed=False,
        )
        self.retake = _midterm(mtype=Midterm.TYPE_RETAKE, parent=self.parent, pass_mark=60, n=4)

    def test_failer_is_eligible(self):
        self.assertEqual(retake_eligibility(self.failer, self.retake), (True, "ok"))

    def test_passer_is_refused(self):
        ok, reason = retake_eligibility(self.passer, self.retake)
        self.assertFalse(ok)
        self.assertEqual(reason, "retake_already_passed")

    def test_student_who_never_sat_the_parent_is_refused(self):
        ok, reason = retake_eligibility(self.absentee, self.retake)
        self.assertFalse(ok)
        self.assertEqual(reason, "retake_no_result")

    def test_ordinary_midterm_is_unaffected(self):
        self.assertEqual(retake_eligibility(self.passer, self.parent), (True, "ok"))

    def test_parentless_retake_degrades_to_an_ordinary_midterm(self):
        # An authoring mistake must not lock every student out.
        orphan = _midterm(mtype=Midterm.TYPE_RETAKE, parent=None)
        self.assertEqual(retake_eligibility(self.absentee, orphan), (True, "ok"))

    def test_eligible_students_lists_exactly_the_failers(self):
        ids = set(retake_eligible_students(self.retake).values_list("pk", flat=True))
        self.assertEqual(ids, {self.failer.pk})

    def test_eligible_students_is_empty_for_a_non_retake(self):
        self.assertEqual(retake_eligible_students(self.parent).count(), 0)
