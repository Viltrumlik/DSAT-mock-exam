"""Classwork is not homework, and no homework surface may show it.

The owner, 2026-09-13: *"classroomda classwork yaratilsa u homeworkda ham ko'rinayapti.
classwork bilan homework alohida narsa, classwork classworkni o'zida ko'rinishi kerak"* —
classwork created in a classroom was showing up under homework too.

Both live in one table (``Assignment.category``), and nothing filtered on it: the classroom's
assignment list, a student's cross-class list (web To-do, /assessments, the iOS homework
tab), the gradebook, the teacher dashboard's completion figures and the Vocabulary homework
tab all carried classwork. Classwork has no deadline and nothing to hand in, so it sat in
those lists as work nobody could turn in, and every student read as "missing" it.

The Classwork tab still needs the rows, so the classroom list takes ``?category=``; each test
below pins one surface.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()
M = ClassroomMembership


class ClassworkSeparationFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            "sep_teacher@t.com", "secret123", role=acc_const.ROLE_TEACHER, subject="english"
        )
        self.student = User.objects.create_user("sep_student@t.com", "secret123", role=acc_const.ROLE_STUDENT)
        # A schedule the deadline helper can compute, so "no deadline" below is a decision
        # and not an accident of a class with no lesson times.
        self.classroom = Classroom.objects.create(
            name="Separation",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="16:00",
            created_by=self.teacher,
        )
        M.objects.create(classroom=self.classroom, user=self.teacher, role=M.ROLE_TEACHER)
        M.objects.create(classroom=self.classroom, user=self.student, role=M.ROLE_STUDENT)

        self.homework = self._make("Unit 4 homework", Assignment.CATEGORY_HOMEWORK)
        self.classwork = self._make("Lesson 12 classwork", Assignment.CATEGORY_CLASSWORK)
        self.client = APIClient()

    def _make(self, title, category, status=Assignment.STATUS_PUBLISHED):
        return Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.teacher,
            title=title,
            category=category,
            status=status,
            published_at=timezone.now() if status == Assignment.STATUS_PUBLISHED else None,
        )

    def as_(self, who):
        self.client.force_authenticate(who)
        return self.client

    def _ids(self, resp):
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        rows = body["results"] if isinstance(body, dict) and "results" in body else body
        return {row["id"] for row in rows}

    @property
    def list_url(self):
        return f"/api/classes/{self.classroom.id}/assignments/"


class ClassroomAssignmentListTests(ClassworkSeparationFixture):
    def test_the_list_is_homework_for_a_student(self):
        self.assertEqual(self._ids(self.as_(self.student).get(self.list_url)), {self.homework.id})

    def test_the_list_is_homework_for_the_teaching_team(self):
        self.assertEqual(self._ids(self.as_(self.teacher).get(self.list_url)), {self.homework.id})

    def test_the_classwork_tab_asks_for_classwork_by_name(self):
        ids = self._ids(self.as_(self.student).get(self.list_url, {"category": "CLASSWORK"}))
        self.assertEqual(ids, {self.classwork.id})

    def test_the_category_is_read_case_insensitively(self):
        ids = self._ids(self.as_(self.student).get(self.list_url, {"category": "classwork"}))
        self.assertEqual(ids, {self.classwork.id})

    def test_all_is_both(self):
        ids = self._ids(self.as_(self.teacher).get(self.list_url, {"category": "ALL"}))
        self.assertEqual(ids, {self.homework.id, self.classwork.id})

    def test_archived_classwork_is_reachable_from_its_own_tab_only(self):
        archived = self._make("Old classwork", Assignment.CATEGORY_CLASSWORK, Assignment.STATUS_ARCHIVED)
        staff = self.as_(self.teacher)
        self.assertNotIn(archived.id, self._ids(staff.get(self.list_url, {"include_archived": "1"})))
        self.assertIn(
            archived.id,
            self._ids(staff.get(self.list_url, {"include_archived": "1", "category": "CLASSWORK"})),
        )

    def test_a_student_still_never_sees_a_draft_classwork(self):
        draft = self._make("Draft classwork", Assignment.CATEGORY_CLASSWORK, Assignment.STATUS_DRAFT)
        self.assertNotIn(draft.id, self._ids(self.as_(self.student).get(self.list_url, {"category": "CLASSWORK"})))

    def test_an_unknown_category_is_refused_rather_than_guessed(self):
        resp = self.as_(self.teacher).get(self.list_url, {"category": "HOMEWRK"})
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_a_classwork_is_still_found_by_id(self):
        # Its detail page, edit form and delete all go through the same queryset by id.
        resp = self.as_(self.student).get(f"{self.list_url}{self.classwork.id}/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["category"], Assignment.CATEGORY_CLASSWORK)


class StudentCrossClassListTests(ClassworkSeparationFixture):
    def test_my_assignments_is_homework_only(self):
        resp = self.as_(self.student).get("/api/classes/my-assignments/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual({row["id"] for row in resp.json()["items"]}, {self.homework.id})


class TeacherHomeworkFiguresTests(ClassworkSeparationFixture):
    def setUp(self):
        super().setUp()
        # The student has handed in the only homework there is.
        Submission.objects.create(
            assignment=self.homework,
            student=self.student,
            status=Submission.STATUS_SUBMITTED,
            submitted_at=timezone.now(),
        )

    def test_the_gradebook_lists_homework_only(self):
        resp = self.as_(self.teacher).get(f"/api/classes/{self.classroom.id}/gradebook/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([row["id"] for row in resp.json()["assignments"]], [self.homework.id])

    def test_leaderboard_homework_completion_is_not_dragged_down_by_classwork(self):
        resp = self.as_(self.teacher).get(f"/api/classes/{self.classroom.id}/leaderboard/")
        self.assertEqual(resp.status_code, 200, resp.content)
        board = resp.json()["homework_grade_leaderboard"]
        self.assertEqual(board["classwork_assignment_count"], 1)  # the legacy key counts homework
        row = next(r for r in board["rows"] if r["user_id"] == self.student.id)
        self.assertEqual(row["homework_completion_rate_pct"], 100.0)

    def test_interventions_count_homework_only(self):
        resp = self.as_(self.teacher).get(f"/api/classes/{self.classroom.id}/interventions/")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual([row["assignment_id"] for row in body["completion_summary"]], [self.homework.id])
        self.assertEqual(body["class_stats"]["assignment_count"], 1)

    def test_the_progress_homework_figure_leaves_classwork_out(self):
        from classes.progress import _homework_for

        figure = _homework_for(self.classroom, self.student)
        self.assertEqual((figure["completed"], figure["total"]), (1, 1))


class PublishingClassworkTests(ClassworkSeparationFixture):
    def _publish(self, assignment):
        return self.as_(self.teacher).post(f"{self.list_url}{assignment.id}/publish/")

    def test_publishing_a_classwork_draft_gives_it_no_deadline(self):
        draft = self._make("Drafted classwork", Assignment.CATEGORY_CLASSWORK, Assignment.STATUS_DRAFT)
        self.assertEqual(self._publish(draft).status_code, 200)
        draft.refresh_from_db()
        self.assertEqual(draft.status, Assignment.STATUS_PUBLISHED)
        self.assertIsNone(draft.due_at)

    def test_publishing_a_homework_draft_still_sets_its_deadline(self):
        # The control: the same classroom CAN compute a deadline, so the classwork's None
        # above is the rule and not a class with no lesson times.
        draft = self._make("Drafted homework", Assignment.CATEGORY_HOMEWORK, Assignment.STATUS_DRAFT)
        self.assertEqual(self._publish(draft).status_code, 200)
        draft.refresh_from_db()
        self.assertIsNotNone(draft.due_at)
