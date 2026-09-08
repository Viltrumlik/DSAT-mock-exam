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
from django.test import TestCase
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
        # Tagged, and everybody gets it wrong.
        self.tagged = self.mc(self.m1, order=0, answer="a", skill=self.skill,
                              bank_question=self.bank_question)
        # Untagged legacy question — no skill, no bank link.
        self.untagged = self.grid_in(self.m1, order=1, answer="7")

        for i in range(4):
            self.sit(self.enrol(f"tax_s{i}@t.com"), {
                str(self.m1.id): {str(self.tagged.pk): "b", str(self.untagged.pk): "7"},
            })

    @staticmethod
    def group(payload, name, label):
        return next(g for g in payload["groups"][name]["groups"] if g["label"] == label)

    def test_question_type_and_format_always_group(self):
        payload = self.report()
        self.assertEqual(payload["groups"]["question_type"]["coverage"], {"tagged": 2, "total": 2})
        self.assertEqual(payload["groups"]["format"]["coverage"], {"tagged": 2, "total": 2})

        math = self.group(payload, "question_type", "Math")
        self.assertEqual(math["questions"], 2)
        self.assertEqual(math["wrong"], 4)
        self.assertEqual(math["error_rate"], 50.0)  # 4 wrong of 8 answered
        self.assertEqual(math["needs_analysis_count"], 1)

        self.assertEqual(self.group(payload, "format", "Multiple choice")["error_rate"], 100.0)
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
        self.assertEqual(self.group(payload, "domain", "Algebra")["wrong"], 4)
        self.assertEqual(payload["groups"]["difficulty"]["coverage"], {"tagged": 1, "total": 2})
        self.assertEqual(self.group(payload, "difficulty", "Hard")["error_rate"], 100.0)

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
