"""Homework is one award for the whole bundle — the school's rule, and its worked example.

Rewritten for the reward overhaul (``docs/rewards/OVERHAUL.md``). Five decisions landed under
this file at once and every one of them had a test pinning the behaviour it replaced:

* **§1** the bundle percentage is a **weighted** mean over items — ``Σ(percent × weight) /
  Σ(weight)``, where the old one was ``sum(percent) / len(items)`` and ``BundleItem`` had no
  ``weight`` at all — and it pays **proportionally**, ``round(15 × percent / 100)``, with no
  60% floor and no 15/10/5 bands. Vocabulary stops being one of the 0-or-100 booleans (§4);
  SAT content and hand-in stay binary by decision;
* **§2** it settles **immediately only at 100% before the deadline**; anything less writes
  *nothing at all* until the deadline, when it settles with an ``as_of`` cutoff that post-deadline
  work never enters;
* **§3** an assessment item is the **first** full-length graded attempt, not the best;
* **§4** a vocabulary item is **per-game accuracy × coverage over the four modes**, not 100 for
  having finished any one of them;
* **§7** a **CLASSWORK** assignment is never scored automatically at all.

Two things every test here depends on, both easy to get silently wrong:

``award`` and ``revoke`` swallow every exception by design (``services`` module docstring), so a
bug in the ledger raises nothing and fails nothing — it appears only as a log line. Assertions
are therefore on ``PointAward`` rows and on ``balance``, never on a return value being truthy.

``TestCase`` does not run ``transaction.on_commit`` callbacks, and the homework hooks all defer
to it (``hooks._recompute``). Every fixture that is meant to exercise a hook wraps its write in
``captureOnCommitCallbacks(execute=True)``; without that the fixture would still pass while
testing nothing at all.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from assessments.models import (
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentResult,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from exams.models import PracticeTest, TestAttempt
from rewards import constants
from rewards.homework import bundle_percent, recompute_bundle
from rewards.models import PointAward
from rewards.services import balance, xp_balance
from vocabulary.models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
)

User = get_user_model()

#: ``None`` is a meaningful value for the vocab-session ``homework`` binding (a self-study run),
#: so "not given" needs its own sentinel.
_UNSET = object()

#: What a 100% homework pays. Read from the same constant the code prices from, so a retune
#: moves the expectations with it instead of leaving 15 hard-coded in forty places.
HOMEWORK_MAX = constants.DEFAULT_POINTS[constants.EVENT_HOMEWORK]


def _pay(percent: float) -> int:
    """The proportional price of a bundle percentage — ``round(max × percent / 100)``.

    Spelled out rather than inlined because the numbers are unobvious at the edges: 50% is 8
    (``round(7.5)`` is banker's rounding to even), and 59% is 9 rather than the nothing the
    retired 60% floor used to pay.
    """
    return int(round(HOMEWORK_MAX * percent / 100))


def _u(email):
    return User.objects.create_user(email, "secret123")


class BundleFixture(TestCase):
    def setUp(self):
        self.teacher = _u("hw_t@t.com")
        self.classroom = Classroom.objects.create(
            name="Bundle", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = _u("hw_s@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, title="Week 1",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher,
        )
        self.section = VocabSection.objects.create(title="Bank", slug="bank")
        #: Bank words are unique per section, and several sets share this one.
        self._word_seq = 0

    # ── builders ──────────────────────────────────────────────────────────────

    def add_assessment(self, title, *, questions=4):
        aset = AssessmentSet.objects.create(title=title, created_by=self.teacher)
        for i in range(questions):
            AssessmentQuestion.objects.create(
                assessment_set=aset, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
                correct_answer="A", points=1,
            )
        return HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=self.assignment, assigned_by=self.teacher,
        )

    def grade(self, homework, percent, *, answered=None, at=None):
        """A graded attempt. ``answered`` pins ``question_order`` — a shorter list is what a
        "retry incorrect only" sitting produces. ``at`` is when it was handed in, which is the
        timestamp the deadline cutoff filters on (``submitted_at``, falling back to
        ``started_at``).

        Wrapped in ``captureOnCommitCallbacks`` because the reward hook defers to
        ``transaction.on_commit``; without it the fixture would silently stop exercising the
        hook at all, which is exactly how the "perfect homework pays 0" bug survived.
        """
        order = answered if answered is not None else list(
            homework.assessment_set.questions.values_list("id", flat=True)
        )
        with self.captureOnCommitCallbacks(execute=True):
            attempt = AssessmentAttempt.objects.create(
                homework=homework, student=self.student,
                status=AssessmentAttempt.STATUS_GRADED,
                submitted_at=at or timezone.now(), question_order=order,
            )
            AssessmentResult.objects.create(
                attempt=attempt, score_points=percent, max_points=100, percent=percent
            )
        return attempt

    def submit_without_grading(self, homework, *, answered=None, at=None):
        """A sitting that was handed in and never produced a result — grading failed.

        The only shape in which a genuine full-length sitting exists with no
        ``AssessmentResult`` behind it, and the one the subset guard has to be able to see:
        lengths read off graded results alone leave a failed first sitting invisible.

        No ``captureOnCommitCallbacks`` because there is nothing to capture — the reward hook
        hangs off ``AssessmentResult``, which is exactly the row this attempt never got.
        """
        order = answered if answered is not None else list(
            homework.assessment_set.questions.values_list("id", flat=True)
        )
        return AssessmentAttempt.objects.create(
            homework=homework, student=self.student,
            status=AssessmentAttempt.STATUS_SUBMITTED,
            submitted_at=at or timezone.now(), question_order=order,
        )

    def add_vocab(self, title="Set 1", *, words=4):
        """Attach one vocabulary set, **with words in it**, and return the homework link.

        The words are not decoration. A set's per-mode score is ``accuracy × coverage`` and
        coverage divides by the set's word count, so a wordless set scores 0 in every mode no
        matter how well it was played — a fixture with no words tests nothing.

        The link, not the set, is returned: ``_vocab_items`` matches sessions on
        ``VocabStudySession.homework`` as well as on the set, so the tests need it.
        """
        vset = VocabSet.objects.create(section=self.section, title=title)
        for i in range(words):
            self._word_seq += 1
            word = VocabWord.objects.create(
                section=self.section, word=f"word-{self._word_seq}", definition="d",
            )
            VocabSetItem.objects.create(vocab_set=vset, word=word, order=i)
        return VocabHomework.objects.create(
            classroom=self.classroom, assignment=self.assignment, vocab_set=vset
        )

    def add_word_to(self, link, *, at=None):
        """Append one word to an already-assigned set — a teacher editing it after the fact.

        The new row's ``created_at`` is pushed clear of "now" by an UPDATE rather than left to
        ``auto_now_add``. Coverage's denominator is how many words the set held **when the run
        finished**, so a word whose timestamp ties with the runs would leave the test unable to
        say which of the two rules it measured — and a tie is what a fixture that adds the word
        milliseconds after the last session produces.
        """
        self._word_seq += 1
        word = VocabWord.objects.create(
            section=self.section, word=f"word-{self._word_seq}", definition="d",
        )
        item = VocabSetItem.objects.create(
            vocab_set_id=link.vocab_set_id, word=word, order=99,
        )
        VocabSetItem.objects.filter(pk=item.pk).update(
            created_at=at or (timezone.now() + timedelta(minutes=1))
        )
        return item

    def play_vocab(self, link, mode, *, accuracy=100.0, distinct=None, at=None, homework=_UNSET):
        """One completed run of one study mode.

        ``distinct`` is how many of the set's words the run actually reached — the coverage
        numerator, and a different number from ``total_count`` in every mode (flashcards
        re-drill the missed pile into the same run and report every verdict). Defaults to the
        whole set.

        ``homework`` defaults to this link, which is what the finish endpoint writes. Pass
        ``None`` for a self-study run, or another link for a run done for a different class.
        """
        word_ids = list(
            VocabSetItem.objects.filter(vocab_set_id=link.vocab_set_id)
            .order_by("order")
            .values_list("word_id", flat=True)
        )
        reached = word_ids if distinct is None else word_ids[:distinct]
        session = VocabStudySession(
            user=self.student,
            vocab_set_id=link.vocab_set_id,
            mode=mode,
            homework=link if homework is _UNSET else homework,
            total_count=len(reached),
            correct_count=int(round(len(reached) * accuracy / 100)),
            accuracy=accuracy,
            completed_at=at or timezone.now(),
        )
        session.record_distinct_words(reached)
        with self.captureOnCommitCallbacks(execute=True):
            session.save()
        return session

    def finish_vocab(self, link, *, at=None, homework=_UNSET):
        """Play **every** mode perfectly — the only thing that is now worth 100% of a set.

        Iterates ``MODE_CHOICES`` rather than naming the modes, so this can never drift from
        the model the way the old fixture's ``mode="flashcards"`` had (the four valid codes are
        ``flashcard`` / ``matching`` / ``speed`` / ``test``; Django does not enforce ``choices``
        on ``create()``, so that row existed and scored as a mode nothing branches on).
        """
        for mode, _label in VocabStudySession.MODE_CHOICES:
            self.play_vocab(link, mode, at=at, homework=homework)

    def add_pastpaper(self, sections=1):
        tests = [
            PracticeTest.objects.create(subject="MATH", title=f"PP{i}", skip_default_modules=True)
            for i in range(sections)
        ]
        self.assignment.practice_test_ids = [t.id for t in tests]
        self.assignment.save(update_fields=["practice_test_ids"])
        return tests

    def sit(self, test, *, score=1200, at=None):
        return TestAttempt.objects.create(
            practice_test=test, student=self.student, score=score,
            is_completed=True, current_state=TestAttempt.STATE_COMPLETED,
            completed_at=at or timezone.now(),
        )

    def set_deadline(self, due_at, *, created_at=None):
        """Give the homework a deadline, and optionally backdate when it was set.

        ``created_at`` is ``auto_now_add`` and is the floor every item kind is measured from, so
        a deadline in the past needs the assignment to have been set before it — otherwise there
        is no window in which work could have counted and the test would pass for the wrong
        reason.
        """
        fields = {"due_at": due_at}
        if created_at is not None:
            fields["created_at"] = created_at
        Assignment.objects.filter(pk=self.assignment.pk).update(**fields)
        self.assignment.refresh_from_db()

    def settle(self):
        return recompute_bundle(self.assignment, self.student)

    # ── assertions ────────────────────────────────────────────────────────────

    def assertNoAward(self):
        """No row at all — which is a different fact from a row worth zero.

        ``award`` swallows, so "the award failed" and "the gate refused to write" look identical
        from a return value. Only the table can tell them apart.
        """
        self.assertFalse(
            PointAward.objects.filter(student=self.student).exists(),
            "expected no PointAward row at all",
        )

    def assertPaid(self, percent):
        """Exactly one homework award, priced proportionally at ``percent``."""
        awards = list(PointAward.objects.filter(student=self.student))
        self.assertEqual(len(awards), 1, awards)
        self.assertEqual(awards[0].event, constants.EVENT_HOMEWORK)
        self.assertEqual(awards[0].points, _pay(percent))
        return awards[0]


class FixtureIntegrityTests(BundleFixture):
    """Pin the fixtures, because a broken fixture in this file is a FALSE GREEN, not a failure.

    Every assertion in this suite is on ledger rows, and ``award``/``revoke`` swallow every
    exception — so a fixture that quietly builds rows nothing matches produces a bundle worth
    0, an award of 0, and a suite that passes while testing nothing. The previous generation of
    this file shipped exactly that: ``mode="flashcards"`` is not one of the four valid mode
    codes, Django does not enforce ``choices`` on ``create()``, and the row sat in the database
    scoring against a mode no branch looks at.
    """

    def test_every_mode_the_vocab_fixture_plays_is_a_real_mode(self):
        vocab = self.add_vocab()
        self.finish_vocab(vocab)

        played = set(
            VocabStudySession.objects.filter(user=self.student).values_list("mode", flat=True)
        )
        valid = {code for code, _label in VocabStudySession.MODE_CHOICES}
        self.assertEqual(played, valid)
        self.assertEqual(valid, {"flashcard", "matching", "speed", "test"})

    def test_a_played_mode_records_the_accuracy_and_the_coverage_it_claims(self):
        vocab = self.add_vocab("Big", words=20)
        session = self.play_vocab(
            vocab, VocabStudySession.MODE_SPEED, accuracy=80.0, distinct=5
        )
        session.refresh_from_db()

        self.assertEqual(session.accuracy, 80.0)
        self.assertEqual(session.distinct_words, 5)
        self.assertAlmostEqual(session.coverage(20), 0.25)
        self.assertAlmostEqual(session.scaled_accuracy(20), 20.0)

    def test_a_vocab_set_the_fixture_builds_actually_has_words_in_it(self):
        """Coverage divides by the set's word count, so a wordless set scores 0 in every mode
        however well it was played — the shape the old fixture had."""
        from vocabulary.serializers import set_word_counts

        vocab = self.add_vocab(words=7)

        self.assertEqual(set_word_counts([vocab.vocab_set_id]), {vocab.vocab_set_id: 7})

    def test_the_grade_fixture_produces_a_graded_attempt_with_a_result(self):
        homework = self.add_assessment("A", questions=4)
        attempt = self.grade(homework, 75)

        attempt.refresh_from_db()
        self.assertEqual(attempt.status, AssessmentAttempt.STATUS_GRADED)
        self.assertEqual(len(attempt.question_order), 4)
        self.assertEqual(float(AssessmentResult.objects.get(attempt=attempt).percent), 75.0)

    def test_backdating_the_deadline_really_moves_created_at(self):
        """``created_at`` is ``auto_now_add``: a plain ``save()`` would not move it, and a
        deadline in the past with the assignment still created "now" leaves no window in which
        any work could count — every deadline test would then pass for the wrong reason."""
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))

        self.assertLess(self.assignment.created_at, self.assignment.due_at)
        self.assertLess(self.assignment.due_at, now)

    def test_the_on_commit_capture_is_what_makes_the_hooks_run(self):
        """``TestCase`` does not run ``transaction.on_commit`` callbacks and every homework hook
        defers to it, so a fixture without the capture exercises nothing. This asserts the
        difference directly rather than trusting it."""
        homework = self.add_assessment("A")

        attempt = AssessmentAttempt.objects.create(
            homework=homework, student=self.student,
            status=AssessmentAttempt.STATUS_GRADED,
            submitted_at=timezone.now(),
            question_order=list(homework.assessment_set.questions.values_list("id", flat=True)),
        )
        # The result is the row the hook hangs off — and with no capture it queues a callback
        # nothing will ever run, so a perfect homework pays nothing.
        AssessmentResult.objects.create(
            attempt=attempt, score_points=100, max_points=100, percent=100
        )
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertNoAward()

        # The identical write, captured: same rows, same hook, and now it pays.
        with self.captureOnCommitCallbacks(execute=True):
            AssessmentResult.objects.get(attempt=attempt).save()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)


class RealGradingPathTests(BundleFixture):
    """Drive the ACTUAL grading path, not a hand-built fixture.

    Every other test in this file constructs the attempt as GRADED and then the result — the
    inverse of what `grade_attempt` does, which writes the result first and flips the attempt
    afterwards. That inversion hid a bug where the reward hook ran while the attempt was still
    SUBMITTED and could not see its own grading, so a perfect homework paid nothing.
    """

    def sit_for_real(self, homework, *, correct=True):
        """Submit and grade one assessment through `grading_service.grade_attempt`."""
        from assessments.grading_service import grade_attempt
        from assessments.models import AssessmentAnswer

        questions = list(homework.assessment_set.questions.order_by("order"))
        attempt = AssessmentAttempt.objects.create(
            homework=homework, student=self.student,
            status=AssessmentAttempt.STATUS_SUBMITTED,
            submitted_at=timezone.now(),
            question_order=[q.id for q in questions],
        )
        for q in questions:
            AssessmentAnswer.objects.create(
                attempt=attempt, question=q, answer="A" if correct else "B"
            )
        with self.captureOnCommitCallbacks(execute=True):
            grade_attempt(attempt_id=attempt.pk)
        return attempt

    def test_a_perfect_homework_pays_when_graded_for_real(self):
        homework = self.add_assessment("A")
        self.sit_for_real(homework)

        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_a_two_assessment_bundle_pays_proportionally_as_each_is_graded(self):
        """The second grading must see the FIRST assessment's result as well as its own.

        Under the retired bands the halfway state paid nothing (50% was below the 60% floor) and
        the award was revoked; proportionally it is worth half the maximum, and the second
        grading raises the same row rather than adding one.
        """
        first = self.add_assessment("A")
        second = self.add_assessment("B")

        self.sit_for_real(first)
        self.assertEqual(balance(self.student), _pay(50))    # (100 + 0) / 2

        self.sit_for_real(second)
        self.assertEqual(balance(self.student), HOMEWORK_MAX)  # both at 100 → 100%
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)

    def test_a_failed_assessment_settles_at_zero_rather_than_writing_nothing(self):
        """A row worth 0 and no row at all are different facts, and this is the first.

        The student was assessed and earned nothing, which a later re-grade can raise. It is
        also what stops the next sweep re-pricing the award from the rule: ``award`` treats a
        stored 0 with no explicit ``points=`` as "not yet priced".
        """
        homework = self.add_assessment("A")
        self.sit_for_real(homework, correct=False)

        self.assertEqual(balance(self.student), 0)
        awarded = PointAward.objects.get(student=self.student)
        self.assertEqual(awarded.event, constants.EVENT_HOMEWORK)
        self.assertEqual(awarded.points, 0)


class TheSchoolsWorkedExampleTests(BundleFixture):
    def test_one_assessment_at_ninety_five_beside_one_vocab_set_is_ninety_seven_point_five(self):
        """The school's own worked example, and what falls out of uniform weights.

        Two items, so each is worth 50. The assessment scored 95 contributes 47.5, the finished
        vocabulary set contributes 50: 97.5%.

        The percentage is the same one the retired rule produced — assessments always carried
        their own percent. What changed underneath it is both other halves: reaching 100 on the
        vocabulary item now takes all four modes at full coverage rather than any one mode, and
        97.5% pays the full 15 proportionally where the 80–99 band paid 10.
        """
        assessment = self.add_assessment("A")
        vocab = self.add_vocab()

        self.grade(assessment, 95)
        self.finish_vocab(vocab)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 97.5)
        self.settle()
        self.assertPaid(97.5)

    def test_three_of_four_items_is_seventy_five_percent(self):
        done_assessment = self.add_assessment("A")
        self.add_assessment("B")                      # never attempted
        vocab = self.add_vocab()
        (paper,) = self.add_pastpaper()

        self.grade(done_assessment, 100)
        self.finish_vocab(vocab)
        self.sit(paper)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 75.0)
        self.settle()
        self.assertPaid(75.0)

    def test_a_partial_score_pulls_the_whole_bundle_down_proportionally(self):
        """Same three-of-four shape, but the completed assessment scored 60 rather than 100:
        (60 + 0 + 100 + 100) / 4 = 65%. The item's own percent carries through to the bundle.

        65% and 75% were the *same* award under the retired bands — both landed in 60–79 and
        paid 5. Proportionally they are 10 and 11, so the ten-point difference in one item's
        score is now visible in what the homework pays.
        """
        done_assessment = self.add_assessment("A")
        self.add_assessment("B")
        vocab = self.add_vocab()
        (paper,) = self.add_pastpaper()

        self.grade(done_assessment, 60)
        self.finish_vocab(vocab)
        self.sit(paper)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 65.0)
        self.settle()
        self.assertPaid(65.0)

    def test_every_item_carries_an_equal_weight_today(self):
        """``BundleItem.weight`` is the hook for a teacher-set split; all of them are 1.0 now,
        so N items each take a ``100/N`` share. Pinned so a future per-item weight cannot change
        the default shape without this failing."""
        from rewards.homework import bundle_items

        self.add_assessment("A")
        self.add_vocab()
        self.add_pastpaper()

        weights = [item.weight for item in bundle_items(self.assignment, self.student)]
        self.assertEqual(weights, [1.0, 1.0, 1.0])


class ProportionalPaymentTests(BundleFixture):
    """The 15/10/5 bands and the 60% floor are retired: ``round(max × percent / 100)``."""

    def test_everything_finished_perfectly_earns_the_maximum(self):
        a = self.add_assessment("A")
        vocab = self.add_vocab()
        self.grade(a, 100)
        self.finish_vocab(vocab)

        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_eighty_percent_earns_eighty_percent_of_the_maximum(self):
        """12, not the 10 the HIGH band used to pay."""
        a = self.add_assessment("A")
        self.grade(a, 80)
        self.settle()

        self.assertEqual(balance(self.student), 12)

    def test_fifty_nine_percent_is_paid_rather_than_falling_off_a_floor(self):
        """The inversion of the retired rule, and the sharpest one. Under the 60% floor this
        bundle earned nothing at all and no row was written; it is now worth 9."""
        a = self.add_assessment("A")
        self.grade(a, 59)
        self.settle()

        self.assertEqual(balance(self.student), 9)
        self.assertPaid(59)

    def test_the_price_is_read_live_from_the_rule_not_frozen_at_first_settlement(self):
        """Homework passes ``points=`` explicitly on every settlement, which is what lets a
        re-settled bundle move with its percentage. Everything else in the ledger is priced once
        at first recognition and deliberately never re-priced (``services.award``)."""
        from rewards.models import RewardRule

        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

        RewardRule.objects.update_or_create(
            event=constants.EVENT_HOMEWORK, defaults={"points": 30, "is_active": True},
        )
        self.settle()

        self.assertEqual(balance(self.student), 30)

    def test_an_untouched_bundle_settles_at_zero(self):
        """An assessment was set and nothing was done: 0%, which is a real assessed outcome and
        gets a row worth 0 — not the absence of one."""
        self.add_assessment("A")
        self.settle()

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(PointAward.objects.get(student=self.student).points, 0)

    def test_a_bundle_with_nothing_scoreable_is_skipped_rather_than_scored_zero(self):
        """An announcement-only assignment was never work to do."""
        self.assertIsNone(bundle_percent(self.assignment, self.student))
        self.settle()
        self.assertNoAward()


class DeadlineGateTests(BundleFixture):
    """§2 — immediate at 100%, else at the deadline, never after."""

    def test_a_deadlineless_homework_settles_live_at_whatever_it_is_worth(self):
        a = self.add_assessment("A")
        self.assertIsNone(self.assignment.due_at)

        self.grade(a, 60)

        self.assertEqual(balance(self.student), _pay(60))

    def test_a_hundred_percent_before_the_deadline_settles_immediately(self):
        self.set_deadline(timezone.now() + timedelta(days=2))
        a = self.add_assessment("A")

        self.grade(a, 100)   # the item hook alone, with no sweep

        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_under_a_hundred_before_the_deadline_writes_nothing_at_all(self):
        """Not a zero row — **no row**. The bundle is genuinely worth 90 and the gate still
        refuses to write it, because the deadline figure is the only one that pays."""
        self.set_deadline(timezone.now() + timedelta(days=2))
        a = self.add_assessment("A")
        self.add_assessment("B")

        self.grade(a, 90)
        self.settle()

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 45.0)
        self.assertNoAward()

    def test_an_interim_high_percent_is_never_banked_as_xp_before_the_deadline(self):
        """Why writing nothing is load-bearing rather than an optimisation.

        XP is a high-water mark (``services.award`` takes ``max(previous_xp, …)``), so an award
        written the evening the first of three items came back perfect would bank that XP for
        ever — the deadline could take the points back and the board would stay wrong.
        """
        self.set_deadline(timezone.now() + timedelta(days=2))
        first = self.add_assessment("A")
        self.add_assessment("B")
        self.add_assessment("C")

        self.grade(first, 100)

        # The bundle really is worth a third of itself and one item really is perfect — it is
        # the gate withholding the write, not an empty bundle scoring nothing.
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100 / 3)
        self.assertNoAward()
        self.assertEqual(xp_balance(self.student), 0)

    def test_a_passed_deadline_pays_whatever_was_reached_by_then(self):
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))
        a = self.add_assessment("A")
        self.add_assessment("B")

        self.grade(a, 100, at=now - timedelta(days=2))
        self.settle()

        self.assertPaid(50)

    def test_work_done_after_the_deadline_does_not_raise_the_award(self):
        """The ``as_of`` cutoff is a filter on the source rows, not a frozen snapshot column.

        The vocabulary set really is finished — asked live, the bundle is worth 100% — and the
        award is still the 50% that had been reached when the deadline passed.
        """
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))
        a = self.add_assessment("A")
        vocab = self.add_vocab()

        self.grade(a, 100, at=now - timedelta(days=2))          # in time
        self.finish_vocab(vocab, at=now - timedelta(hours=1))   # too late

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertAlmostEqual(
            bundle_percent(self.assignment, self.student, self.assignment.due_at), 50.0
        )
        self.settle()
        self.assertPaid(50)

    def test_every_item_kind_honours_the_cutoff(self):
        """One late item of each kind, so no kind can quietly opt out of the deadline.

        Assessments applied no time filter at all before this overhaul while vocabulary and SAT
        content did; the cutoff has to be answered the same way by all four or the one that
        forgets is the one that pays for post-deadline work.
        """
        now = timezone.now()
        late = now - timedelta(hours=1)
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))

        assessment = self.add_assessment("A")
        vocab = self.add_vocab()
        (paper,) = self.add_pastpaper()
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])

        self.grade(assessment, 100, at=late)
        self.finish_vocab(vocab, at=late)
        self.sit(paper, at=late)
        with self.captureOnCommitCallbacks(execute=True):
            Submission.objects.create(
                assignment=self.assignment, student=self.student,
                status=Submission.STATUS_SUBMITTED, submitted_at=late,
            )

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertAlmostEqual(
            bundle_percent(self.assignment, self.student, self.assignment.due_at), 0.0
        )
        self.settle()
        self.assertEqual(balance(self.student), 0)

    def test_a_carrier_born_already_overdue_still_settles_on_the_work_that_was_done(self):
        """A deadline that no work could ever have fitted inside is not a deadline.

        ``journals.delivery`` derives a carrier's ``due_at`` from the LESSON'S PLANNED DATE and
        never floors it at now — deliberately, so releasing lesson 5 a week late does not shorten
        its deadline to the next lesson. A class running behind schedule therefore gets an
        Assignment that is already overdue the instant it is minted: ``due_at`` BEFORE
        ``created_at``. The past-dated deadline predates this overhaul and was harmless until the
        cutoff existed to act on it.

        Read as a real deadline, the window ``[created_at, due_at]`` is inverted: every kind's
        source rows filter out and the whole class settles at 0% — MEASURED at 0 points for a
        perfect homework — and the sweep holds them there for seven days. Clamping ``as_of`` up
        to ``created_at`` is the obvious alternative and pays exactly the same 0, because the
        window is still empty; scoring it live is the only reading under which the work counts.
        """
        now = timezone.now()
        # Deliberately NOT backdating created_at — the deadline predating the assignment is the
        # whole shape under test.
        self.set_deadline(now - timedelta(days=1))
        self.assertLess(self.assignment.due_at, self.assignment.created_at)

        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()

        self.assertEqual(balance(self.student), HOMEWORK_MAX)
        self.assertPaid(100)

    def test_widening_the_sat_targets_after_the_deadline_does_not_flip_the_item_to_zero(self):
        """The numerator is frozen at the cutoff; the target list is read LIVE off the assignment.

        So attaching another paper after the deadline used to widen what the student owed
        retroactively: a settled 100 became a 0 — MEASURED, 15 points to 0 — and the sweep
        re-priced it that way every ten minutes for a week. A paper that did not exist when the
        window closed cannot be part of what was owed, so it drops out of the requirement, and no
        student can lose by that: an attempt cannot have been completed on a test that did not
        exist yet.
        """
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))
        (paper,) = self.add_pastpaper()
        # ``created_at`` is ``auto_now_add``, and a paper minted "now" is itself newer than the
        # deadline — it has to predate the deadline for the assignment to have targeted it.
        PracticeTest.objects.filter(pk=paper.pk).update(created_at=now - timedelta(days=4))

        self.sit(paper, at=now - timedelta(days=2))
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

        late = PracticeTest.objects.create(
            subject="MATH", title="Attached after the deadline", skip_default_modules=True,
        )
        self.assignment.practice_test_ids = [paper.id, late.id]
        self.assignment.save(update_fields=["practice_test_ids"])
        self.settle()

        self.assertEqual(balance(self.student), HOMEWORK_MAX)
        self.assertPaid(100)

    def test_a_hand_in_with_no_submitted_at_still_counts_at_the_deadline(self):
        """``Submission.submitted_at`` is nullable and rows really do carry NULL — a status set
        by an import, an ops fix, or any path that never called ``submit()``.

        Filtering the cutoff on ``submitted_at`` alone dropped those rows out of the window, so
        the same hand-in was worth 100 live and 0 at the deadline — MEASURED — which is the
        deadline confiscating a hand-in that plainly exists. ``created_at`` is ``auto_now_add``
        and can never be later than the real hand-in, so it is a safe floor to fall back to; the
        assessment path answers the identical question the identical way.
        """
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])

        with self.captureOnCommitCallbacks(execute=True):
            handed_in = Submission.objects.create(
                assignment=self.assignment, student=self.student,
                status=Submission.STATUS_SUBMITTED, submitted_at=None,
            )
        # In time by the only timestamp the row has left.
        Submission.objects.filter(pk=handed_in.pk).update(created_at=now - timedelta(days=2))

        self.assertAlmostEqual(
            bundle_percent(self.assignment, self.student, self.assignment.due_at), 100.0
        )
        self.settle()
        self.assertPaid(100)

    def test_the_sweep_re_running_after_the_deadline_lands_on_the_same_number(self):
        """``settle_due_homework`` re-runs every ten minutes for seven days after the due date,
        so a percentage that could move is a confiscation vector. The cutoff makes it a fixed
        point instead."""
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))
        a = self.add_assessment("A")
        self.add_assessment("B")
        self.grade(a, 100, at=now - timedelta(days=2))

        for _ in range(5):
            self.settle()

        self.assertPaid(50)


class ClassworkTests(BundleFixture):
    """§7 — classwork is paid by a teacher's hand, never by an outcome."""

    def test_a_classwork_assignment_earns_nothing_automatically(self):
        """Its carrier is an ordinary PUBLISHED ``Assignment`` minted by ``journals.delivery``,
        so without the category gate every journal item shared with a class already paid
        homework points nobody decided to give."""
        self.assignment.category = Assignment.CATEGORY_CLASSWORK
        self.assignment.save(update_fields=["category"])
        a = self.add_assessment("A")
        vocab = self.add_vocab()

        self.grade(a, 100)
        self.finish_vocab(vocab)

        # The arithmetic is fine and says 100%: it is the gate that refuses, not the score.
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertIsNone(self.settle())
        self.assertNoAward()

    def test_a_classwork_carrier_given_a_deadline_still_pays_nothing(self):
        """Classwork is deadline-less by decision, but a ``due_at`` set by hand or by a future
        form enrols it in ``settle_due_homework``. The category gate is the first line of
        ``recompute_bundle`` precisely so the sweep cannot switch scoring back on."""
        self.assignment.category = Assignment.CATEGORY_CLASSWORK
        self.assignment.save(update_fields=["category"])
        now = timezone.now()
        self.set_deadline(now - timedelta(days=1), created_at=now - timedelta(days=5))
        a = self.add_assessment("A")

        self.grade(a, 100, at=now - timedelta(days=2))
        self.settle()

        self.assertNoAward()


