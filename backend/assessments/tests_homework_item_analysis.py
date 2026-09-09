"""The assessment item analysis as it appears *inside one homework*.

The owner's requirement: *"assessment va pastpaper statisticslar har homework deadline
tugaganda o'sha homeworkning ichida ko'rinib turishi kerak"* — the statistics belong inside
the homework, once that homework's deadline has passed.

Two things here are worth more than the rest of the file. The first is the lock: while the
deadline is still ahead, the response must not contain a prompt, an answer key or an error
rate ANYWHERE, and the test for that asserts on the serialised body rather than on a list of
keys, so a field added next year cannot leak through a check that was written before it
existed. The second is that "locked", "empty" and "forbidden" are three different screens —
a 403 would render as an error, and an error must never render as an empty state.
"""

from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.item_analysis import (
    HOMEWORK_CLOSED,
    HOMEWORK_NO_DEADLINE,
    HOMEWORK_OPEN,
    build_homework_item_analysis,
    homework_deadline_block,
)
from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()

URL = "/api/assessments/teacher/item-analysis/"

#: Two strings that must never appear in a locked response. Distinctive enough that finding
#: them in the body is proof rather than coincidence.
SECRET_PROMPT = "ZZ-SECRET-STEM which of these is the mediant"
SECRET_ANSWER = 987654


def _teacher(email: str):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH
    )


def _student(email: str):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_STUDENT, subject=""
    )


class HomeworkFixture(TestCase):
    """One classroom, one homework, and helpers to hang assessments and sittings off it."""

    def setUp(self):
        self.client = APIClient()
        self.teacher = _teacher("hw-owner@example.com")
        self.classroom = Classroom.objects.create(
            name="Math class",
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_JUNIOR,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        self.yesterday = timezone.now() - timedelta(days=1)
        self.tomorrow = timezone.now() + timedelta(days=1)
        self.assignment = self.homework(due_at=self.yesterday)
        self._order = 0

    # ── fixture helpers ──────────────────────────────────────────────────────
    def homework(self, *, due_at, title="Week 4 — Algebra"):
        return Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.teacher,
            title=title,
            instructions="",
            due_at=due_at,
        )

    def attach_set(self, assignment=None, *, title="Algebra basics"):
        """A new AssessmentSet, carried by ``assignment`` as one of its homeworks."""
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="algebra",
            title=title,
            created_by=self.teacher,
        )
        hw = HomeworkAssignment.objects.create(
            classroom=self.classroom,
            assessment_set=aset,
            assignment=assignment or self.assignment,
            assigned_by=self.teacher,
        )
        return aset, hw

    def question(self, aset, prompt=SECRET_PROMPT):
        self._order += 1
        return AssessmentQuestion.objects.create(
            assessment_set=aset,
            order=self._order,
            prompt=prompt,
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=SECRET_ANSWER,
            is_active=True,
        )

    def sit(self, homework, student, verdicts):
        attempt = AssessmentAttempt.objects.create(
            homework=homework, student=student, status=AssessmentAttempt.STATUS_GRADED
        )
        for question, is_correct in verdicts.items():
            AssessmentAnswer.objects.create(
                attempt=attempt, question=question, answer="4", is_correct=is_correct
            )
        return attempt

    def get(self, **params):
        params.setdefault("assignment", self.assignment.pk)
        return self.client.get(URL, params)


class DeadlineStateTests(TestCase):
    """The three states, without a database — this is a comparison, not a query."""

    def _block(self, due_at):
        return homework_deadline_block(
            SimpleNamespace(pk=7, title="Week 4 — Algebra", due_at=due_at)
        )

    def test_a_deadline_in_the_past_is_closed_and_unlocked(self):
        block = self._block(timezone.now() - timedelta(seconds=1))
        self.assertEqual(block["state"], HOMEWORK_CLOSED)
        self.assertFalse(block["locked"])

    def test_a_deadline_still_ahead_is_open_and_locked(self):
        block = self._block(timezone.now() + timedelta(seconds=30))
        self.assertEqual(block["state"], HOMEWORK_OPEN)
        self.assertTrue(block["locked"])

    def test_the_instant_of_the_deadline_counts_as_closed(self):
        """The deadline is when the homework shuts, not the moment after."""
        block = self._block(timezone.now())
        self.assertEqual(block["state"], HOMEWORK_CLOSED)
        self.assertFalse(block["locked"])

    def test_no_deadline_is_its_own_state_and_is_never_locked(self):
        """``due_at`` is nullable. "Deadline passed" can never arrive for such a homework,
        so withholding the analysis forever would be the wrong answer, and calling it
        ``closed`` would be a lie about a homework students can still hand in."""
        block = self._block(None)
        self.assertEqual(block["state"], HOMEWORK_NO_DEADLINE)
        self.assertFalse(block["locked"])
        self.assertIsNone(block["due_at"])

    def test_the_block_names_the_homework(self):
        block = self._block(None)
        self.assertEqual(block["id"], 7)
        self.assertEqual(block["title"], "Week 4 — Algebra")


