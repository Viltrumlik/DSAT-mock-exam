"""Item analysis — the counting rules, the scoping rule, and the endpoint.

The rules under test are the ones that are wrong by default: a skipped question writes no
row, a NULL ``is_correct`` is not a wrong answer, a retry is not a second student, and a
classroom OWNER or TA is not a stranger to their own class.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.item_analysis import (
    UNTAGGED,
    UnknownAssessmentSet,
    build_item_analysis,
    parse_threshold,
    teacher_classroom_ids,
)
from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership
from questionbank.models import (
    BankDomain,
    BankQuestion,
    BankSkill,
    QuestionStatus,
    QuestionType,
    Subject,
)

User = get_user_model()

URL = "/api/assessments/teacher/item-analysis/"


def _teacher(email: str):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH
    )


def _student(email: str):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_STUDENT, subject=""
    )


class _Fixture:
    """One classroom, one set, one homework — the smallest thing worth analysing."""

    def __init__(self, *, teacher=None, name="Math class"):
        self.teacher = teacher or _teacher("owner@example.com")
        self.classroom = Classroom.objects.create(
            name=name,
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_JUNIOR,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="algebra",
            title="Algebra basics",
            created_by=self.teacher,
        )
        assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="HW", instructions=""
        )
        self.homework = HomeworkAssignment.objects.create(
            classroom=self.classroom,
            assessment_set=self.aset,
            assignment=assignment,
            assigned_by=self.teacher,
        )
        self._order = 0

    def question(self, prompt="2+2?", *, aset=None, active=True, bank=None, **kw):
        self._order += 1
        return AssessmentQuestion.objects.create(
            assessment_set=aset or self.aset,
            order=self._order,
            prompt=prompt,
            question_type=kw.pop("question_type", AssessmentQuestion.TYPE_NUMERIC),
            correct_answer=kw.pop("correct_answer", 4),
            is_active=active,
            bank_question=bank,
            **kw,
        )

    def sit(self, student, verdicts, *, status=AssessmentAttempt.STATUS_GRADED, homework=None):
        """One attempt plus its answer rows. ``verdicts`` is ``{question: True/False/None}``.

        A question left out of the dict gets NO answer row at all — which is exactly what a
        skipped question looks like in the database.
        """
        attempt = AssessmentAttempt.objects.create(
            homework=homework or self.homework, student=student, status=status
        )
        for question, is_correct in verdicts.items():
            AssessmentAnswer.objects.create(
                attempt=attempt, question=question, answer="4", is_correct=is_correct
            )
        return attempt


class ThresholdParsingTests(TestCase):
    def test_default_and_clamp(self):
        self.assertEqual(parse_threshold(None), 25.0)
        self.assertEqual(parse_threshold(""), 25.0)
        self.assertEqual(parse_threshold("40"), 40.0)
        # "Show me everything" is a request, not an error — it clamps rather than 400s.
        self.assertEqual(parse_threshold("0"), 1.0)
        self.assertEqual(parse_threshold("500"), 100.0)

    def test_junk_is_an_error_not_a_silent_default(self):
        with self.assertRaises(ValueError):
            parse_threshold("soon")


class ItemAnalysisCountingTests(TestCase):
    """The owner's rule, and the four ways of getting the denominator wrong."""

    def setUp(self):
        self.fx = _Fixture()
        self.q_bad = self.fx.question("A question a quarter of them missed")
        self.q_ok = self.fx.question("A question most of them got")
        self.students = [_student(f"s{i}@example.com") for i in range(4)]

    def _analyse(self, **kw):
        return build_item_analysis(classroom=self.fx.classroom, **kw)

    def test_exactly_at_threshold_is_flagged(self):
        # 1 wrong out of 4 answering students = 25.0%, the owner's line exactly.
        for i, student in enumerate(self.students):
            self.fx.sit(student, {self.q_bad: i != 0, self.q_ok: True})

        payload = self._analyse()
        rows = {r["question_id"]: r for r in payload["questions"]}
        self.assertEqual(rows[self.q_bad.id]["error_rate"], 25.0)
        self.assertTrue(rows[self.q_bad.id]["needs_analysis"])
        self.assertEqual(rows[self.q_ok.id]["error_rate"], 0.0)
        self.assertFalse(rows[self.q_ok.id]["needs_analysis"])
        self.assertEqual([r["question_id"] for r in payload["needs_analysis"]], [self.q_bad.id])
        self.assertEqual(payload["summary"]["questions_flagged"], 1)
        self.assertEqual(payload["summary"]["students_counted"], 4)

    def test_threshold_is_honoured(self):
        # 1 wrong of 5 = 20%: under the default, over a threshold of 20.
        for i, student in enumerate(self.students + [_student("s4@example.com")]):
            self.fx.sit(student, {self.q_bad: i != 0})

        self.assertEqual(self._analyse()["summary"]["questions_flagged"], 0)
        self.assertEqual(self._analyse(threshold=20.0)["summary"]["questions_flagged"], 1)

    def test_a_skipped_question_is_not_a_wrong_answer(self):
        """No answer row = out of the denominator, not counted as a mistake."""
        self.fx.sit(self.students[0], {self.q_bad: False})
        self.fx.sit(self.students[1], {self.q_bad: True})
        for student in self.students[2:]:
            self.fx.sit(student, {})  # they never reached it

        row = {r["question_id"]: r for r in self._analyse()["questions"]}[self.q_bad.id]
        self.assertEqual(row["students_answered"], 2)
        self.assertEqual(row["students_wrong"], 1)
        self.assertEqual(row["error_rate"], 50.0)
        self.assertEqual(self._analyse()["denominator"], "graded")

    def test_ungraded_is_neither_wrong_nor_in_the_denominator(self):
        """A stuck grading worker must neither manufacture an error rate nor hide one.

        Two students have verdicts, two are still queued. The rate is over the two we know
        about, not over all four — see ``ItemTally.error_rate``. Both counts stay on the row
        so the thinness of the sample is visible.
        """
        self.fx.sit(self.students[0], {self.q_bad: False})
        self.fx.sit(self.students[1], {self.q_bad: None})
        self.fx.sit(self.students[2], {self.q_bad: None})
        self.fx.sit(self.students[3], {self.q_bad: True})

        row = {r["question_id"]: r for r in self._analyse()["questions"]}[self.q_bad.id]
        self.assertEqual(row["ungraded"], 2)
        self.assertEqual(row["students_wrong"], 1)
        self.assertEqual(row["students_correct"], 1)
        self.assertEqual(row["students_answered"], 4)
        self.assertEqual(row["students_graded"], 2)
        self.assertEqual(row["error_rate"], 50.0)

    def test_pending_grading_cannot_hide_a_question_under_the_threshold(self):
        """The regression this denominator exists for.

        One student of five got it wrong and three are still queued. Counting the queued rows
        in the denominator reads 20% — under the school's 25% line, so the question is never
        flagged and nobody looks at it. Over graded work it is 50%, and it is flagged.
        """
        self.fx.sit(self.students[0], {self.q_bad: False})
        self.fx.sit(self.students[1], {self.q_bad: True})
        for student in self.students[2:] + [_student("s4@example.com")]:
            self.fx.sit(student, {self.q_bad: None})

        payload = self._analyse()
        row = {r["question_id"]: r for r in payload["questions"]}[self.q_bad.id]
        self.assertEqual(row["students_answered"], 5)
        self.assertEqual(row["students_graded"], 2)
        self.assertEqual(row["error_rate"], 50.0)
        self.assertTrue(row["needs_analysis"])
        self.assertIn(self.q_bad.id, {r["question_id"] for r in payload["needs_analysis"]})

    def test_a_question_with_no_verdicts_yet_has_no_rate(self):
        """Answered by everyone, graded for nobody: no rate, and not counted as analysed."""
        for student in self.students[:4]:
            self.fx.sit(student, {self.q_bad: None})

        payload = self._analyse()
        row = {r["question_id"]: r for r in payload["questions"]}[self.q_bad.id]
        self.assertEqual(row["students_answered"], 4)
        self.assertEqual(row["students_graded"], 0)
        self.assertIsNone(row["error_rate"])
        self.assertFalse(row["needs_analysis"])
        self.assertEqual(payload["summary"]["questions_awaiting_grading"], 1)

    def test_a_retry_is_not_a_second_student(self):
        """The retry path re-serves the questions they got WRONG — the first sitting is the
        only unbiased sample, so a later correct answer must not erase the mistake."""
        student = self.students[0]
        self.fx.sit(student, {self.q_bad: False}, status=AssessmentAttempt.STATUS_SUBMITTED)
        self.fx.sit(student, {self.q_bad: True})

        row = {r["question_id"]: r for r in self._analyse()["questions"]}[self.q_bad.id]
        self.assertEqual(row["students_answered"], 1)
        self.assertEqual(row["students_wrong"], 1)
        self.assertEqual(row["error_rate"], 100.0)
        self.assertEqual(self._analyse()["summary"]["attempts_counted"], 1)

    def test_empty_denominator_is_none_never_zero(self):
        payload = self._analyse()
        row = {r["question_id"]: r for r in payload["questions"]}[self.q_bad.id]
        self.assertIsNone(row["error_rate"])
        self.assertNotEqual(row["error_rate"], 0.0)
        self.assertFalse(row["needs_analysis"])
        self.assertEqual(payload["summary"]["questions_analysed"], 0)
        self.assertEqual(payload["summary"]["questions_total"], 2)

    def test_unfinished_and_abandoned_work_is_not_evidence(self):
        self.fx.sit(
            self.students[0], {self.q_bad: False}, status=AssessmentAttempt.STATUS_IN_PROGRESS
        )
        self.fx.sit(
            self.students[1], {self.q_bad: False}, status=AssessmentAttempt.STATUS_ABANDONED
        )

        row = {r["question_id"]: r for r in self._analyse()["questions"]}[self.q_bad.id]
        self.assertEqual(row["students_answered"], 0)
        self.assertIsNone(row["error_rate"])

    def test_retired_questions_are_disclosed_not_silently_dropped(self):
        retired = self.fx.question("Withdrawn from the set", active=False)
        self.fx.sit(self.students[0], {retired: False, self.q_bad: False})

        payload = self._analyse()
        self.assertNotIn(retired.id, {r["question_id"] for r in payload["questions"]})
        self.assertEqual(payload["excluded"]["retired_questions"], 1)

    def test_rows_are_ranked_worst_first_with_unanswered_last(self):
        q_none = self.fx.question("Nobody reached this one")
        self.fx.sit(self.students[0], {self.q_bad: False, self.q_ok: False})
        self.fx.sit(self.students[1], {self.q_bad: False, self.q_ok: True})
        self.fx.sit(self.students[2], {self.q_bad: True, self.q_ok: True})
        self.fx.sit(self.students[3], {self.q_bad: True, self.q_ok: True})

        payload = self._analyse()
        self.assertEqual(
            [r["question_id"] for r in payload["questions"]],
            [self.q_bad.id, self.q_ok.id, q_none.id],
        )
        self.assertEqual([r["error_rate"] for r in payload["questions"]], [50.0, 25.0, None])
        # The flagged list is the same rows, already filtered for the caller.
        self.assertEqual(
            [r["question_id"] for r in payload["needs_analysis"]], [self.q_bad.id, self.q_ok.id]
        )

    def test_row_carries_enough_context_to_act(self):
        long_prompt = "The area of a circle " + ("x" * 400)
        q_long = self.fx.question(long_prompt)
        self.fx.sit(self.students[0], {q_long: False})

        row = {r["question_id"]: r for r in self._analyse()["questions"]}[q_long.id]
        self.assertTrue(row["prompt_truncated"])
        self.assertLessEqual(len(row["prompt"]), 201)  # 200 chars plus the ellipsis
        self.assertTrue(row["prompt"].startswith("The area of a circle"))
        self.assertEqual(row["set"]["title"], "Algebra basics")
        self.assertEqual(row["position"], 3)  # third question in the set
        self.assertEqual(row["question_type_label"], "Numeric")

    def test_html_is_stripped_from_the_excerpt(self):
        q_html = self.fx.question("<p>What is <em>x</em>?</p>")
        row = {r["question_id"]: r for r in self._analyse()["questions"]}[q_html.id]
        self.assertEqual(row["prompt"], "What is x?")

    def test_by_question_type_is_always_present_and_pooled(self):
        q_mc = self.fx.question(
            "Pick one", question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE, correct_answer="A"
        )
        # 1 of 2 wrong on the numeric question, 2 of 2 wrong on the MC one. Pooled, the MC
        # bucket is 100% — not the average of two per-question percentages.
        self.fx.sit(self.students[0], {self.q_bad: False, q_mc: False})
        self.fx.sit(self.students[1], {self.q_bad: True, q_mc: False})

        buckets = {b["key"]: b for b in self._analyse()["by_question_type"]}
        self.assertEqual(buckets[AssessmentQuestion.TYPE_MULTIPLE_CHOICE]["error_rate"], 100.0)
        self.assertEqual(buckets[AssessmentQuestion.TYPE_MULTIPLE_CHOICE]["label"], "Multiple choice")
        self.assertEqual(buckets[AssessmentQuestion.TYPE_NUMERIC]["students_answered"], 2)
        self.assertEqual(buckets[AssessmentQuestion.TYPE_NUMERIC]["students_wrong"], 1)

    def test_a_set_not_assigned_here_is_an_error_not_an_empty_page(self):
        other = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="geometry",
            title="Not assigned",
            created_by=self.fx.teacher,
        )
        with self.assertRaises(UnknownAssessmentSet):
            self._analyse(assessment_set_id=other.id)

    def test_set_filter_narrows_to_one_set(self):
        second = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="geometry",
            title="Geometry",
            created_by=self.fx.teacher,
        )
        assignment = Assignment.objects.create(
            classroom=self.fx.classroom, created_by=self.fx.teacher, title="HW2", instructions=""
        )
        hw2 = HomeworkAssignment.objects.create(
            classroom=self.fx.classroom,
            assessment_set=second,
            assignment=assignment,
            assigned_by=self.fx.teacher,
        )
        q2 = AssessmentQuestion.objects.create(
            assessment_set=second,
            order=1,
            prompt="Area of a square?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=9,
        )
        self.fx.sit(self.students[0], {q2: False}, homework=hw2)

        self.assertEqual(self._analyse()["summary"]["questions_total"], 3)
        narrowed = self._analyse(assessment_set_id=second.id)
        self.assertEqual([r["question_id"] for r in narrowed["questions"]], [q2.id])
        self.assertEqual(narrowed["summary"]["sets"], 1)