class FirstAttemptTests(BundleFixture):
    """§3 — the FIRST full-length graded attempt, not the best.

    This inverts a documented anti-farming principle and the school asked for it in those words.
    Both directions are pinned below because "first wins" is not "latest wins" either: a retry
    can neither raise nor lower what the first sitting scored.

    Reported, not tested here: ``POST /api/assessments/attempts/abandon/`` needs nothing but
    ownership and an abandoned attempt never produces a result, so under this rule it is a
    one-request way to discard a bad first sitting (OVERHAUL §3, out of scope §10).
    """

    def test_a_later_better_sitting_does_not_raise_the_first_attempts_percent(self):
        a = self.add_assessment("A")
        self.grade(a, 20)
        self.grade(a, 100)    # a re-sit does not count, however good it was

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 20.0)
        self.settle()
        self.assertPaid(20)

    def test_a_later_worse_sitting_does_not_lower_the_first_attempts_percent_either(self):
        """The half of the old "best, never latest" rule that survives: a deliberately bad retry
        still cannot confiscate what a student banked."""
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.grade(a, 20)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.settle()
        self.assertPaid(100)

    def test_attempts_are_ordered_by_id_when_they_share_a_start_timestamp(self):
        """``started_at`` is a plain ``default=timezone.now``, not ``auto_now_add``, so two
        attempts can carry the identical value and only the id is strictly monotonic."""
        a = self.add_assessment("A")
        first = self.grade(a, 30)
        second = self.grade(a, 90)
        AssessmentAttempt.objects.filter(pk__in=[first.pk, second.pk]).update(
            started_at=timezone.now()
        )

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 30.0)


