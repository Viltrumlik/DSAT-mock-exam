"""The past-paper item analysis as it appears *inside one homework*.

The owner's requirement: *"assessment va pastpaper statisticslar har homework deadline
tugaganda o'sha homeworkning ichida ko'rinib turishi kerak"*.

Two hazards are specific to this half. A homework attaches past papers through FOUR different
fields, so anything that reads one of them silently analyses part of the homework; and while
the deadline is still ahead the response must not contain a stem, an answer key or an error
rate anywhere — asserted against the serialised body, so a field added later cannot slip past
a check written before it existed.
"""

from __future__ import annotations

import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from assessments.item_analysis import (
    HOMEWORK_CLOSED,
    HOMEWORK_NO_DEADLINE,
    HOMEWORK_OPEN,
)
from classes.models import Assignment, Classroom, ClassroomMembership
from exams.models import MockExam, PracticeTest, Question, TestAttempt
from exams.pastpaper_item_analysis import (
    MAX_PAPERS_PER_HOMEWORK,
    build_homework_pastpaper_item_analysis,
)

User = get_user_model()

URL = "/api/exams/teacher/pastpaper-item-analysis/"

#: Two strings a locked response must not contain. Distinctive enough to be proof.
SECRET_STEM = "ZZ-SECRET-STEM the derivative of the mediant"
SECRET_ANSWER = "zqx"


