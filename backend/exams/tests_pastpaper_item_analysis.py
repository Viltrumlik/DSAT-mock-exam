"""What the past-paper item analysis must never get wrong.

The numbers this report produces send a teacher to re-teach a topic, so every test here pins
a way the recorded data lies. The recorded data is genuinely dirty — 82 of 343 completed
two-module past-paper attempts carry the COPIED signature — and each defect pushes the error
rate UP, which is the direction that wastes a class's time.

Grouped by the hazard each case defends against, not by the function it calls.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from classes.pastpaper_report import UNCLASSIFIED
from exams.models import MockExam, PracticeTest, Question, TestAttempt
from exams.pastpaper_item_analysis import build_pastpaper_item_analysis, clamp_threshold
from questionbank.models import BankDomain, BankQuestion, BankSkill

User = get_user_model()

URL = "/api/exams/teacher/pastpaper-item-analysis/"


class PastpaperFixture(TestCase):
    """A two-module Math pastpaper, a classroom, and helpers to record sittings."""

    def setUp(self):
        self.teacher = User.objects.create_user("ia_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Senior G12 · Math · Item analysis",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        # Modules 1 and 2 are auto-created by PracticeTest's post_save.
        self.paper = PracticeTest.objects.create(
            subject="MATH", title="Practice Paper 7", collection_name="Bluebook"
        )
        self.m1 = self.paper.modules.get(module_order=1)
        self.m2 = self.paper.modules.get(module_order=2)

    # ── fixture helpers ──────────────────────────────────────────────────────
    def mc(self, module, *, order, answer="a", stem=None, **kw):
        return Question.objects.create(
            module=module,
            question_type="MATH",
            question_text=stem or f"MC q{order} in module {module.module_order}",
            option_a="Choice A",
            option_b="Choice B",
            correct_answers=answer,
            order=order,
            **kw,
        )

    def grid_in(self, module, *, order, answer="1/2", **kw):
        return Question.objects.create(
            module=module,
            question_type="MATH",
            question_text=f"Grid-in q{order}",
            correct_answers=answer,
            is_math_input=True,
            order=order,
            **kw,
        )

    def enrol(self, email, *, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(email, "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom,
            user=user,
            role=ClassroomMembership.ROLE_STUDENT,
            status=status,
        )
        return user

    def sit(self, student, answers, *, completed_at=None, paper=None):
        return TestAttempt.objects.create(
            practice_test=paper or self.paper,
            student=student,
            is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED,
            completed_at=completed_at or timezone.now(),
            module_answers=answers,
        )

    def roster(self):
        return list(
            ClassroomMembership.objects.filter(
                classroom=self.classroom,
                role=ClassroomMembership.ROLE_STUDENT,
                status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            ).values_list("user_id", flat=True)
        )

    def report(self, **kw):
        return build_pastpaper_item_analysis(self.paper, self.roster(), **kw)

    @staticmethod
    def row(payload, question):
        return next(r for r in payload["questions"] if r["question_id"] == question.pk)

    @staticmethod
    def group(payload, name, label):
        return next(g for g in payload["groups"][name]["groups"] if g["label"] == label)


class TheOwnersRuleTests(PastpaperFixture):
    """25% or more of the class wrong ⇒ the question is on the analysis list."""

    def setUp(self):
        super().setUp()
        self.q = self.mc(self.m1, order=0, answer="a")
        self.students = [self.enrol(f"rule_s{i}@t.com") for i in range(4)]

    def _record(self, wrong_count):
        for i, student in enumerate(self.students):
            self.sit(student, {str(self.m1.id): {str(self.q.pk): "b" if i < wrong_count else "a"}})

    def test_exactly_a_quarter_wrong_is_flagged(self):
        self._record(wrong_count=1)  # 1 of 4 = 25.0
        payload = self.report()
        self.assertEqual(self.row(payload, self.q)["error_rate"], 25.0)
        self.assertEqual([r["question_id"] for r in payload["needs_analysis"]], [self.q.pk])

    def test_below_the_threshold_is_not_flagged(self):
        self.students.append(self.enrol("rule_s4@t.com"))
        self._record(wrong_count=1)  # 1 of 5 = 20.0
        payload = self.report()
        self.assertEqual(self.row(payload, self.q)["error_rate"], 20.0)
        self.assertEqual(payload["needs_analysis"], [])

    def test_the_threshold_is_caller_settable_and_clamped(self):
        self._record(wrong_count=1)
        self.assertEqual(self.report(threshold=50)["needs_analysis"], [])
        self.assertEqual(len(self.report(threshold=10)["needs_analysis"]), 1)
        # Nonsense and out-of-range values must not 500 or flag a perfect paper.
        self.assertEqual(clamp_threshold("abc"), 25)
        self.assertEqual(clamp_threshold(0), 1)
        self.assertEqual(clamp_threshold(9999), 100)

    def test_nobody_answered_leaves_the_rate_empty_not_zero(self):
        """An unattempted question has no error rate. 0.0 would read as 'everyone aced it'."""
        payload = self.report()
        row = self.row(payload, self.q)
        self.assertIsNone(row["error_rate"])
        self.assertIsNone(row["miss_rate"])
        self.assertFalse(row["needs_analysis"])
        self.assertIsNone(payload["totals"]["error_rate"])


class CorruptRecordTests(PastpaperFixture):
    """The four ways the stored answers lie, all of which inflate the error rate."""

    def setUp(self):
        super().setUp()
        self.q1 = self.mc(self.m1, order=0, answer="a")
        self.q2 = self.mc(self.m2, order=0, answer="a")

    def test_a_copied_attempt_is_excluded_and_disclosed(self):
        """Module 2 answered with Module 1's question ids is the pre-2026-07-21 submit bug.

        Counting it marks the whole of Module 2 wrong for that student. The attempt is
        dropped whole and the exclusion is reported — silent truncation is forbidden.
        """
        clean = self.enrol("copied_clean@t.com")
        broken = self.enrol("copied_broken@t.com")
        self.sit(clean, {
            str(self.m1.id): {str(self.q1.pk): "a"},
            str(self.m2.id): {str(self.q2.pk): "a"},
        })
        self.sit(broken, {
            str(self.m1.id): {str(self.q1.pk): "a"},
            # Module 1's id filed under the Module 2 key — the signature.
            str(self.m2.id): {str(self.q1.pk): "a"},
        })

        payload = self.report()
        self.assertEqual(payload["data_quality"]["attempts_considered"], 2)
        self.assertEqual(payload["data_quality"]["attempts_counted"], 1)
        self.assertEqual(payload["data_quality"]["excluded"]["copied"], 1)

        # Module 2's question saw exactly one student — not two, and not a wrong answer.
        m2_row = self.row(payload, self.q2)
        self.assertEqual((m2_row["seen"], m2_row["answered"], m2_row["wrong"]), (1, 1, 0))
        self.assertEqual(m2_row["error_rate"], 0.0)

    def test_a_foreign_answer_key_never_counts_toward_a_module_one_question(self):
        """The intersection rule: a naive flatten of module_answers double-counts Module 1."""
        broken = self.enrol("flatten@t.com")
        self.sit(broken, {
            str(self.m1.id): {str(self.q1.pk): "b"},
            str(self.m2.id): {str(self.q1.pk): "b"},
        })
        payload = self.report()
        # The whole attempt is excluded, so Module 1's question is untouched too.
        self.assertEqual(self.row(payload, self.q1)["seen"], 0)
        self.assertEqual(payload["data_quality"]["excluded"]["copied"], 1)

    def test_a_module_never_opened_is_skipped_not_marked_omitted(self):
        """No key for Module 2 means the student never reached it. Its questions were never
        put in front of them, so they are not blank answers."""
        student = self.enrol("half_paper@t.com")
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "a"}})

        payload = self.report()
        m2_row = self.row(payload, self.q2)
        self.assertEqual((m2_row["seen"], m2_row["omitted"], m2_row["answered"]), (0, 0, 0))
        self.assertIsNone(m2_row["miss_rate"])
        self.assertEqual(self.row(payload, self.q1)["seen"], 1)

    def test_a_module_submitted_blank_is_seen_and_omitted(self):
        """Present-but-empty is a different event from absent: the student sat it and
        answered nothing. That is pacing information, and it belongs in miss_rate."""
        student = self.enrol("walked_out@t.com")
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "a"}, str(self.m2.id): {}})

        m2_row = self.row(self.report(), self.q2)
        self.assertEqual((m2_row["seen"], m2_row["omitted"], m2_row["answered"]), (1, 1, 0))
        self.assertIsNone(m2_row["error_rate"])
        self.assertEqual(m2_row["miss_rate"], 100.0)

    def test_a_clean_resit_after_a_copied_first_sitting_is_counted(self):
        """The copy bug is *why* a student sits the paper again, so the re-sit must survive.

        Marking the student "seen" while discarding their copied first sitting spends their
        one slot on a record nobody trusts and then rejects the good sitting as a repeat —
        silently shrinking the denominator of every question on the paper for the 51 students
        the bug actually hit.
        """
        student = self.enrol("resit_after_copy@t.com")
        earlier = timezone.now() - timedelta(days=3)
        self.sit(student, {
            str(self.m1.id): {str(self.q1.pk): "a"},
            # Module 1's id under the Module 2 key — the signature.
            str(self.m2.id): {str(self.q1.pk): "a"},
        }, completed_at=earlier)
        self.sit(student, {
            str(self.m1.id): {str(self.q1.pk): "a"},
            str(self.m2.id): {str(self.q2.pk): "b"},
        })

        payload = self.report()
        quality = payload["data_quality"]
        self.assertEqual(quality["attempts_considered"], 2)
        self.assertEqual(quality["attempts_counted"], 1)
        self.assertEqual(quality["students_counted"], 1)
        self.assertEqual(quality["excluded"], {"copied": 1, "repeat_sitting": 0})

        # The clean sitting is the one that counts, on both modules.
        self.assertEqual(self.row(payload, self.q1)["correct"], 1)
        m2_row = self.row(payload, self.q2)
        self.assertEqual((m2_row["seen"], m2_row["answered"], m2_row["wrong"]), (1, 1, 1))

    def test_a_student_whose_every_sitting_is_copied_is_still_excluded(self):
        """Falling through to the next sitting must not become a way in for a copied one."""
        student = self.enrol("all_copied@t.com")
        earlier = timezone.now() - timedelta(days=3)
        for completed_at in (earlier, timezone.now()):
            self.sit(student, {
                str(self.m1.id): {str(self.q1.pk): "a"},
                str(self.m2.id): {str(self.q1.pk): "a"},
            }, completed_at=completed_at)

        payload = self.report()
        quality = payload["data_quality"]
        self.assertEqual(quality["attempts_counted"], 0)
        self.assertEqual(quality["students_counted"], 0)
        self.assertEqual(quality["excluded"]["copied"], 2)
        self.assertEqual(self.row(payload, self.q1)["seen"], 0)

    def test_the_exclusion_ledger_adds_up(self):
        """considered == counted + copied + repeat_sitting, whatever order the sittings came in."""
        student = self.enrol("ledger@t.com")
        base = timezone.now() - timedelta(days=5)
        # Copied, then the clean re-sit, then a third sitting that is a genuine repeat.
        self.sit(student, {
            str(self.m1.id): {str(self.q1.pk): "a"},
            str(self.m2.id): {str(self.q1.pk): "a"},
        }, completed_at=base)
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "b"}}, completed_at=base + timedelta(days=1))
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "a"}}, completed_at=base + timedelta(days=2))

        quality = self.report()["data_quality"]
        self.assertEqual(quality["excluded"], {"copied": 1, "repeat_sitting": 1})
        self.assertEqual(
            quality["attempts_considered"],
            quality["attempts_counted"]
            + quality["excluded"]["copied"]
            + quality["excluded"]["repeat_sitting"],
        )
        # The clean re-sit is the one counted — the wrong answer, not the third sitting's right one.
        self.assertEqual(self.row(self.report(), self.q1)["wrong"], 1)

    def test_a_re_imported_answer_key_is_not_mistaken_for_a_copy(self):
        """A builder edit that recreates *some* Module 2 questions leaves overlap, so the
        COPIED signature — keys **entirely** foreign to Module 2 — does not trip.

        Measured rather than assumed, because a false COPIED verdict would throw away a real
        sitting: the detection here is the audit command's, and both require zero overlap.
        """
        student = self.enrol("reimport@t.com")
        survivor = self.q2
        recreated = self.mc(self.m2, order=1, answer="a")
        stale_id = str(recreated.pk + 10_000)  # a question id the re-import deleted
        self.sit(student, {
            str(self.m1.id): {str(self.q1.pk): "a"},
            str(self.m2.id): {str(survivor.pk): "a", stale_id: "b"},
        })

        payload = self.report()
        self.assertEqual(payload["data_quality"]["excluded"]["copied"], 0)
        self.assertEqual(payload["data_quality"]["attempts_counted"], 1)
        # The stale id counts for nothing; the surviving question is scored normally.
        self.assertEqual(self.row(payload, survivor)["correct"], 1)
        self.assertEqual(self.row(payload, recreated)["omitted"], 1)

    def test_only_the_first_sitting_of_a_paper_counts(self):
        """A student who sits a paper three times must not carry triple weight."""
        student = self.enrol("resitter@t.com")
        early = timezone.now() - timedelta(days=3)
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "b"}}, completed_at=early)
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "a"}})
        self.sit(student, {str(self.m1.id): {str(self.q1.pk): "a"}})

        payload = self.report()
        row = self.row(payload, self.q1)
        self.assertEqual((row["seen"], row["answered"], row["wrong"]), (1, 1, 1))
        self.assertEqual(payload["data_quality"]["students_counted"], 1)
        self.assertEqual(payload["data_quality"]["excluded"]["repeat_sitting"], 2)

    def test_an_in_flight_or_abandoned_attempt_is_not_a_sitting(self):
        """Both flags are required: a half-finished paper is not evidence about a question."""
        student = self.enrol("in_flight@t.com")
        TestAttempt.objects.create(
            practice_test=self.paper, student=student, is_completed=False,
            current_state=TestAttempt.STATE_MODULE_2_ACTIVE,
            module_answers={str(self.m1.id): {str(self.q1.pk): "b"}},
        )
        payload = self.report()
        self.assertEqual(payload["data_quality"]["attempts_considered"], 0)
        self.assertEqual(self.row(payload, self.q1)["seen"], 0)

    def test_a_student_outside_the_roster_is_not_counted(self):
        outsider = User.objects.create_user("outsider@t.com", "secret123")
        self.sit(outsider, {str(self.m1.id): {str(self.q1.pk): "b"}})
        self.assertEqual(self.row(self.report(), self.q1)["seen"], 0)


class OmittedIsNotWrongTests(PastpaperFixture):
    """A question nobody had time for is a pacing problem, not a teaching problem."""

    def setUp(self):
        super().setUp()
        self.q = self.mc(self.m1, order=0, answer="a")
        self.answered_right = self.enrol("omit_right@t.com")
        self.answered_wrong = self.enrol("omit_wrong@t.com")
        self.blank = self.enrol("omit_blank@t.com")
        self.whitespace = self.enrol("omit_ws@t.com")

        self.sit(self.answered_right, {str(self.m1.id): {str(self.q.pk): "a"}})
        self.sit(self.answered_wrong, {str(self.m1.id): {str(self.q.pk): "c"}})
        self.sit(self.blank, {str(self.m1.id): {str(self.q.pk): None}})
        self.sit(self.whitespace, {str(self.m1.id): {str(self.q.pk): "   "}})

    def test_five_separate_numbers(self):
        row = self.row(self.report(), self.q)
        self.assertEqual(row["seen"], 4)
        self.assertEqual(row["answered"], 2)
        self.assertEqual(row["omitted"], 2)
        self.assertEqual(row["correct"], 1)
        self.assertEqual(row["wrong"], 1)

    def test_error_rate_divides_by_answered_and_miss_rate_by_seen(self):
        payload = self.report()
        row = self.row(payload, self.q)
        self.assertEqual(row["error_rate"], 50.0)   # 1 wrong of 2 answered
        self.assertEqual(row["miss_rate"], 75.0)    # (1 wrong + 2 blank) of 4 seen
        self.assertEqual(payload["denominator"], "answered")


class GradingAtomTests(PastpaperFixture):
    """Correctness comes from Question.check_answer, never from a local string compare."""

    def test_grid_in_tolerance_is_honoured(self):
        """0.5, .5, 1/2 and 0.50 are one answer. A string compare marks three of them wrong
        and manufactures a 75% error rate on a question the class got right."""
        q = self.grid_in(self.m1, order=0, answer="1/2")
        for i, given in enumerate(["0.5", ".5", "1/2", "0.50"]):
            student = self.enrol(f"grid_ok{i}@t.com")
            self.sit(student, {str(self.m1.id): {str(q.pk): given}})
        wrong_student = self.enrol("grid_wrong@t.com")
        self.sit(wrong_student, {str(self.m1.id): {str(q.pk): "0.6"}})

        row = self.row(self.report(), q)
        self.assertEqual(row["correct"], 4)
        self.assertEqual(row["wrong"], 1)
        self.assertEqual(row["error_rate"], 20.0)

    def test_multiple_choice_is_case_insensitive(self):
        q = self.mc(self.m1, order=0, answer="a")
        for i, given in enumerate(["a", "A"]):
            self.sit(self.enrol(f"case{i}@t.com"), {str(self.m1.id): {str(q.pk): given}})
        self.assertEqual(self.row(self.report(), q)["wrong"], 0)


class SuspectKeyTests(PastpaperFixture):
    """A wrong answer key manufactures a ~100% error rate. Flag the row; never hide it."""

    def test_a_near_total_error_rate_is_flagged_as_a_suspect_key(self):
        q = self.mc(self.m1, order=0, answer="d")
        for i in range(10):
            self.sit(self.enrol(f"key_s{i}@t.com"), {str(self.m1.id): {str(q.pk): "b"}})

        payload = self.report()
        row = self.row(payload, q)
        self.assertEqual(row["error_rate"], 100.0)
        self.assertTrue(row["suspect_key"])
        # Still on the analysis list — the evidence is real, its meaning is what differs.
        self.assertIn(q.pk, [r["question_id"] for r in payload["needs_analysis"]])
        self.assertEqual(payload["data_quality"]["suspect_key_questions"], 1)

    def test_a_merely_hard_question_is_not_suspect(self):
        q = self.mc(self.m1, order=0, answer="a")
        for i in range(4):
            answer = "b" if i < 3 else "a"  # 75% wrong
            self.sit(self.enrol(f"hard_s{i}@t.com"), {str(self.m1.id): {str(q.pk): answer}})

        row = self.row(self.report(), q)
        self.assertEqual(row["error_rate"], 75.0)
        self.assertTrue(row["needs_analysis"])
        self.assertFalse(row["suspect_key"])


class SuspectKeyContaminationTests(PastpaperFixture):
    """A row the module says not to trust must not be pooled into a topic result.

    The measured scenario: a two-question Math paper, 12 students, one question whose answer
    key is broken. Every student answers the good question correctly and cannot answer the
    broken one correctly at all. Pooling both prints "Math — 50%" under *Statistics by
    question type* when the class's real Math error rate is 0% — and the same contamination
    lands on the skill and domain rows, which are the ones a department acts on.
    """

    def setUp(self):
        super().setUp()
        self.domain = BankDomain.objects.create(subject="MATH", name="Algebra", code="sk-algebra")
        self.skill = BankSkill.objects.create(
            domain=self.domain, name="Linear Functions", code="sk-linear"
        )
        self.good = self.mc(self.m1, order=0, answer="a", skill=self.skill)
        # The stored key is "99"; the paper's real answer is 7. Nobody can be right.
        self.broken = self.grid_in(self.m1, order=1, answer="99", skill=self.skill)
        for i in range(12):
            self.sit(self.enrol(f"sk_s{i}@t.com"), {
                str(self.m1.id): {str(self.good.pk): "a", str(self.broken.pk): "7"},
            })

    def test_the_flagged_question_list_is_untouched(self):
        """A suspect key still needs a human to look at it — the row is never hidden."""
        payload = self.report()
        row = self.row(payload, self.broken)
        self.assertEqual(row["error_rate"], 100.0)
        self.assertTrue(row["suspect_key"])
        self.assertTrue(row["needs_analysis"])
        self.assertIn(self.broken.pk, [r["question_id"] for r in payload["needs_analysis"]])
        self.assertEqual(payload["data_quality"]["suspect_key_questions"], 1)

    def test_the_question_type_row_reads_as_a_topic_result(self):
        math = self.group(self.report(), "question_type", "Math")
        # Nothing vanished: the group still owns both questions, and says which it held out.
        self.assertEqual(math["questions"], 2)
        self.assertEqual(math["suspect_key_count"], 1)
        self.assertEqual(math["analysed_questions"], 1)
        # The counts beside the rate describe the same population as the rate.
        self.assertEqual((math["seen"], math["answered"], math["wrong"]), (12, 12, 0))
        self.assertEqual(math["error_rate"], 0.0)
        # The teacher's list is a different question from the topic rate.
        self.assertEqual(math["needs_analysis_count"], 1)

    def test_a_group_that_is_entirely_suspect_is_visible_not_vanished(self):
        """Grid-in holds only the broken question: an em dash and a reason, never 0%."""
        grid = self.group(self.report(), "format", "Grid-in")
        self.assertEqual(grid["questions"], 1)
        self.assertEqual(grid["suspect_key_count"], 1)
        self.assertEqual(grid["analysed_questions"], 0)
        self.assertEqual((grid["seen"], grid["answered"], grid["wrong"]), (0, 0, 0))
        self.assertIsNone(grid["error_rate"])
        self.assertEqual(grid["needs_analysis_count"], 1)
        # And the trustworthy half of the paper is still readable next to it.
        self.assertEqual(self.group(self.report(), "format", "Multiple choice")["error_rate"], 0.0)

    def test_the_skill_and_domain_rows_a_department_acts_on_are_clean_too(self):
        payload = self.report()
        skill = self.group(payload, "skill", "Linear Functions")
        self.assertEqual((skill["questions"], skill["suspect_key_count"]), (2, 1))
        self.assertEqual(skill["error_rate"], 0.0)
        domain = self.group(payload, "domain", "Algebra")
        self.assertEqual((domain["questions"], domain["suspect_key_count"]), (2, 1))
        self.assertEqual(domain["error_rate"], 0.0)

    def test_the_totals_rate_holds_the_suspect_row_out_and_names_what_it_divided(self):
        totals = self.report()["totals"]
        # The paper as recorded is unchanged — these are the sitting's own tallies.
        self.assertEqual((totals["questions"], totals["answered"], totals["wrong"]), (2, 24, 12))
        self.assertEqual(totals["suspect_key"], 1)
        # The headline rate is the topic reading, and says exactly what produced it.
        self.assertEqual(totals["error_rate"], 0.0)
        self.assertEqual(
            totals["analysed"], {"questions": 1, "seen": 12, "answered": 12, "wrong": 0}
        )

    def test_a_paper_whose_every_key_is_suspect_has_no_rate_at_all(self):
        """Holding every row out leaves an empty denominator — null, never 0%."""
        paper = PracticeTest.objects.create(subject="MATH", title="Every key broken")
        module = paper.modules.get(module_order=1)
        question = Question.objects.create(
            module=module, question_type="MATH", question_text="Broken key",
            option_a="A", option_b="B", correct_answers="zzz", order=0,
        )
        for i in range(4):
            self.sit(
                self.enrol(f"all_broken_s{i}@t.com"),
                {str(module.id): {str(question.pk): "a"}},
                paper=paper,
            )

        payload = build_pastpaper_item_analysis(paper, self.roster())
        self.assertIsNone(payload["totals"]["error_rate"])
        self.assertEqual(
            payload["totals"]["analysed"],
            {"questions": 0, "seen": 0, "answered": 0, "wrong": 0},
        )
        math = next(
            g for g in payload["groups"]["question_type"]["groups"] if g["label"] == "Math"
        )
        self.assertEqual((math["questions"], math["suspect_key_count"]), (1, 1))
        self.assertIsNone(math["error_rate"])
        self.assertEqual(math["needs_analysis_count"], 1)


class TaxonomyTests(PastpaperFixture):
    """The by-type statistics the owner asked for, and the honesty of their coverage."""

    def setUp(self):
        super().setUp()
        self.domain = BankDomain.objects.create(subject="MATH", name="Algebra", code="algebra")
        self.skill = BankSkill.objects.create(
            domain=self.domain, name="Linear Functions", code="linear-functions"
        )
        self.bank_question = BankQuestion.objects.create(
            qb_id="QB-MATH-000001", subject="MATH", question_type="MULTIPLE_CHOICE",
            question_text="Bank source", difficulty="HARD",
        )
        # Tagged, and three of the four get it wrong. Three rather than four on purpose: at
        # 100% the question would be held out of every breakdown as a suspect key, and these
        # cases are about how a *trustworthy* row is grouped.
        self.tagged = self.mc(self.m1, order=0, answer="a", skill=self.skill,
                              bank_question=self.bank_question)
        # Untagged legacy question — no skill, no bank link.
        self.untagged = self.grid_in(self.m1, order=1, answer="7")

        for i in range(4):
            self.sit(self.enrol(f"tax_s{i}@t.com"), {
                str(self.m1.id): {
                    str(self.tagged.pk): "b" if i < 3 else "a",
                    str(self.untagged.pk): "7",
                },
            })

    def test_question_type_and_format_always_group(self):
        payload = self.report()
        self.assertEqual(payload["groups"]["question_type"]["coverage"], {"tagged": 2, "total": 2})
        self.assertEqual(payload["groups"]["format"]["coverage"], {"tagged": 2, "total": 2})

        math = self.group(payload, "question_type", "Math")
        self.assertEqual(math["questions"], 2)
        self.assertEqual(math["suspect_key_count"], 0)
        self.assertEqual(math["wrong"], 3)
        self.assertEqual(math["error_rate"], 37.5)  # 3 wrong of 8 answered
        self.assertEqual(math["needs_analysis_count"], 1)

        self.assertEqual(self.group(payload, "format", "Multiple choice")["error_rate"], 75.0)
        self.assertEqual(self.group(payload, "format", "Grid-in")["error_rate"], 0.0)

    def test_the_untagged_bucket_is_separate_and_never_folded_into_a_skill(self):
        """Folding untagged questions into a skill inflates that skill's question count and
        quietly misstates its accuracy — the same rule the single-attempt report follows."""
        payload = self.report()
        skills = payload["groups"]["skill"]

        self.assertEqual(skills["coverage"], {"tagged": 1, "total": 2})
        labels = {g["label"]: g for g in skills["groups"]}
        self.assertIn(UNCLASSIFIED, labels)
        self.assertEqual(labels["Linear Functions"]["questions"], 1)
        self.assertEqual(labels[UNCLASSIFIED]["questions"], 1)
        self.assertEqual(labels[UNCLASSIFIED]["wrong"], 0)
        self.assertIsNone(labels[UNCLASSIFIED]["key"])

        # The footnote pair the shared report vocabulary uses.
        self.assertEqual(payload["unclassified_total"], 1)
        self.assertEqual(payload["unclassified_wrong"], 0)

    def test_domain_comes_from_the_skill_and_difficulty_from_the_bank(self):
        payload = self.report()
        self.assertEqual(payload["groups"]["domain"]["coverage"], {"tagged": 1, "total": 2})
        self.assertEqual(self.group(payload, "domain", "Algebra")["wrong"], 3)
        self.assertEqual(payload["groups"]["difficulty"]["coverage"], {"tagged": 1, "total": 2})
        self.assertEqual(self.group(payload, "difficulty", "Hard")["error_rate"], 75.0)

    def test_a_question_row_carries_what_a_teacher_needs_to_act(self):
        row = self.row(self.report(), self.tagged)
        self.assertEqual(row["module"], 1)
        self.assertEqual(row["module_label"], "Module 1")
        self.assertEqual(row["correct_answer"], "a")
        self.assertEqual(row["skill"], "Linear Functions")
        self.assertEqual(row["domain"], "Algebra")
        self.assertEqual(row["difficulty_label"], "Hard")
        self.assertTrue(row["stem"])

    def test_the_stem_is_stripped_of_markup_and_truncated(self):
        long_q = self.mc(self.m2, order=0, stem="<p>" + ("word " * 200) + "</p>")
        row = self.row(self.report(), long_q)
        self.assertNotIn("<p>", row["stem"])
        self.assertLessEqual(len(row["stem"]), 200)


class DisplayNumberingTests(PastpaperFixture):
    """Question.order restarts at 0 in Module 2; a teacher's "Q3" does not."""

    def test_numbering_is_continuous_across_modules(self):
        self.mc(self.m1, order=0)
        self.mc(self.m1, order=1)
        first_of_m2 = self.mc(self.m2, order=0)
        self.mc(self.m2, order=1)

        payload = self.report()
        self.assertEqual([r["number"] for r in payload["questions"]], [1, 2, 3, 4])
        self.assertEqual([r["module"] for r in payload["questions"]], [1, 1, 2, 2])
        self.assertEqual(self.row(payload, first_of_m2)["number"], 3)