class AntiFarmingTests(BundleFixture):
    def test_a_retry_over_a_subset_of_questions_is_ignored(self):
        """"Retry incorrect only" mints an attempt over a SUBSET whose percent is measured
        against that subset. Answering the one remaining question reads as 100% — the easiest
        way to farm the whole system."""
        a = self.add_assessment("A", questions=4)
        self.grade(a, 50)                       # full-length sitting
        self.grade(a, 100, answered=[1])        # one-question retry

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 50.0)
        self.settle()
        self.assertPaid(50)

    def test_a_retry_cannot_score_by_outliving_the_sitting_whose_grading_failed(self):
        """The subset guard has to see sittings that never produced a RESULT.

        This replaces ``test_a_subset_sitting_taken_first_is_skipped_for_the_full_length_one``,
        which pinned a shape the product cannot build. "Retry incorrect only" mints its subset
        FROM an earlier full sitting, so a subset can never be a student's earliest attempt;
        and length is now measured only over the attempts that started at or before the
        candidate, precisely so the earliest attempt always qualifies — it cannot be a retry of
        something that does not exist yet. That test asked for a first attempt to be discarded
        on the evidence of a later one, which is the confiscation the running maximum exists to
        prevent.

        What is still reachable, and still the whole point of the guard, is this: the first
        sitting is handed in, grading fails, and the attempt sits at SUBMITTED with no
        ``AssessmentResult``. Measure lengths off graded results alone and only the retries are
        visible — the one-question retry becomes the yardstick it is measured against, reads as
        full length, and scores 100% for one question. Counting SUBMITTED attempts as sittings
        is what keeps the real four-question yardstick in view.
        """
        a = self.add_assessment("A", questions=4)
        stalled = self.submit_without_grading(a)   # the real sitting; grading never landed
        self.grade(a, 100, answered=[1])           # a one-question "retry incorrect only"

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)
        self.settle()
        self.assertEqual(balance(self.student), 0)

        # Not a permanent lockout — the slot the guard held open belongs to the stalled sitting,
        # and re-running its grading fills it with the score it always had.
        with self.captureOnCommitCallbacks(execute=True):
            AssessmentResult.objects.create(
                attempt=stalled, score_points=55, max_points=100, percent=55
            )
            AssessmentAttempt.objects.filter(pk=stalled.pk).update(
                status=AssessmentAttempt.STATUS_GRADED
            )

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 55.0)

    def test_an_attempt_with_no_recorded_order_still_counts(self):
        """Blank ``question_order`` means "not recorded", not "zero questions". Treating it as
        a subset would silently discard a student's only real attempt."""
        a = self.add_assessment("A")
        self.grade(a, 100, answered=[])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_archiving_a_question_does_not_zero_the_assessment(self):
        """The guard must not measure against the set's LIVE question count.

        A teacher archiving one question of four makes every later sitting pin 3 ids against
        a count of 4 — so a genuine full attempt reads as a re-try and the assessment scores
        0 forever, for every student on it.
        """
        homework = self.add_assessment("A", questions=4)
        homework.assessment_set.questions.order_by("order").last().delete()
        self.grade(homework, 100)   # a full sitting of what now remains: 3 questions

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_adding_a_question_does_not_confiscate_banked_points(self):
        """Same trap, worse outcome: the deadline sweep re-runs on its own, so a set edited
        after the fact would take back points the student had already earned."""
        homework = self.add_assessment("A", questions=4)
        self.grade(homework, 100)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

        AssessmentQuestion.objects.create(
            assessment_set=homework.assessment_set, order=99, prompt="Late addition",
            question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
            choices=[{"id": "A", "text": "a"}], correct_answer="A", points=1,
        )
        self.settle()

        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_a_resit_of_a_lengthened_set_must_not_confiscate_the_banked_attempt(self):
        """The banked sitting SURVIVES a teacher's edit plus the student's own re-sit.

        Measured before the fix: 15 points fell to 3. ``full_length`` was ``max()`` over ALL of
        the student's attempts, so appending a fifth question and re-sitting made the banked
        four-question sitting shorter than the new maximum; it was dropped as a "retry over a
        subset", the re-sit became the first surviving attempt, and the homework re-priced from
        100% to 20%. That is the exact harm OVERHAUL §3 names, reached by a route the live-count
        defence does not cover — and a student losing 12 points for doing extra work.

        A running maximum over the attempts that started at or before the candidate closes it: a
        "retry incorrect only" is by construction a subset of a sitting that came BEFORE it, so a
        later attempt can never be evidence that an earlier one was a retry.

        Asserted as the banked PERCENT surviving, not merely as some points remaining. Under the
        old rule the bundle was still worth 20% and still paid 3, so "non-zero" passed while the
        confiscation happened; only "the first sitting's 100 is still the score, still 15 points"
        can tell the two apart. ``test_adding_a_question_does_not_confiscate_banked_points``
        above covers only the case where the student does not re-sit, which is why this needed
        its own test.
        """
        homework = self.add_assessment("A", questions=4)
        self.grade(homework, 100)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

        AssessmentQuestion.objects.create(
            assessment_set=homework.assessment_set, order=99, prompt="Late addition",
            question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
            choices=[{"id": "A", "text": "a"}], correct_answer="A", points=1,
        )
        self.grade(homework, 20)     # the student re-sits the now five-question set
        self.settle()

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertEqual(balance(self.student), HOMEWORK_MAX)
        self.assertPaid(100)

    def test_repeated_settling_never_stacks_a_second_award(self):
        a = self.add_assessment("A")
        self.grade(a, 100)
        for _ in range(5):
            self.settle()

        self.assertEqual(balance(self.student), HOMEWORK_MAX)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)


