"""Save-and-exit / pause-resume for assessment attempts: pause freezes the
elapsed time-on-task counter, resume banks the window and continues without a
jump, the last-viewed question index round-trips, a long pause doesn't trip the
max-lifetime gate, and submit excludes paused time from total_time_seconds."""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import (
    AssessmentSet, AssessmentQuestion, AssessmentSetVersion,
    HomeworkAssignment, AssessmentAttempt,
)
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class AttemptPauseResumeTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            "pr_teacher@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.student = User.objects.create_user("pr_student@test.com", "secret123")
        self.set = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="S",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.teacher,
        )
        for i in range(3):
            AssessmentQuestion.objects.create(
                assessment_set=self.set, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_SHORT_TEXT, correct_answer="x",
            )
        self.version = AssessmentSetVersion.objects.create(
            assessment_set=self.set, version_number=1,
            snapshot_json={"schema_version": 1}, snapshot_checksum="a" * 64,
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
            assigned_by=self.teacher, set_version=self.version,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _mk_attempt(self, **over):
        return AssessmentAttempt.objects.create(
            homework=self.hw, student=self.student, set_version=self.version,
            question_order=[q.id for q in self.set.questions.all()],
            **over,
        )

    # ── pause / resume endpoints ───────────────────────────────────────────────
    def test_pause_then_resume_roundtrip(self):
        att = self._mk_attempt()
        r = self.client.post("/api/assessments/attempts/pause/", {"attempt_id": att.id, "current_index": 2}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data["is_paused"])
        self.assertEqual(r.data["current_question_index"], 2)
        att.refresh_from_db()
        self.assertIsNotNone(att.paused_at)

        r2 = self.client.post("/api/assessments/attempts/resume/", {"attempt_id": att.id}, format="json")
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertFalse(r2.data["is_paused"])
        att.refresh_from_db()
        self.assertIsNone(att.paused_at)
        # Cursor survives resume so the runner reopens on question 3.
        self.assertEqual(att.current_question_index, 2)

    def test_pause_is_idempotent_keeps_original_pause_start(self):
        att = self._mk_attempt()
        self.client.post("/api/assessments/attempts/pause/", {"attempt_id": att.id}, format="json")
        att.refresh_from_db()
        first = att.paused_at
        self.client.post("/api/assessments/attempts/pause/", {"attempt_id": att.id}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.paused_at, first)

    # ── elapsed accounting (model math) ────────────────────────────────────────
    def test_elapsed_freezes_while_paused(self):
        now = timezone.now()
        att = self._mk_attempt(started_at=now - timedelta(seconds=100), paused_at=now - timedelta(seconds=40))
        # 100s since start, but paused 40s ago → ~60s of active elapsed, frozen there.
        self.assertAlmostEqual(att.elapsed_seconds(now), 60, delta=2)
        # 30 more wall seconds pass while still paused → elapsed unchanged.
        self.assertAlmostEqual(att.elapsed_seconds(now + timedelta(seconds=30)), 60, delta=2)

    def test_resume_continues_without_jump(self):
        now = timezone.now()
        att = self._mk_attempt(started_at=now - timedelta(seconds=100), paused_at=now - timedelta(seconds=40))
        before = att.elapsed_seconds(now)
        r = self.client.post("/api/assessments/attempts/resume/", {"attempt_id": att.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        # ~40s were banked; elapsed right after resume equals elapsed just before.
        self.assertAlmostEqual(att.paused_seconds, 40, delta=2)
        self.assertAlmostEqual(att.elapsed_seconds(), before, delta=2)

    # ── lifetime gate excludes paused time ─────────────────────────────────────
    @override_settings(ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=3600)
    def test_long_pause_not_expired_on_save(self):
        now = timezone.now()
        # Wall span 5h but 4.5h of it was paused → ~30m active < 1h gate.
        att = self._mk_attempt(
            started_at=now - timedelta(hours=5),
            paused_seconds=int(timedelta(hours=4, minutes=30).total_seconds()),
        )
        q = self.set.questions.first()
        r = self.client.post(
            "/api/assessments/attempts/answer/",
            {"attempt_id": att.id, "question_id": q.id, "answer": "x", "current_index": 1},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)  # not 410 expired
        att.refresh_from_db()
        self.assertEqual(att.status, AssessmentAttempt.STATUS_IN_PROGRESS)
        self.assertEqual(att.current_question_index, 1)

    # ── submit excludes paused time ────────────────────────────────────────────
    def test_submit_total_time_excludes_pause(self):
        now = timezone.now()
        att = self._mk_attempt(
            started_at=now - timedelta(seconds=600),
            paused_seconds=400,
        )
        r = self.client.post("/api/assessments/attempts/submit/", {"attempt_id": att.id}, format="json")
        self.assertIn(r.status_code, (200, 202), r.content)
        att.refresh_from_db()
        # 600s wall - 400s paused ≈ 200s of real work.
        self.assertLessEqual(att.total_time_seconds, 260)
        self.assertGreaterEqual(att.total_time_seconds, 150)