class HomeworkPastpaperFixture(TestCase):
    """A classroom, a homework, and past papers to hang off it."""

    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user("hwpp_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Senior G12 · Math",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        self.yesterday = timezone.now() - timedelta(days=1)
        self.tomorrow = timezone.now() + timedelta(days=1)
        self.paper = self.make_paper("Practice Paper 7")
        self.assignment = self.homework(due_at=self.yesterday, practice_test=self.paper)

    # ── fixture helpers ──────────────────────────────────────────────────────
    def make_paper(self, title, *, mock_exam=None):
        """A past paper (or, with ``mock_exam``, a mock section). Modules 1 and 2 are
        auto-created by ``PracticeTest``'s post_save."""
        return PracticeTest.objects.create(
            subject="MATH", title=title, collection_name="Bluebook", mock_exam=mock_exam
        )

    def homework(self, *, due_at, title="Week 4 — Past papers", **attachments):
        return Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.teacher,
            title=title,
            instructions="",
            due_at=due_at,
            **attachments,
        )

    def mc(self, paper, *, order=0, answer=SECRET_ANSWER, stem=SECRET_STEM):
        return Question.objects.create(
            module=paper.modules.get(module_order=1),
            question_type="MATH",
            question_text=stem,
            option_a="Choice A",
            option_b="Choice B",
            correct_answers=answer,
            order=order,
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

    def sit(self, paper, student, answers):
        return TestAttempt.objects.create(
            practice_test=paper,
            student=student,
            is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED,
            completed_at=timezone.now(),
            module_answers=answers,
        )

    def wrong_sitting(self, paper, question, student):
        """One student who got ``question`` wrong — 1 of 1 answered, a 100% error rate."""
        module = paper.modules.get(module_order=1)
        return self.sit(paper, student, {str(module.id): {str(question.pk): "not-the-key"}})

    def get(self, **params):
        params.setdefault("assignment", self.assignment.pk)
        return self.client.get(URL, params)


class ClosedHomeworkTests(HomeworkPastpaperFixture):
    """Deadline passed: one full analysis per attached paper."""

    def setUp(self):
        super().setUp()
        self.q = self.mc(self.paper)
        self.wrong_sitting(self.paper, self.q, self.enrol("hwpp_s1@t.com"))
        self.client.force_authenticate(self.teacher)

    def test_the_papers_come_back_with_the_homework_block(self):
        body = self.get().json()
        self.assertEqual(body["homework"]["id"], self.assignment.pk)
        self.assertEqual(body["homework"]["state"], HOMEWORK_CLOSED)
        self.assertFalse(body["homework"]["locked"])
        self.assertEqual(body["classroom"]["id"], self.classroom.pk)
        self.assertEqual(len(body["papers"]), 1)

    def test_each_entry_keeps_the_shape_the_standalone_page_already_reads(self):
        paper = self.get().json()["papers"][0]
        self.assertEqual(paper["practice_test"]["id"], self.paper.pk)
        self.assertEqual(paper["practice_test"]["title"], "Practice Paper 7")
        self.assertEqual(paper["practice_test"]["collection_name"], "Bluebook")
        self.assertEqual(paper["practice_test"]["subject"], "MATH")
        self.assertEqual([r["question_id"] for r in paper["needs_analysis"]], [self.q.pk])
        self.assertEqual(paper["totals"]["questions"], 1)

    def test_the_classroom_roster_is_resolved_from_the_homework_alone(self):
        """No ``classroom`` parameter is sent, and the cohort is still this class."""
        body = self.get().json()
        self.assertEqual(body["papers"][0]["data_quality"]["roster"], 1)
        self.assertEqual(body["classroom"]["subject_label"], "Math")

    def test_the_threshold_reaches_every_paper(self):
        body = self.get(threshold=99).json()
        self.assertEqual(body["threshold"], 99)
        self.assertEqual(body["papers"][0]["threshold"], 99)


class AttachmentResolutionTests(HomeworkPastpaperFixture):
    """A homework attaches past papers through four fields — never read just one."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.teacher)

    def test_several_papers_are_each_analysed_in_full(self):
        second = self.make_paper("Practice Paper 8")
        third = self.make_paper("Practice Paper 9")
        # The bundle field, not the single FK: a homework built in the classroom UI uses it.
        self.assignment.practice_test = None
        self.assignment.practice_test_ids = [second.pk, third.pk]
        self.assignment.save(update_fields=["practice_test", "practice_test_ids"])

        q2 = self.mc(second, stem="Second paper question")
        q3 = self.mc(third, stem="Third paper question")
        student = self.enrol("hwpp_multi@t.com")
        self.wrong_sitting(second, q2, student)
        self.wrong_sitting(third, q3, self.enrol("hwpp_multi2@t.com"))

        body = self.get().json()
        self.assertEqual(body["papers_total"], 2)
        self.assertEqual(
            [p["practice_test"]["id"] for p in body["papers"]], [second.pk, third.pk]
        )
        self.assertEqual([p["practice_test"]["id"] for p in body["papers"]].count(second.pk), 1)
        self.assertEqual(
            [r["question_id"] for r in body["papers"][0]["needs_analysis"]], [q2.pk]
        )
        self.assertEqual(
            [r["question_id"] for r in body["papers"][1]["needs_analysis"]], [q3.pk]
        )

    def test_the_single_fk_and_the_bundle_are_unioned_not_chosen_between(self):
        """Reading one field is how half a homework gets analysed and looks complete."""
        extra = self.make_paper("Practice Paper 8")
        self.assignment.practice_test_ids = [extra.pk]
        self.assignment.save(update_fields=["practice_test_ids"])

        body = self.get().json()
        self.assertEqual(
            sorted(p["practice_test"]["id"] for p in body["papers"]),
            sorted([self.paper.pk, extra.pk]),
        )

    def test_a_homework_with_no_past_papers_is_an_empty_list_not_an_error(self):
        """An assessment-only or link-only homework. The page draws no past-paper half."""
        bare = self.homework(due_at=self.yesterday, title="Reading only")
        response = self.get(assignment=bare.pk)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["papers"], [])
        self.assertEqual(body["papers_total"], 0)
        self.assertFalse(body["papers_truncated"])
        self.assertEqual(body["truncation_note"], "")

    def test_a_mock_section_is_not_a_past_paper(self):
        """A mock or midterm section is scored and repaired under different rules; this
        report's counting would be wrong about it rather than merely unavailable."""
        mock = MockExam.objects.create(title="Full mock 3")
        section = self.make_paper("Mock section", mock_exam=mock)
        self.assignment.practice_test_ids = [section.pk]
        self.assignment.save(update_fields=["practice_test_ids"])

        body = self.get().json()
        self.assertEqual([p["practice_test"]["id"] for p in body["papers"]], [self.paper.pk])

    def test_a_bundle_past_the_cap_is_truncated_out_loud(self):
        """Silent truncation is forbidden here — a short list nobody flagged is a wrong
        answer that looks like a complete one."""
        extras = [
            self.make_paper(f"Extra paper {i}") for i in range(MAX_PAPERS_PER_HOMEWORK + 1)
        ]
        self.assignment.practice_test = None
        self.assignment.practice_test_ids = [p.pk for p in extras]
        self.assignment.save(update_fields=["practice_test", "practice_test_ids"])

        body = self.get().json()
        self.assertEqual(body["papers_total"], MAX_PAPERS_PER_HOMEWORK + 1)
        self.assertEqual(body["papers_analysed"], MAX_PAPERS_PER_HOMEWORK)
        self.assertEqual(len(body["papers"]), MAX_PAPERS_PER_HOMEWORK)
        self.assertEqual(body["papers_limit"], MAX_PAPERS_PER_HOMEWORK)
        self.assertTrue(body["papers_truncated"])
        self.assertIn(str(MAX_PAPERS_PER_HOMEWORK + 1), body["truncation_note"])

    def test_a_bundle_inside_the_cap_says_nothing_about_truncation(self):
        body = self.get().json()
        self.assertFalse(body["papers_truncated"])
        self.assertEqual(body["truncation_note"], "")


class LockedHomeworkTests(HomeworkPastpaperFixture):
    """Deadline still ahead. No stem, no key, no rate — and no ``papers`` key at all."""

    def setUp(self):
        super().setUp()
        self.assignment = self.homework(
            due_at=self.tomorrow, title="Week 6 — still open", practice_test=self.paper
        )
        self.q = self.mc(self.paper)
        self.wrong_sitting(self.paper, self.q, self.enrol("hwpp_early@t.com"))
        self.client.force_authenticate(self.teacher)

    def test_it_is_a_200_not_a_403(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["homework"]["locked"])
        self.assertEqual(response.json()["homework"]["state"], HOMEWORK_OPEN)

    def test_the_body_contains_no_question_data_at_all(self):
        """Asserted on the serialised body: a key-by-key check only proves the fields
        somebody already thought of are absent."""
        blob = json.dumps(self.get().json())

        self.assertNotIn(SECRET_STEM, blob)
        self.assertNotIn(SECRET_ANSWER, blob)
        self.assertNotIn("error_rate", blob)
        self.assertNotIn("needs_analysis", blob)
        self.assertNotIn("questions", blob)
        self.assertNotIn("correct_answer", blob)
        self.assertNotIn("stem", blob)
        self.assertNotIn("suspect_key", blob)
        self.assertNotIn("groups", blob)

    def test_there_is_no_empty_papers_list_to_misread(self):
        """"The deadline has not passed" and "there are no past papers here" are two
        different sentences, and ``papers: []`` already means the second one."""
        self.assertNotIn("papers", self.get().json())

    def test_the_page_still_gets_what_it_needs_to_explain_itself(self):
        body = self.get().json()
        self.assertEqual(body["homework"]["title"], "Week 6 — still open")
        self.assertTrue(body["homework"]["due_at"])
        self.assertEqual(body["classroom"]["name"], "Senior G12 · Math")

    def test_the_builder_locks_too_not_only_the_view(self):
        payload = build_homework_pastpaper_item_analysis(self.assignment, [])
        self.assertTrue(payload["homework"]["locked"])
        self.assertNotIn("papers", payload)


class NoDeadlineHomeworkTests(HomeworkPastpaperFixture):
    """``due_at`` is NULL: unlocked, because the owner's condition can never arrive."""

    def setUp(self):
        super().setUp()
        self.assignment = self.homework(
            due_at=None, title="Ongoing practice", practice_test=self.paper
        )
        self.q = self.mc(self.paper)
        self.wrong_sitting(self.paper, self.q, self.enrol("hwpp_nodl@t.com"))
        self.client.force_authenticate(self.teacher)

    def test_the_numbers_show_and_the_state_says_no_deadline(self):
        body = self.get().json()
        self.assertEqual(body["homework"]["state"], HOMEWORK_NO_DEADLINE)
        self.assertIsNone(body["homework"]["due_at"])
        self.assertFalse(body["homework"]["locked"])
        self.assertEqual(
            [r["question_id"] for r in body["papers"][0]["needs_analysis"]], [self.q.pk]
        )


class HomeworkAccessTests(HomeworkPastpaperFixture):
    """Who may read it, and what a bad ask gets back."""

    def setUp(self):
        super().setUp()
        self.q = self.mc(self.paper)
        self.wrong_sitting(self.paper, self.q, self.enrol("hwpp_acc@t.com"))

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.get()

    def test_the_class_owner_fk_reads_it(self):
        self.assertEqual(self._as(self.teacher).status_code, 200)

    def test_an_owner_membership_reads_it_without_the_teacher_fk(self):
        owner = User.objects.create_user("hwpp_owner@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=owner, role=ClassroomMembership.ROLE_OWNER
        )
        self.assertEqual(self._as(owner).status_code, 200)

    def test_a_teaching_assistant_reads_it_too(self):
        ta = User.objects.create_user("hwpp_ta@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=ta, role=ClassroomMembership.ROLE_TA
        )
        self.assertEqual(self._as(ta).status_code, 200)

    def test_a_removed_teacher_no_longer_reads_it(self):
        removed = User.objects.create_user("hwpp_removed@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom,
            user=removed,
            role=ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.assertEqual(self._as(removed).status_code, 404)

    def test_an_unrelated_teacher_gets_a_404_not_a_403(self):
        """A homework id is a bare integer; 403-for-real and 404-for-missing would turn this
        endpoint into an enumerator of the school's homework."""
        stranger = User.objects.create_user("hwpp_stranger@t.com", "secret123")
        self.assertEqual(self._as(stranger).status_code, 404)

    def test_an_unknown_homework_is_a_404(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.get(assignment=9_999_999).status_code, 404)

    def test_global_staff_read_any_homework(self):
        admin = User.objects.create_user("hwpp_admin@t.com", "secret123", is_superuser=True)
        self.assertEqual(self._as(admin).status_code, 200)

    def test_anonymous_is_refused(self):
        self.assertIn(self.get().status_code, (401, 403))

    def test_assignment_and_practice_test_together_is_a_400(self):
        self.client.force_authenticate(self.teacher)
        response = self.get(practice_test=self.paper.pk)
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


class StandaloneFormUnchangedTests(HomeworkPastpaperFixture):
    """The question-analysis page must not notice any of this."""

    def setUp(self):
        super().setUp()
        self.q = self.mc(self.paper)
        self.wrong_sitting(self.paper, self.q, self.enrol("hwpp_solo@t.com"))
        self.client.force_authenticate(self.teacher)

    def test_the_single_paper_form_answers_exactly_as_before(self):
        body = self.client.get(
            URL, {"classroom": self.classroom.pk, "practice_test": self.paper.pk}
        ).json()
        self.assertNotIn("papers", body)
        self.assertNotIn("homework", body)
        self.assertEqual(body["practice_test"]["id"], self.paper.pk)
        self.assertEqual([r["question_id"] for r in body["needs_analysis"]], [self.q.pk])

    def test_the_single_paper_form_ignores_the_deadline(self):
        """It is asked about a paper, not a homework, so no ``due_at`` gates it."""
        self.homework(due_at=self.tomorrow, title="Week 6", practice_test=self.paper)
        response = self.client.get(
            URL, {"classroom": self.classroom.pk, "practice_test": self.paper.pk}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["needs_analysis"]), 1)