class VocabularyScoringTests(BundleFixture):
    """§4 — per game, by accuracy, discounted by coverage.

    The retired rule was "100 if any one mode was completed", which is what made a 30-second
    speed run worth a whole homework item.
    """

    def test_one_mode_of_four_is_a_quarter_of_the_set(self):
        vocab = self.add_vocab()
        self.play_vocab(vocab, VocabStudySession.MODE_FLASHCARD)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 25.0)

    def test_all_four_modes_played_perfectly_is_the_whole_set(self):
        vocab = self.add_vocab()
        self.finish_vocab(vocab)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_a_modes_accuracy_scales_its_quarter(self):
        vocab = self.add_vocab()
        self.play_vocab(vocab, VocabStudySession.MODE_TEST, accuracy=60.0)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 15.0)

    def test_speed_accuracy_is_discounted_by_the_words_it_never_reached(self):
        """Speed reports only the prompts answered before its 60-second clock expires, so two of
        twenty answered correctly stores ``accuracy = 100``. Coverage is what makes that
        worth 10% of the mode rather than all of it."""
        vocab = self.add_vocab("Big", words=20)
        self.play_vocab(vocab, VocabStudySession.MODE_SPEED, accuracy=100.0, distinct=2)

        # accuracy 100 × coverage 0.1 = 10 for the mode; one mode of four = 2.5% of the set.
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 2.5)

    def test_flashcard_redrills_cannot_push_coverage_over_the_whole_set(self):
        """Flashcards re-drill the missed pile into the same run and report every verdict, so
        ``total_count`` exceeds the set size. Coverage counts DISTINCT words and is capped, so a
        18-verdict run over 4 words is still exactly one set's worth."""
        vocab = self.add_vocab(words=4)
        session = self.play_vocab(vocab, VocabStudySession.MODE_FLASHCARD)
        session.total_count = 18
        session.correct_count = 18
        session.save(update_fields=["total_count", "correct_count"])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 25.0)

    def test_the_first_run_of_a_mode_counts_and_a_replay_does_not(self):
        """Matching the assessment rule. A replay mints a new row, and a re-run is practice."""
        vocab = self.add_vocab()
        self.play_vocab(vocab, VocabStudySession.MODE_MATCHING, accuracy=40.0)
        self.play_vocab(vocab, VocabStudySession.MODE_MATCHING, accuracy=100.0)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 10.0)

    def test_an_unfinished_run_scores_nothing_for_its_mode(self):
        vocab = self.add_vocab()
        session = self.play_vocab(vocab, VocabStudySession.MODE_TEST)
        VocabStudySession.objects.filter(pk=session.pk).update(completed_at=None)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

    def test_a_run_done_for_another_classs_homework_does_not_credit_this_one(self):
        """The same set is routinely assigned to two classes. ``VocabStudySession.homework`` is
        written at session start, so finishing it for class B must not credit class A.

        The other class is a genuinely different ``Classroom`` — this test used to build it with
        ``classroom=self.classroom``, which made it a second assignment inside the SAME class and
        therefore bit-for-bit the fixture of
        ``test_one_set_on_two_assignments_of_the_same_class_credits_both``, which asserts the
        opposite. The two cases are decided by different rules and neither can be trusted while
        one of them is testing the other's scenario under its own name.

        Note what the scoping keys on: the session's homework link belonging to THIS classroom,
        never to this exact link. That is the weaker claim on purpose — ``SessionCreateView``
        guesses the newest live link when the client names no assignment, so it can pick the
        wrong link, but only ever one carrying the set inside a class the student is in.
        """
        other_classroom = Classroom.objects.create(
            name="Other class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=other_classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        other_assignment = Assignment.objects.create(
            classroom=other_classroom, title="Other class",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher,
        )
        vocab = self.add_vocab()
        other_link = VocabHomework.objects.create(
            classroom=other_classroom, assignment=other_assignment,
            vocab_set_id=vocab.vocab_set_id,
        )
        self.finish_vocab(vocab, homework=other_link)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)
        self.assertAlmostEqual(bundle_percent(other_assignment, self.student), 100.0)

    def test_adding_a_word_after_the_runs_does_not_lower_the_coverage_they_earned(self):
        """Coverage divides by how big the set was **when the run finished**, not by how big it
        is now.

        The live count is the same trap the assessment length guard exists to avoid: it moves,
        and the builder blocks removing a word from a live homework set while permitting adding
        one, so it only ever moves in the direction that costs the student. MEASURED: a fifth
        word appended after four perfect runs re-read them as 80% coverage, and the deadline
        sweep re-priced the homework downward every ten minutes for a week for work the student
        cannot redo.
        """
        vocab = self.add_vocab(words=4)
        self.finish_vocab(vocab)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

        self.add_word_to(vocab)   # the teacher extends the set after every run is finished

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_a_set_with_no_words_in_it_drops_out_instead_of_capping_the_bundle(self):
        """An empty set is not work, and it must not sit in the denominator scoring 0 for ever.

        Every mode's percent divides by the set's size, so an empty set is 0 in all four however
        it is played — there is nothing the student can do about it. MEASURED: an assessment
        finished perfectly beside one wordless set capped the whole homework at 50%. Dropping it
        is the answer this module already gives an announcement-only assignment: nothing
        scoreable, rather than scored zero.
        """
        a = self.add_assessment("A")
        self.add_vocab("Empty", words=0)

        self.grade(a, 100)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_an_empty_speed_run_does_not_become_the_permanent_score_for_its_mode(self):
        """Speed auto-finishes when its 60-second clock expires, so a round the student never
        played still writes a COMPLETED row with ``total_count = 0``.

        The FIRST completed run per mode is the one that scores, so that row became a permanent,
        unimprovable 0 over a quarter of the set — MEASURED at 75% for a student who then played
        all four modes perfectly, with no replay able to move it. A run that answered nothing is
        not a sitting, which is the same answer the assessment rule gives a blank attempt.
        """
        vocab = self.add_vocab()
        # Explicit timestamps rather than two calls a millisecond apart: the mode's score is
        # decided by which completed run sorts first, so the ordering has to be unambiguous.
        opened = self.assignment.created_at + timedelta(minutes=1)
        self.play_vocab(
            vocab, VocabStudySession.MODE_SPEED, accuracy=0.0, distinct=0, at=opened
        )
        self.finish_vocab(vocab, at=opened + timedelta(minutes=1))

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

    def test_one_set_on_two_assignments_of_the_same_class_credits_both(self):
        """``VocabStudySession.homework`` is not the binding it looks like.

        The finish endpoint binds every run to the NEWEST published ``VocabHomework`` for that
        set across all of the student's classrooms, because nothing tells it which card the
        student actually opened. Filtering on that FK was MEASURED to pay the wrong assignment
        outright: one set on two published assignments of the SAME classroom scored 0% and 100%
        where both were owed 100%. Matching on the student and the set credits both, which is how
        this behaved before the overhaul and is much the lesser wrong; the time floor is what
        keeps other terms' work out.

        Note the tension with ``test_a_run_done_for_another_classs_homework_does_not_credit_this_one``
        below, which pins the opposite for this same shape. That test is owned by the classroom
        scoping being restored in ``homework.py``; it is reported, not reconciled here.
        """
        second = Assignment.objects.create(
            classroom=self.classroom, title="Week 2",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher,
        )
        vocab = self.add_vocab()
        second_link = VocabHomework.objects.create(
            classroom=self.classroom, assignment=second, vocab_set_id=vocab.vocab_set_id,
        )
        # Every run lands on the newest link, whichever of the two cards was opened.
        self.finish_vocab(vocab, homework=second_link)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)
        self.assertAlmostEqual(bundle_percent(second, self.student), 100.0)

    def test_a_self_study_run_still_counts(self):
        """An unbound run belongs to nobody else — a student who opened the set from the library
        rather than from the homework card did the work. The time floor keeps last term's out."""
        vocab = self.add_vocab()
        self.finish_vocab(vocab, homework=None)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)