class ItemAnalysisApiTests(PastpaperFixture):
    """Who may read it, and what a bad request gets back."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.q = self.mc(self.m1, order=0, answer="a")
        self.student = self.enrol("api_student@t.com")
        self.sit(self.student, {str(self.m1.id): {str(self.q.pk): "b"}})

    def _get(self, **params):
        params.setdefault("classroom", self.classroom.pk)
        params.setdefault("practice_test", self.paper.pk)
        return self.client.get(URL, params)

    def test_the_class_owner_reads_their_own_classroom(self):
        self.client.force_authenticate(self.teacher)
        response = self._get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["classroom"]["id"], self.classroom.pk)
        self.assertEqual(response.data["needs_analysis"][0]["question_id"], self.q.pk)

    def test_a_teaching_assistant_reads_it_too(self):
        """The scope is every non-removed staff membership — a TA is on the teaching team."""
        ta = User.objects.create_user("api_ta@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=ta, role=ClassroomMembership.ROLE_TA
        )
        self.client.force_authenticate(ta)
        self.assertEqual(self._get().status_code, 200)

    def test_a_removed_teacher_no_longer_reads_it(self):
        removed = User.objects.create_user("api_removed@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=removed,
            role=ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.client.force_authenticate(removed)
        self.assertEqual(self._get().status_code, 404)

    def test_an_unrelated_user_is_refused(self):
        stranger = User.objects.create_user("api_stranger@t.com", "secret123")
        self.client.force_authenticate(stranger)
        self.assertEqual(self._get().status_code, 404)

    def test_anonymous_is_refused(self):
        self.assertIn(self._get().status_code, (401, 403))

    def test_global_staff_reads_any_classroom(self):
        admin = User.objects.create_user("api_admin@t.com", "secret123", is_superuser=True)
        self.client.force_authenticate(admin)
        self.assertEqual(self._get().status_code, 200)

    def test_a_mock_section_is_not_a_pastpaper(self):
        mock = MockExam.objects.create(title="Full mock 3")
        section = PracticeTest.objects.create(subject="MATH", title="Mock section", mock_exam=mock)
        self.client.force_authenticate(self.teacher)
        response = self._get(practice_test=section.pk)
        self.assertEqual(response.status_code, 404)

    def test_missing_or_non_numeric_parameters_are_a_clear_400(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.get(URL).status_code, 400)
        self.assertEqual(self.client.get(URL, {"classroom": "abc"}).status_code, 400)
        self.assertEqual(
            self.client.get(URL, {"classroom": self.classroom.pk}).status_code, 400
        )

    def test_the_threshold_query_param_reaches_the_report(self):
        # A second student answers it correctly, so the question sits at 50% — above the
        # school's rule, below a caller-supplied 99.
        self.sit(self.enrol("api_second@t.com"), {str(self.m1.id): {str(self.q.pk): "a"}})
        self.client.force_authenticate(self.teacher)

        default = self._get()
        self.assertEqual(default.data["threshold"], 25)
        self.assertEqual([r["question_id"] for r in default.data["needs_analysis"]], [self.q.pk])

        strict = self._get(threshold=99)
        self.assertEqual(strict.data["threshold"], 99)
        self.assertEqual(strict.data["needs_analysis"], [])


class WhichWrongAnswerTests(PastpaperFixture):
    """Which wrong answer the class picked — the half of an item analysis a lesson comes from.

    "9 of the 12 who missed it picked C" is the finding; "12 missed it" is only the workload.
    These pin the counts, the key marker, and the two silences the tally must keep: a question
    nobody reached, and a cohort small enough that a count would name the students in it.
    """

    def setUp(self):
        super().setUp()
        self.q = self.mc(
            self.m1, order=0, answer="a", option_c="Choice C", option_d="Choice D"
        )
        self.students = [self.enrol(f"pick{i}@t.com") for i in range(6)]

    def record(self, picks, *, question=None):
        question = question or self.q
        for student, pick in zip(self.students, picks):
            self.sit(student, {str(self.m1.id): {str(question.pk): pick}})

    def tally(self, question=None):
        return self.row(self.report(), question or self.q)["answer_tally"]

    @staticmethod
    def options(tally):
        return {option["key"]: option for option in tally["options"]}

    def test_the_tally_counts_what_the_class_picked(self):
        # No count of one here on purpose: the cell floor gets its own case below, and this
        # one is about the arithmetic.
        self.record(["c", "c", "c", "c", "a", "a"])

        tally = self.tally()
        self.assertEqual(tally["kind"], "options")
        self.assertEqual(tally["state"], "data")
        self.assertEqual(tally["responses"], 6)
        options = self.options(tally)
        self.assertEqual(options["C"]["count"], 4)
        self.assertEqual(options["A"]["count"], 2)
        self.assertEqual(options["B"]["count"], 0)
        self.assertEqual(options["D"]["count"], 0)
        self.assertEqual(options["C"]["share"], 66.7)

    def test_the_key_is_marked_and_comes_from_the_grader(self):
        # The authored key is " a " with the spaces a paste left behind. ``check_answer``
        # strips and case-folds before comparing, so A is the key; a local
        # ``letter.lower() == correct_answers.lower()`` would mark nothing correct at all,
        # which is why this test uses a key the two rules disagree about.
        padded = self.mc(
            self.m1, order=1, answer=" A ", option_c="Choice C", option_d="Choice D"
        )
        self.record(["c", "c", "c", "c", "a", "a"], question=padded)

        tally = self.tally(padded)
        self.assertEqual([o["key"] for o in tally["options"] if o["is_correct"]], ["A"])
        # The class's favourite answer is NOT the key — which is the whole point of showing it.
        self.assertFalse(self.options(tally)["C"]["is_correct"])

    def test_an_options_text_does_not_steal_a_later_options_key(self):
        # Option A's text is the letter B — ordinary on a maths paper. Grouping by text
        # before every letter is claimed put every pick of the KEY on option A: five picks
        # of a mistake nobody made, at the top of a re-teaching list.
        confusing = Question.objects.create(
            module=self.m1,
            question_type="MATH",
            question_text="Which letter?",
            option_a="B",
            option_b="C",
            option_c="D",
            correct_answers="b",
            order=1,
        )
        self.record(["b", "b", "b", "b", "b"], question=confusing)

        options = self.options(self.tally(confusing))
        self.assertEqual(options["B"]["count"], 5)
        self.assertEqual(options["A"]["count"], 0)
        self.assertTrue(options["B"]["is_correct"])

    def test_answers_matching_no_option_are_a_defect_not_a_silence(self):
        # Every stored answer is a letter this question no longer offers. "Nobody reached
        # this question" would print an empty state over a data defect.
        self.record(["z", "z", "z", "z", "z"])

        tally = self.tally()
        self.assertEqual(tally["state"], "unreadable")
        self.assertEqual(tally["responses"], 0)
        self.assertEqual(tally["unrecognised"], 5)
        self.assertIn("matches an option", tally["note"])

    def test_a_count_of_one_is_held_back_and_cannot_be_subtracted_out(self):
        # Nine picked C, one picked D. "1" is that student's answer written into a table,
        # and a single hidden cell is just `responses` minus the visible ones.
        self.students += [self.enrol(f"cell{i}@t.com") for i in range(4)]
        self.record(["c"] * 9 + ["d"])

        tally = self.tally()
        options = self.options(tally)
        self.assertEqual(tally["state"], "data")
        self.assertEqual(tally["responses"], 10)
        self.assertIsNone(options["D"]["count"])
        self.assertIsNone(options["D"]["share"])
        hidden = [o["key"] for o in tally["options"] if o["count"] is None]
        self.assertGreaterEqual(len(hidden), 2)
        self.assertLess(sum(o["count"] for o in tally["options"] if o["count"] is not None), 10)
        # The finding still travels: nine of ten picked C.
        self.assertEqual(options["C"]["count"], 9)
        self.assertIn("held back", tally["note"])

    def test_a_question_nobody_reached_says_no_data_rather_than_zeros(self):
        # Module 2 was never opened, so its questions were never put in front of anybody.
        unseen = self.mc(self.m2, order=0, answer="a")
        self.record(["a", "a", "a", "a", "a", "a"])

        tally = self.tally(unseen)
        self.assertEqual(tally["state"], "no_data")
        self.assertEqual(tally["responses"], 0)
        self.assertTrue(tally["note"])
        self.assertTrue(all(o["count"] is None for o in tally["options"]))

    def test_below_the_floor_the_counts_are_suppressed_not_shown(self):
        self.record(["c", "c", "c", "a"])  # four sittings: a count would name them

        tally = self.tally()
        self.assertEqual(tally["state"], "suppressed")
        self.assertEqual(tally["responses"], 4)
        self.assertEqual(tally["min_responses"], 5)
        self.assertTrue(all(o["count"] is None for o in tally["options"]))
        self.assertIn("held back", tally["note"])
        # Suppressed is not empty: the options and the key still travel.
        self.assertEqual([o["key"] for o in tally["options"] if o["is_correct"]], ["A"])
        self.assertEqual(len(tally["options"]), 4)

    def test_a_blank_answer_is_no_answer_not_a_pick(self):
        self.record(["c", "c", "c", "c", "a", ""])

        tally = self.tally()
        self.assertEqual(tally["responses"], 5)
        self.assertEqual(tally["no_answer"], 1)
        self.assertEqual(self.row(self.report(), self.q)["omitted"], 1)

    def test_a_grid_in_reports_its_commonest_wrong_answers(self):
        grid = self.grid_in(self.m1, order=1, answer="1/2")
        for student, given in zip(self.students, ["0.6", "0.6", "0.6", "0.5", "7", "0.6"]):
            self.sit(student, {str(self.m1.id): {str(grid.pk): given}})

        tally = self.tally(grid)
        self.assertEqual(tally["kind"], "answers")
        # A per-option count of a question with no options would be four empty bars.
        self.assertEqual(tally["options"], [])
        self.assertEqual(tally["top_wrong"], [{"answer": "0.6", "count": 4}])
        # "7" was one student's answer: counted, but not quoted back beside a count of one.
        self.assertEqual(tally["distinct_wrong_answers"], 2)
        # 0.5 is the key spelled another way; the grader says so and it is not a mistake.
        self.assertNotIn("0.5", [entry["answer"] for entry in tally["top_wrong"]])

    def test_the_tally_and_the_counts_describe_the_same_sitting(self):
        self.record(["c", "c", "c", "c", "a", "b"])

        row = self.row(self.report(), self.q)
        self.assertEqual(row["answered"], row["answer_tally"]["responses"])
        self.assertEqual(row["wrong"], 5)


class AnswerTallyQueryCountTests(PastpaperFixture):
    """Three queries, whatever the paper's length. A tally per question would be a query
    per question, over every class this page is opened for."""

    def _build(self, question_count):
        paper = PracticeTest.objects.create(
            subject="MATH", title=f"Paper of {question_count}", collection_name="Bluebook"
        )
        module = paper.modules.get(module_order=1)
        questions = [
            self.mc(module, order=i, answer="a", option_c="Choice C", option_d="Choice D")
            for i in range(question_count)
        ]
        for i in range(6):
            student = self.enrol(f"qc{question_count}_{i}@t.com")
            self.sit(
                student,
                {str(module.id): {str(q.pk): "c" for q in questions}},
                paper=paper,
            )

        with CaptureQueriesContext(connection) as captured:
            payload = build_pastpaper_item_analysis(paper, self.roster())
        self.assertEqual(len(payload["questions"]), question_count)
        return len(captured)

    def test_the_query_count_does_not_grow_with_the_questions(self):
        small = self._build(2)
        large = self._build(8)
        self.assertEqual(small, large, "a query per question crept back in")
