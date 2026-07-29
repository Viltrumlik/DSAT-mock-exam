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


class HandGradedWorkOnTheLeaderboardTests(HomeworkLifecycleFixture):
    """Academic counts assessment points AND work the teacher graded by hand.

    The rule that matters is what happens to work that is handed in but NOT yet marked: it
    contributes nothing at all, rather than a zero. A leaderboard that scored unmarked work
    as 0 would punish students for their teacher's backlog and would reshuffle every rank the
    moment marking started.
    """

    def setUp(self):
        super().setUp()
        # The academic window opens when the CLASS does, and the base fixture builds its
        # classroom "now" — so backdated submissions would fall outside it. Open the class a
        # month ago, which is what a real one that has homework in it looks like.
        self.classroom.created_at = timezone.now() - timedelta(days=30)
        self.classroom.save(update_fields=["created_at"])

    def test_hand_graded_homework_counts_toward_the_score(self):
        published = self._mk("Pub HW", Assignment.STATUS_PUBLISHED)
        archived = self._mk("Old HW", Assignment.STATUS_ARCHIVED)
        for a, grade in ((published, 80), (archived, 100)):
            sub = Submission.objects.create(assignment=a, student=self.student, status=Submission.STATUS_REVIEWED,
                                            submitted_at=timezone.now() - timedelta(days=1))
            SubmissionReview.objects.create(submission=sub, teacher=self.owner, grade=grade)

        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snap = RankingSnapshot.objects.get(classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student)
        # Archived work keeps the points it earned — retiring an assignment does not
        # retroactively take a student's marks away.
        self.assertEqual(float(snap.score), 180.0)
        self.assertEqual(snap.components["graded_count"], 2)

    def test_submitted_but_unmarked_work_contributes_nothing(self):
        marked = self._mk("Marked", Assignment.STATUS_PUBLISHED)
        unmarked = self._mk("Waiting on the teacher", Assignment.STATUS_PUBLISHED)
        sub = Submission.objects.create(assignment=marked, student=self.student, status=Submission.STATUS_REVIEWED,
                                        submitted_at=timezone.now() - timedelta(days=1))
        SubmissionReview.objects.create(submission=sub, teacher=self.owner, grade=70)
        Submission.objects.create(assignment=unmarked, student=self.student, status=Submission.STATUS_REVIEWED,
                                  submitted_at=timezone.now() - timedelta(days=1))

        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snap = RankingSnapshot.objects.get(classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student)
        self.assertEqual(float(snap.score), 70.0)          # not 70 halved, not 35 — just 70
        self.assertEqual(snap.components["graded_count"], 1)

    def test_every_student_still_appears_on_a_board_with_nothing_graded(self):
        # A roster view with nobody on it is indistinguishable from a broken board.
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        self.assertTrue(
            RankingSnapshot.objects.filter(
                classroom=self.classroom, kind="ACADEMIC", period_key="p1", student=self.student
            ).exists()
        )