class CorrectionTests(BundleFixture):
    def test_finishing_another_item_raises_the_award_in_place(self):
        a = self.add_assessment("A")
        vocab = self.add_vocab()
        self.grade(a, 100)
        self.settle()
        self.assertEqual(balance(self.student), _pay(50))   # (100 + 0) / 2

        self.finish_vocab(vocab)
        self.settle()

        self.assertEqual(balance(self.student), HOMEWORK_MAX)   # (100 + 100) / 2
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)

    def test_a_regrade_lowers_the_points_and_leaves_the_xp_standing(self):
        """§6/§8 — "XP is never taken away for doing WORSE".

        ``award`` keeps ``max(previous_xp, …)``, so a downgrade moves the points alone. Only a
        withdrawn fact reaches ``revoke``, which now zeroes both.
        """
        a = self.add_assessment("A")
        result = self.grade(a, 100)
        self.settle()
        self.assertEqual(balance(self.student), HOMEWORK_MAX)
        self.assertEqual(xp_balance(self.student), HOMEWORK_MAX)

        AssessmentResult.objects.filter(attempt=result).update(percent=10)
        self.settle()

        self.assertEqual(balance(self.student), _pay(10))
        self.assertEqual(xp_balance(self.student), HOMEWORK_MAX)

    def test_detaching_every_item_revokes_the_award_and_takes_its_xp(self):
        """The bundle stops being work to do at all, which is a withdrawn fact rather than a
        smaller one — so unlike a re-grade it clears the XP as well."""
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()
        self.assertEqual(xp_balance(self.student), HOMEWORK_MAX)

        a.delete()
        self.settle()

        self.assertEqual(balance(self.student), 0)
        self.assertEqual(xp_balance(self.student), 0)

    def test_draft_homework_is_never_scored(self):
        """Draft work has not been given to anyone. The academic leaderboard excludes drafts
        too, and a reward that disagreed with it about what "assigned" means is indefensible."""
        self.assignment.status = Assignment.STATUS_DRAFT
        self.assignment.save(update_fields=["status"])

        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()

        self.assertNoAward()

    def test_unpublishing_does_not_confiscate_points_already_earned(self):
        """A deliberate asymmetry. Never-published work earns nothing, but work a student
        genuinely completed does not lose its points because a teacher later toggled the
        assignment back to draft."""
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.assertEqual(balance(self.student), HOMEWORK_MAX)

        self.assignment.status = Assignment.STATUS_DRAFT
        self.assignment.save(update_fields=["status"])
        self.settle()

        self.assertEqual(balance(self.student), HOMEWORK_MAX)


