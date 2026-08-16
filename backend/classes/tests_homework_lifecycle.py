"""Assignment lifecycle tests — DRAFT/PUBLISHED/ARCHIVED (homework rebuild).

Validates student visibility, lifecycle endpoints + permissions, and ranking semantics
(archived keeps earned grades but leaves the completion denominator).
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership, Submission, SubmissionReview
from classes.models_ranking import RankingSnapshot
from classes.ranking import service

User = get_user_model()


def _u(e):
    return User.objects.create_user(e, "secret123")


class HomeworkLifecycleFixture(TestCase):
    def setUp(self):
        self.owner = _u("hw_owner@t.com")
        self.classroom = Classroom.objects.create(
            name="HW", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.owner
        )
        ClassroomMembership.objects.create(classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN)
        self.student = _u("hw_student@t.com")
        ClassroomMembership.objects.create(classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        self.client = APIClient()

    def _mk(self, title, status):
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title=title,
            category=Assignment.CATEGORY_HOMEWORK, max_score=100, status=status,
        )

    def _list_url(self):
        return f"/api/classes/{self.classroom.id}/assignments/"

    def _ids(self, resp):
        data = resp.json()
        rows = data["items"] if isinstance(data, dict) else data
        return {r["id"] for r in rows}


class VisibilityTests(HomeworkLifecycleFixture):
    def test_student_sees_only_published(self):
        self._mk("Draft one", Assignment.STATUS_DRAFT)
        pub = self._mk("Published one", Assignment.STATUS_PUBLISHED)
        self._mk("Archived one", Assignment.STATUS_ARCHIVED)
        self.client.force_authenticate(self.student)
        self.assertEqual(self._ids(self.client.get(self._list_url())), {pub.id})

    def test_staff_sees_published_and_draft_not_archived(self):
        draft = self._mk("Draft one", Assignment.STATUS_DRAFT)
        pub = self._mk("Published one", Assignment.STATUS_PUBLISHED)
        arch = self._mk("Archived one", Assignment.STATUS_ARCHIVED)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self._ids(self.client.get(self._list_url())), {draft.id, pub.id})
        # include_archived shows everything
        self.assertEqual(self._ids(self.client.get(self._list_url() + "?include_archived=1")), {draft.id, pub.id, arch.id})


class LifecycleEndpointTests(HomeworkLifecycleFixture):
    def _act(self, a, verb):
        return self.client.post(f"/api/classes/{self.classroom.id}/assignments/{a.id}/{verb}/")

    def test_student_cannot_change_lifecycle(self):
        a = self._mk("A", Assignment.STATUS_PUBLISHED)
        self.client.force_authenticate(self.student)
        self.assertEqual(self._act(a, "archive").status_code, 403)

    def test_publish_archive_unarchive(self):
        a = self._mk("A", Assignment.STATUS_DRAFT)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self._act(a, "publish").json()["status"], "PUBLISHED")
        a.refresh_from_db(); self.assertEqual(a.status, "PUBLISHED"); self.assertIsNotNone(a.published_at)
        self.assertEqual(self._act(a, "archive").json()["status"], "ARCHIVED")
        a.refresh_from_db(); self.assertEqual(a.status, "ARCHIVED")
        # unarchive must reach an archived row (hidden from the default queryset)
        self.assertEqual(self._act(a, "unarchive").json()["status"], "PUBLISHED")
        a.refresh_from_db(); self.assertEqual(a.status, "PUBLISHED")


class AGradeDoesNotMoveTheLeaderboardTests(HomeworkLifecycleFixture):
    """A teacher's mark is no longer a leaderboard input at all.

    This class used to assert the opposite — that `SubmissionReview.grade` was added to the
    board in the same currency as an assessment's `score_points`, and that unmarked work
    contributed nothing rather than a zero so a student was never punished for their
    teacher's backlog.

    The rewards cutover retired that whole path (`ranking/rules._hand_graded_points` is gone).
    Homework earns through the reward ledger, scored **per bundle** in `rewards/homework.py`,
    and a hand-in counts as done at **submitted** — not at graded. So the backlog guarantee is
    not merely preserved, it is stronger: marking cannot move a student's points in either
    direction, and the tests that hold it live in `rewards/tests_homework.py`, next to the
    code that decides them.

    What is worth keeping here is the negative: a raw grade must not leak onto the board.
    """

    def test_a_hand_graded_mark_is_not_added_to_the_board(self):
        published = self._mk("Pub HW", Assignment.STATUS_PUBLISHED)
        sub = Submission.objects.create(
            assignment=published, student=self.student, status=Submission.STATUS_REVIEWED,
            submitted_at=timezone.now() - timedelta(days=1),
        )
        SubmissionReview.objects.create(submission=sub, teacher=self.owner, grade=80)

        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snap = RankingSnapshot.objects.get(
            classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student)
        # 80 was the old currency. The board reads awards, and grading writes none.
        self.assertEqual(float(snap.score), 0.0)
        self.assertEqual(snap.components["source"], "rewards")

    def test_marking_work_later_does_not_change_the_board(self):
        # The backlog property, restated for the ledger: whether the teacher has got to it
        # cannot be the difference between two students' standings.
        a = self._mk("Marked", Assignment.STATUS_PUBLISHED)
        b = self._mk("Waiting on the teacher", Assignment.STATUS_PUBLISHED)
        for assignment in (a, b):
            Submission.objects.create(
                assignment=assignment, student=self.student, status=Submission.STATUS_REVIEWED,
                submitted_at=timezone.now() - timedelta(days=1),
            )
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        before = float(RankingSnapshot.objects.get(
            classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student).score)

        SubmissionReview.objects.create(
            submission=Submission.objects.filter(assignment=a).get(), teacher=self.owner, grade=70)
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        after = float(RankingSnapshot.objects.get(
            classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student).score)

        self.assertEqual(before, after)

    def test_every_student_still_appears_on_a_board_with_nothing_graded(self):
        # A roster view with nobody on it is indistinguishable from a broken board.
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        self.assertTrue(
            RankingSnapshot.objects.filter(
                classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student
            ).exists()
        )


class DashboardVisibilityTests(HomeworkLifecycleFixture):
    """``/api/classes/my-assignments/`` is the cross-classroom sibling of the list
    above — it feeds the student dashboard, /assessments, analytics and the iOS app.

    It used to skip the status filter entirely. That leaked harder than a normal
    visibility bug: its payload carries no ``status`` field, so no client could
    filter drafts back out, and an assessment reachable from it is also startable.
    """

    def _dash_ids(self):
        return {r["id"] for r in self.client.get("/api/classes/my-assignments/").json()["items"]}

    def test_student_dashboard_shows_only_published(self):
        self._mk("Draft one", Assignment.STATUS_DRAFT)
        pub = self._mk("Published one", Assignment.STATUS_PUBLISHED)
        self._mk("Archived one", Assignment.STATUS_ARCHIVED)
        self.client.force_authenticate(self.student)
        self.assertEqual(self._dash_ids(), {pub.id})

    def test_dashboard_agrees_with_the_per_classroom_list(self):
        # The two endpoints disagreeing is precisely what let drafts through.
        self._mk("Draft one", Assignment.STATUS_DRAFT)
        self._mk("Published one", Assignment.STATUS_PUBLISHED)
        self._mk("Archived one", Assignment.STATUS_ARCHIVED)
        self.client.force_authenticate(self.student)
        self.assertEqual(self._dash_ids(), self._ids(self.client.get(self._list_url())))

    def test_publishing_a_draft_puts_it_on_the_dashboard(self):
        draft = self._mk("Later", Assignment.STATUS_DRAFT)
        self.client.force_authenticate(self.student)
        self.assertEqual(self._dash_ids(), set())

        draft.status = Assignment.STATUS_PUBLISHED
        draft.save(update_fields=["status"])
        self.assertEqual(self._dash_ids(), {draft.id})