class ItemAnalysisTaxonomyTests(TestCase):
    """Skill and domain exist only through the nullable bank link — the usual case is none."""

    def setUp(self):
        self.fx = _Fixture(teacher=_teacher("tax@example.com"))
        self.student = _student("taxst@example.com")

    def _bank_question(self, qb_id: str, *, skill) -> BankQuestion:
        row = BankQuestion(
            subject=Subject.MATH,
            domain=skill.domain,
            skill=skill,
            status=QuestionStatus.APPROVED,
            question_type=QuestionType.NUMERIC,
            question_text="What is x?",
        )
        row.qb_id = qb_id
        row.save()
        return row

    def test_zero_coverage_degrades_to_an_honest_empty_result(self):
        question = self.fx.question("Unlinked, like everything on prod")
        self.fx.sit(self.student, {question: False})

        payload = build_item_analysis(classroom=self.fx.classroom)
        self.assertEqual(payload["taxonomy_coverage"]["linked"], 0)
        self.assertEqual(payload["taxonomy_coverage"]["total"], 1)
        self.assertEqual(payload["by_skill"], [])
        self.assertEqual(payload["by_domain"], [])
        self.assertIn("question bank", payload["taxonomy_coverage"]["note"])
        # The grouping that always works is still there.
        self.assertEqual(len(payload["by_question_type"]), 1)

    def test_partial_coverage_keeps_untagged_as_its_own_bucket_and_sorts_it_last(self):
        domain = BankDomain.objects.create(subject=Subject.MATH, name="Algebra", code="algebra")
        skill = BankSkill.objects.create(domain=domain, name="Linear Functions", code="linear")
        tagged = self.fx.question("Linked", bank=self._bank_question("QB-MATH-000001", skill=skill))
        untagged = self.fx.question("Not linked")
        # The untagged question is the WORSE one — it must still sort last, because a
        # disclosure is not a thing a teacher can go and teach.
        self.fx.sit(self.student, {tagged: False, untagged: False})
        self.fx.sit(_student("taxst2@example.com"), {tagged: True, untagged: False})

        payload = build_item_analysis(classroom=self.fx.classroom)
        self.assertEqual(payload["taxonomy_coverage"]["linked"], 1)
        self.assertEqual(payload["taxonomy_coverage"]["rate"], 50.0)
        self.assertEqual([b["label"] for b in payload["by_skill"]], ["Linear Functions", UNTAGGED])
        self.assertEqual([b["label"] for b in payload["by_domain"]], ["Algebra", UNTAGGED])
        self.assertEqual(payload["by_skill"][0]["error_rate"], 50.0)
        self.assertEqual(payload["by_skill"][1]["error_rate"], 100.0)
        self.assertIn(UNTAGGED, payload["taxonomy_coverage"]["note"])
        # The skill also rides on the question row, so a flagged row needs no second lookup.
        rows = {r["question_id"]: r for r in payload["questions"]}
        self.assertEqual(rows[tagged.id]["skill"], "Linear Functions")
        self.assertEqual(rows[tagged.id]["domain"], "Algebra")
        self.assertIsNone(rows[untagged.id]["skill"])


