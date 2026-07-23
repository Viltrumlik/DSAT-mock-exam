"""Inactivity reaper vs paused attempts + resurrecting a reaped attempt.

Pause is a legitimate resumable state (save-and-exit, auto-pause on tab-leave):
the save path explicitly promises "pause overnight and resume the next day".
The reaper therefore must NOT reap a paused attempt on the short inactivity
window — that promise broke on prod (a student paused >1h, the reaper abandoned
the attempt, and on return every answer save 400'd "locked (abandoned)" while
the runner silently dropped the picks → answered questions graded Omitted).

And when an attempt IS reaped, resume() must be able to bring it back: nothing
was submitted, the answer rows are intact, and losing the work is strictly
worse than continuing it.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import (
    AssessmentSet, AssessmentQuestion,
    HomeworkAssignment, AssessmentAttempt, AssessmentAttemptAuditEvent,
)
from assessments.tasks import abandon_inactive_attempts
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class ReaperAndResurrectTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            "rr_teacher@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.student = User.objects.create_user("rr_student@test.com", "secret123")
        self.set = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="S",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.teacher,
        )
        for i in range(3):
            AssessmentQuestion.objects.create(
                assessment_set=self.set, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_SHORT_TEXT, correct_answer="x",
            )
        self.classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT,
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self.set, assignment=self.assignment,
            assigned_by=self.teacher,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _mk_attempt(self, **over):
        return AssessmentAttempt.objects.create(
            homework=self.hw, student=self.student,
            question_order=[q.id for q in self.set.questions.all()],
            **over,
        )

    # ── reaper ────────────────────────────────────────────────────────────────
    def test_reaper_skips_paused_attempt_on_short_window(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(hours=3),
            last_activity_at=now - timedelta(hours=2, minutes=30),
            paused_at=now - timedelta(hours=2),  # save-and-exit 2h ago
        )
        out = abandon_inactive_attempts()
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_IN_PROGRESS, out)

    def test_reaper_still_reaps_unpaused_inactive_attempt(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(hours=3),
            last_activity_at=now - timedelta(hours=2),
            paused_at=None,
        )
        abandon_inactive_attempts()
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_ABANDONED)

    @override_settings(ASSESSMENT_ATTEMPT_PAUSED_INACTIVITY_TIMEOUT_SECONDS=72 * 3600)
    def test_reaper_reaps_paused_attempt_beyond_long_window(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(hours=90),
            last_activity_at=now - timedelta(hours=85),
            paused_at=now - timedelta(hours=80),  # over the 72h paused leash
        )
        abandon_inactive_attempts()
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_ABANDONED)
        ev = AssessmentAttemptAuditEvent.objects.filter(
            attempt=att, event_type=AssessmentAttemptAuditEvent.EVENT_TIMEOUT_ABANDONED
        ).last()
        self.assertIsNotNone(ev)
        self.assertTrue(ev.payload.get("paused"))

    # ── resurrect via resume ──────────────────────────────────────────────────
    def test_resume_resurrects_reaped_attempt_and_saving_works_again(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(hours=3),
            last_activity_at=now - timedelta(hours=2),
            status=AssessmentAttempt.STATUS_ABANDONED,
            abandoned_at=now - timedelta(hours=1),
        )
        r = self.client.post("/api/assessments/attempts/resume/", {"attempt_id": att.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["status"], AssessmentAttempt.STATUS_IN_PROGRESS)
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_IN_PROGRESS)
        self.assertIsNone(att.abandoned_at)
        # The dead gap is banked as pause, not billed as active/elapsed time.
        self.assertGreaterEqual(att.paused_seconds, int(timedelta(hours=1).total_seconds()) - 5)

        q = self.set.questions.first()
        r2 = self.client.post(
            "/api/assessments/attempts/answer/",
            {"attempt_id": att.id, "question_id": q.id, "answer": "x"},
            format="json",
        )
        self.assertEqual(r2.status_code, 200, r2.content)

    def test_resume_never_resurrects_a_submitted_attempt(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(hours=2),
            status=AssessmentAttempt.STATUS_SUBMITTED,
            submitted_at=now - timedelta(hours=1),
        )
        r = self.client.post("/api/assessments/attempts/resume/", {"attempt_id": att.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["status"], AssessmentAttempt.STATUS_SUBMITTED)
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_SUBMITTED)

    @override_settings(ASSESSMENT_ATTEMPT_RESURRECT_WINDOW_SECONDS=48 * 3600)
    def test_resume_does_not_resurrect_beyond_window(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(days=4),
            status=AssessmentAttempt.STATUS_ABANDONED,
            abandoned_at=now - timedelta(days=3),  # beyond the 48h window
        )
        r = self.client.post("/api/assessments/attempts/resume/", {"attempt_id": att.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["status"], AssessmentAttempt.STATUS_ABANDONED)
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_ABANDONED)