class ClosedHomeworkTests(HomeworkFixture):
    """Deadline passed: the numbers show, narrowed to this homework's assessments."""

    def setUp(self):
        super().setUp()
        self.aset, self.hw = self.attach_set()
        self.q = self.question(self.aset)
        self.students = [_student(f"closed{i}@example.com") for i in range(4)]
        for i, student in enumerate(self.students):
            self.sit(self.hw, student, {self.q: i != 0})  # 1 of 4 wrong = 25%
        self.client.force_authenticate(self.teacher)

    def test_the_analysis_is_served_with_the_homework_block(self):
        body = self.get().json()
        self.assertEqual(body["homework"]["id"], self.assignment.pk)
        self.assertEqual(body["homework"]["title"], "Week 4 — Algebra")
        self.assertEqual(body["homework"]["state"], HOMEWORK_CLOSED)
        self.assertFalse(body["homework"]["locked"])
        self.assertTrue(body["homework"]["due_at"].startswith(str(self.yesterday.year)))

    def test_the_owners_rule_still_decides_the_list(self):
        body = self.get().json()
        self.assertEqual([r["question_id"] for r in body["needs_analysis"]], [self.q.pk])
        self.assertEqual(body["questions"][0]["error_rate"], 25.0)
        self.assertEqual(body["summary"]["students_counted"], 4)
        self.assertEqual(body["classroom"]["id"], self.classroom.pk)

    def test_the_classroom_is_resolved_from_the_homework_alone(self):
        """No ``classroom`` parameter is sent, and the report still knows the class."""
        self.assertEqual(self.get().json()["classroom"]["name"], "Math class")

    def test_the_threshold_still_reaches_the_report(self):
        self.assertEqual(self.get(threshold=99).json()["needs_analysis"], [])
        self.assertEqual(self.get(threshold=99).json()["threshold"], 99.0)