class TeacherScopeTests(TestCase):
    """The corrected version of the ``views_review`` scoping block.

    That one matches ``role=TEACHER`` alone and ignores ``status``, so an OWNER or TA sees
    nothing and a removed teacher still sees everything.
    """

    def setUp(self):
        self.owner_teacher = _teacher("scope-owner@example.com")
        self.fx = _Fixture(teacher=self.owner_teacher)

    def _member(self, email, role, status=ClassroomMembership.STATUS_ACTIVE):
        user = _teacher(email)
        ClassroomMembership.objects.create(
            classroom=self.fx.classroom, user=user, role=role, status=status
        )
        return user

    def test_owner_admin_and_ta_memberships_all_count(self):
        for email, role in (
            ("m-owner@example.com", ClassroomMembership.ROLE_OWNER),
            ("m-admin@example.com", ClassroomMembership.ROLE_ADMIN),
            ("m-ta@example.com", ClassroomMembership.ROLE_TA),
            ("m-teacher@example.com", ClassroomMembership.ROLE_TEACHER),
        ):
            user = self._member(email, role)
            self.assertIn(
                self.fx.classroom.id, teacher_classroom_ids(user), f"{role} should be in scope"
            )

    def test_the_classroom_teacher_fk_counts_without_a_membership_row(self):
        self.assertFalse(
            ClassroomMembership.objects.filter(
                classroom=self.fx.classroom, user=self.owner_teacher
            ).exists()
        )
        self.assertIn(self.fx.classroom.id, teacher_classroom_ids(self.owner_teacher))

    def test_a_removed_teacher_loses_the_class(self):
        removed = self._member(
            "m-removed@example.com",
            ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.assertNotIn(self.fx.classroom.id, teacher_classroom_ids(removed))

    def test_an_invited_teacher_still_counts(self):
        invited = self._member(
            "m-invited@example.com",
            ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_INVITED,
        )
        self.assertIn(self.fx.classroom.id, teacher_classroom_ids(invited))

    def test_a_student_membership_is_not_teaching_staff(self):
        student = _student("scope-student@example.com")
        ClassroomMembership.objects.create(
            classroom=self.fx.classroom, user=student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assertNotIn(self.fx.classroom.id, teacher_classroom_ids(student))

    def test_global_staff_are_unrestricted(self):
        admin = User.objects.create_user(
            email="scope-admin@example.com", password="x", role=acc_const.ROLE_ADMIN
        )
        self.assertIsNone(teacher_classroom_ids(admin))


class ItemAnalysisApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.fx = _Fixture(teacher=_teacher("api-owner@example.com"))
        self.question = self.fx.question("A question they struggled with")
        self.student = _student("api-st@example.com")
        self.fx.sit(self.student, {self.question: False})

    def test_a_class_owner_can_read_it(self):
        """The case ``views_review``'s scoping block gets wrong: an OWNER membership."""
        owner = _teacher("api-member-owner@example.com")
        ClassroomMembership.objects.create(
            classroom=self.fx.classroom, user=owner, role=ClassroomMembership.ROLE_OWNER
        )
        self.client.force_authenticate(owner)

        resp = self.client.get(URL, {"classroom": self.fx.classroom.id})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["classroom"]["name"], "Math class")
        self.assertEqual(body["classroom"]["subject_label"], "Math")
        self.assertEqual(body["threshold"], 25.0)
        self.assertEqual(len(body["needs_analysis"]), 1)
        self.assertEqual(body["needs_analysis"][0]["question_id"], self.question.id)
        self.assertEqual(body["summary"]["students_counted"], 1)

    def test_a_teacher_from_another_class_is_refused(self):
        outsider = _teacher("api-outsider@example.com")
        self.client.force_authenticate(outsider)
        resp = self.client.get(URL, {"classroom": self.fx.classroom.id})
        self.assertEqual(resp.status_code, 403)

    def test_a_student_in_the_class_cannot_read_it(self):
        """Being in the room is not the same as teaching it — these are staff numbers."""
        ClassroomMembership.objects.create(
            classroom=self.fx.classroom,
            user=self.student,
            role=ClassroomMembership.ROLE_STUDENT,
        )
        self.client.force_authenticate(self.student)
        resp = self.client.get(URL, {"classroom": self.fx.classroom.id})
        self.assertEqual(resp.status_code, 403)

    def test_global_staff_see_any_classroom(self):
        admin = User.objects.create_user(
            email="api-admin@example.com", password="x", role=acc_const.ROLE_ADMIN
        )
        self.client.force_authenticate(admin)
        resp = self.client.get(URL, {"classroom": self.fx.classroom.id})
        self.assertEqual(resp.status_code, 200)

    def test_anonymous_is_rejected(self):
        resp = self.client.get(URL, {"classroom": self.fx.classroom.id})
        self.assertIn(resp.status_code, (401, 403))

    def test_missing_and_junk_parameters_say_what_is_wrong(self):
        self.client.force_authenticate(self.fx.teacher)

        missing = self.client.get(URL)
        self.assertEqual(missing.status_code, 400)
        self.assertIn("classroom", missing.json()["detail"])

        junk = self.client.get(URL, {"classroom": "the math one"})
        self.assertEqual(junk.status_code, 400)

        bad_threshold = self.client.get(
            URL, {"classroom": self.fx.classroom.id, "threshold": "soon"}
        )
        self.assertEqual(bad_threshold.status_code, 400)

    def test_unknown_classroom_is_a_404(self):
        self.client.force_authenticate(self.fx.teacher)
        resp = self.client.get(URL, {"classroom": 9_999_999})
        self.assertEqual(resp.status_code, 404)

    def test_a_set_from_another_class_is_a_404_not_an_empty_report(self):
        other = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="geometry",
            title="Elsewhere",
            created_by=self.fx.teacher,
        )
        self.client.force_authenticate(self.fx.teacher)
        resp = self.client.get(URL, {"classroom": self.fx.classroom.id, "set": other.id})
        self.assertEqual(resp.status_code, 404)

    def test_threshold_is_clamped_rather_than_refused(self):
        self.client.force_authenticate(self.fx.teacher)
        self.assertEqual(
            self.client.get(URL, {"classroom": self.fx.classroom.id, "threshold": 0}).json()[
                "threshold"
            ],
            1.0,
        )
        self.assertEqual(
            self.client.get(URL, {"classroom": self.fx.classroom.id, "threshold": 500}).json()[
                "threshold"
            ],
            100.0,
        )

    def test_a_classroom_with_no_work_yet_is_empty_not_broken(self):
        empty = _Fixture(teacher=self.fx.teacher, name="Brand new class")
        empty.question("Nobody has sat this")
        self.client.force_authenticate(self.fx.teacher)

        resp = self.client.get(URL, {"classroom": empty.classroom.id})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["needs_analysis"], [])
        self.assertEqual(body["summary"]["questions_analysed"], 0)
        self.assertIsNone(body["questions"][0]["error_rate"])