class ItemKindTests(BundleFixture):
    def test_a_pastpaper_needs_every_section_finished(self):
        first, second = self.add_pastpaper(sections=2)
        self.sit(first)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

        self.sit(second)
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_a_pastpaper_stays_binary_rather_than_scoring_its_sat_total(self):
        """SAT content is deliberately NOT proportional: the score is a 200-floored scale with
        no stored denominator, and reading a percentage out of it means re-checking every answer
        on a path that already runs on every save."""
        (paper,) = self.add_pastpaper()
        self.sit(paper, score=430)

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_a_hand_in_counts_once_submitted_without_waiting_to_be_marked(self):
        """A student must not lose points to their teacher's marking backlog."""
        self.assignment.external_url = "https://example.com/worksheet"
        self.assignment.save(update_fields=["external_url"])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

        Submission.objects.create(
            assignment=self.assignment, student=self.student,
            status=Submission.STATUS_SUBMITTED, submitted_at=timezone.now(),
        )
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_an_upload_only_homework_still_carries_a_hand_in_item(self):
        """``allow_file_upload`` is the flag that opens the upload box and was never consulted,
        so "just hand your work in" homework had no item at all — a student who handed it in was
        scored as though the bundle carried nothing."""
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

        Submission.objects.create(
            assignment=self.assignment, student=self.student,
            status=Submission.STATUS_SUBMITTED, submitted_at=timezone.now(),
        )
        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 100.0)

    def test_a_link_list_homework_carries_a_hand_in_item(self):
        """``external_urls`` is the documented source of truth; the singular mirror only holds
        the first."""
        self.assignment.external_urls = ["https://example.com/a", "https://example.com/b"]
        self.assignment.save(update_fields=["external_urls"])

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

    def test_a_pastpaper_sat_before_the_homework_existed_does_not_count(self):
        """Library content is re-assigned constantly — the same paper for a revision week, the
        same vocab set for a second class. Without a floor, last term's work satisfies this
        term's homework and the student is paid for an assignment they never opened."""
        (paper,) = self.add_pastpaper()
        self.sit(paper, at=self.assignment.created_at - timedelta(days=7))

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

    def test_a_vocabulary_set_finished_before_the_homework_existed_does_not_count(self):
        vocab = self.add_vocab()
        self.finish_vocab(vocab, at=self.assignment.created_at - timedelta(days=7))

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

    def test_an_assessment_sat_before_the_homework_existed_does_not_count(self):
        """Assessments applied no time floor at all before this overhaul — the one kind that
        answered "did this FOR this homework" differently from the other three."""
        a = self.add_assessment("A")
        self.grade(a, 100, at=self.assignment.created_at - timedelta(days=7))

        self.assertAlmostEqual(bundle_percent(self.assignment, self.student), 0.0)

    def test_the_award_records_the_classroom(self):
        a = self.add_assessment("A")
        self.grade(a, 100)
        self.settle()

        awarded = PointAward.objects.get(student=self.student)
        self.assertEqual(awarded.classroom_id, self.classroom.id)
        self.assertEqual(awarded.source_type, "assignment")