class HomeworkScopeTests(HomeworkFixture):
    """A homework may carry several assessments — and must carry only its own."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.teacher)

    def test_every_set_on_the_homework_is_analysed(self):
        """``HomeworkAssignment.assignment`` is an FK, not a OneToOne: one homework, N sets.

        Analysing the first alone would report on part of the homework while looking like it
        reported on all of it.
        """
        first_set, first_hw = self.attach_set(title="Algebra basics")
        second_set, second_hw = self.attach_set(title="Linear equations")
        q1 = self.question(first_set, prompt="Set one question")
        q2 = self.question(second_set, prompt="Set two question")
        student = _student("multi@example.com")
        self.sit(first_hw, student, {q1: False})
        self.sit(second_hw, student, {q2: False})

        body = self.get().json()
        self.assertEqual(
            sorted(s["title"] for s in body["sets"]), ["Algebra basics", "Linear equations"]
        )
        self.assertEqual(body["summary"]["sets"], 2)
        self.assertEqual(
            sorted(r["question_id"] for r in body["questions"]), sorted([q1.pk, q2.pk])
        )

    def test_another_homeworks_assessments_stay_out(self):
        """The same classroom's other homework is not this homework's business."""
        mine_set, mine_hw = self.attach_set(title="Mine")
        mine_q = self.question(mine_set, prompt="Mine")

        other_assignment = self.homework(due_at=self.yesterday, title="Week 5")
        other_set, other_hw = self.attach_set(other_assignment, title="Theirs")
        other_q = self.question(other_set, prompt="Theirs")

        student = _student("scoped@example.com")
        self.sit(mine_hw, student, {mine_q: False})
        self.sit(other_hw, student, {other_q: False})

        body = self.get().json()
        self.assertEqual([s["title"] for s in body["sets"]], ["Mine"])
        self.assertEqual([r["question_id"] for r in body["questions"]], [mine_q.pk])

    def test_a_homework_with_no_assessments_is_empty_not_broken(self):
        """A link-only or pastpaper-only homework. The page draws no assessment half —
        which is a different sentence from "this class has no assessments"."""
        response = self.get()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["sets"], [])
        self.assertEqual(body["questions"], [])
        self.assertEqual(body["needs_analysis"], [])
        self.assertEqual(body["summary"]["questions_total"], 0)
        self.assertEqual(
            body["taxonomy_coverage"]["note"], "This homework has no assessments attached."
        )

    def test_a_classroom_with_assessments_elsewhere_still_reads_empty_here(self):
        """The regression the note above exists for: the class is full, this homework is not."""
        other_assignment = self.homework(due_at=self.yesterday, title="Week 5")
        other_set, _hw = self.attach_set(other_assignment, title="Theirs")
        self.question(other_set, prompt="Theirs")

        body = self.get().json()
        self.assertEqual(body["questions"], [])
        self.assertNotIn("no assessment questions yet", body["taxonomy_coverage"]["note"])


class LockedHomeworkTests(HomeworkFixture):
    """Deadline still ahead. Nothing about the questions may reach the wire."""

    def setUp(self):
        super().setUp()
        self.assignment = self.homework(due_at=self.tomorrow, title="Week 6 — still open")
        self.aset, self.hw = self.attach_set()
        self.q = self.question(self.aset)
        self.sit(self.hw, _student("early@example.com"), {self.q: False})
        self.client.force_authenticate(self.teacher)

    def test_it_is_a_200_not_a_403(self):
        """"Not yet" is a state of the homework, not a failed request. A 403 renders as an
        error page, and an error page is the wrong screen for a homework that is simply
        still open."""
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["homework"]["locked"])
        self.assertEqual(response.json()["homework"]["state"], HOMEWORK_OPEN)

    def test_the_body_contains_no_question_data_at_all(self):
        """Asserted against the serialised body, not a list of keys.

        A key-by-key check only proves the fields somebody thought of are absent. Searching
        the JSON text proves that no field, including one added years from now, carried a
        prompt, an answer key or an error rate past the lock.
        """
        blob = json.dumps(self.get().json())

        self.assertNotIn(SECRET_PROMPT, blob)
        self.assertNotIn(str(SECRET_ANSWER), blob)
        self.assertNotIn("error_rate", blob)
        self.assertNotIn("needs_analysis", blob)
        self.assertNotIn("questions", blob)
        self.assertNotIn("prompt", blob)
        self.assertNotIn("correct", blob)
        self.assertNotIn("students_wrong", blob)
        self.assertNotIn("by_question_type", blob)

    def test_the_page_still_gets_what_it_needs_to_explain_itself(self):
        body = self.get().json()
        self.assertEqual(body["homework"]["title"], "Week 6 — still open")
        self.assertTrue(body["homework"]["due_at"])
        self.assertEqual(body["classroom"]["subject_label"], "Math")

    def test_the_lock_is_the_servers_clock_not_the_callers(self):
        """Nothing in the request can move the deadline; only ``due_at`` and ``now()`` do."""
        self.assertTrue(self.get(threshold=1).json()["homework"]["locked"])
        self.assertNotIn("questions", self.get(threshold=1).json())

    def test_the_builder_locks_too_not_only_the_view(self):
        """The rule lives under the view, so a future caller cannot route around it."""
        payload = build_homework_item_analysis(assignment=self.assignment)
        self.assertTrue(payload["homework"]["locked"])
        self.assertNotIn("questions", payload)


class NoDeadlineHomeworkTests(HomeworkFixture):
    """``due_at`` is NULL: unlocked, and honest about why."""

    def setUp(self):
        super().setUp()
        self.assignment = self.homework(due_at=None, title="Ongoing practice")
        self.aset, self.hw = self.attach_set()
        self.q = self.question(self.aset)
        self.sit(self.hw, _student("open1@example.com"), {self.q: False})
        self.client.force_authenticate(self.teacher)

    def test_the_numbers_show_and_the_state_says_no_deadline(self):
        body = self.get().json()
        self.assertEqual(body["homework"]["state"], HOMEWORK_NO_DEADLINE)
        self.assertIsNone(body["homework"]["due_at"])
        self.assertFalse(body["homework"]["locked"])
        self.assertEqual([r["question_id"] for r in body["needs_analysis"]], [self.q.pk])


class HomeworkAccessTests(HomeworkFixture):
    """Who may read a homework's analysis, and what a bad ask gets back."""

    def setUp(self):
        super().setUp()
        self.aset, self.hw = self.attach_set()
        self.q = self.question(self.aset)
        self.sit(self.hw, _student("acc@example.com"), {self.q: False})

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.get()

    def test_the_class_owner_fk_reads_it(self):
        self.assertEqual(self._as(self.teacher).status_code, 200)

    def test_an_owner_membership_reads_it_without_the_teacher_fk(self):
        """The case ``views_review``'s scoping block gets wrong: an OWNER row, not TEACHER."""
        owner = _teacher("hw-member-owner@example.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=owner, role=ClassroomMembership.ROLE_OWNER
        )
        self.assertEqual(self._as(owner).status_code, 200)

    def test_a_teaching_assistant_reads_it_too(self):
        ta = _teacher("hw-ta@example.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=ta, role=ClassroomMembership.ROLE_TA
        )
        self.assertEqual(self._as(ta).status_code, 200)

    def test_a_removed_teacher_no_longer_reads_it(self):
        """A removal is a soft delete; a status-blind scope would still let them in."""
        removed = _teacher("hw-removed@example.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom,
            user=removed,
            role=ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.assertEqual(self._as(removed).status_code, 404)

    def test_a_student_in_the_class_cannot_read_it(self):
        """Being in the room is not teaching it — and these rows name the wrong answers."""
        student = _student("hw-inclass@example.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assertEqual(self._as(student).status_code, 404)

    def test_a_teacher_from_another_class_gets_a_404_not_a_403(self):
        """A homework id is a bare integer. 403-for-real, 404-for-missing would make this
        endpoint an enumerator of every homework in the school."""
        outsider = _teacher("hw-outsider@example.com")
        self.assertEqual(self._as(outsider).status_code, 404)

    def test_an_unknown_homework_is_a_404(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.get(assignment=9_999_999).status_code, 404)

    def test_global_staff_read_any_homework(self):
        admin = User.objects.create_user(
            email="hw-admin@example.com", password="x", role=acc_const.ROLE_ADMIN
        )
        self.assertEqual(self._as(admin).status_code, 200)

    def test_anonymous_is_rejected(self):
        self.assertIn(self.get().status_code, (401, 403))

    def test_assignment_and_set_together_is_a_400(self):
        """Two different narrowings of the same report. Picking one silently is how a
        teacher ends up reading numbers for something they did not ask about."""
        self.client.force_authenticate(self.teacher)
        response = self.get(set=self.aset.pk)
        self.assertEqual(response.status_code, 400)
        self.assertIn("assignment", response.json()["detail"])

    def test_a_classroom_that_disagrees_with_the_homework_is_a_400(self):
        elsewhere = Classroom.objects.create(
            name="Other class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.get(classroom=elsewhere.pk).status_code, 400)

    def test_a_matching_classroom_is_accepted(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.get(classroom=self.classroom.pk).status_code, 200)

    def test_a_non_numeric_assignment_is_a_400(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.get(assignment="week-four").status_code, 400)


class StandaloneFormUnchangedTests(HomeworkFixture):
    """The question-analysis page must not notice any of this."""

    def setUp(self):
        super().setUp()
        self.aset, self.hw = self.attach_set()
        self.q = self.question(self.aset)
        self.sit(self.hw, _student("standalone@example.com"), {self.q: False})
        self.client.force_authenticate(self.teacher)

    def test_the_classroom_form_still_reports_everything_and_has_no_homework(self):
        body = self.client.get(URL, {"classroom": self.classroom.pk}).json()
        self.assertIsNone(body["homework"])
        self.assertEqual([r["question_id"] for r in body["needs_analysis"]], [self.q.pk])

    def test_the_classroom_form_ignores_the_deadline_entirely(self):
        """It spans a whole class, so no single homework's ``due_at`` can gate it — and the
        page it serves is behind the same teacher scope."""
        still_open = self.homework(due_at=self.tomorrow, title="Week 6")
        open_set, open_hw = self.attach_set(still_open, title="Open work")
        open_q = self.question(open_set, prompt="Open question")
        self.sit(open_hw, _student("standalone2@example.com"), {open_q: False})

        body = self.client.get(URL, {"classroom": self.classroom.pk}).json()
        self.assertIn(open_q.pk, [r["question_id"] for r in body["questions"]])

    def test_the_set_form_still_narrows_and_still_404s_on_a_stale_set(self):
        body = self.client.get(URL, {"classroom": self.classroom.pk, "set": self.aset.pk}).json()
        self.assertEqual([s["id"] for s in body["sets"]], [self.aset.pk])

        stranger_set = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="geometry",
            title="Elsewhere",
            created_by=self.teacher,
        )
        response = self.client.get(
            URL, {"classroom": self.classroom.pk, "set": stranger_set.pk}
        )
        self.assertEqual(response.status_code, 404)
