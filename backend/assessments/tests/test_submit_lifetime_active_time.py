"""Regression: the submit lifetime gate measures ACTIVE (elapsed) time, not wall-clock.

Assessments are untimed (count-up). The max-lifetime gate must exclude paused
windows so a student who saves-and-exits overnight can come back and submit. The
save-answer gate and the resurrect gate already use ``elapsed_seconds``; the submit
gate previously used raw ``now - started_at``, so a student who paused overnight
could resume and answer but got 410 "Attempt expired" on the final submit — losing
the ability to hand in finished work.

Prod (2026-07-25): 17 in-progress attempts had wall-clock age > 6h but active time
<= 6h (e.g. 48 min worked, 15h paused) — every one blocked from submitting.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership

SIX_HOURS = 6 * 60 * 60


@override_settings(
    ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=SIX_HOURS,
    CELERY_BROKER_URL="",
    CELERY_TASK_ALWAYS_EAGER=False,
)
class SubmitLifetimeActiveTimeTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="t_life@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH, classroom=None, granted_by=self.teacher
        )
        self.student = User.objects.create_user(
            email="st_life@example.com", password="x", role=acc_const.ROLE_STUDENT, subject=""
        )
        self.classroom = Classroom.objects.create(
            name="Math class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra", title="Algebra",
            created_by=self.teacher, is_active=True,
        )
        self.q1 = AssessmentQuestion.objects.create(
            assessment_set=self.aset, order=1, prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC, correct_answer=4, points=1, is_active=True,
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="HW", instructions=""
        )
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self.aset,
            assignment=self.assignment, assigned_by=self.teacher,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _make_attempt(self, started_ago_seconds, paused_seconds):
        att = AssessmentAttempt.objects.create(
            homework=self.hw, student=self.student,
            grading_status=AssessmentAttempt.GRADING_PENDING,
            question_order=[self.q1.id],
            paused_seconds=paused_seconds,
            last_activity_at=timezone.now(),
        )
        # Backdate started_at (create() sets it to now via auto_now_add-like default).
        AssessmentAttempt.objects.filter(pk=att.pk).update(
            started_at=timezone.now() - timedelta(seconds=started_ago_seconds)
        )
        AssessmentAnswer.objects.create(attempt=att, question=self.q1, answer="4")
        return AssessmentAttempt.objects.get(pk=att.pk)

    def _submit(self, attempt_id):
        return self.client.post(
            "/api/assessments/attempts/submit/", {"attempt_id": attempt_id}, format="json"
        )

    def test_paused_overnight_can_still_submit(self):
        # Started 8h ago (wall-clock > 6h) but 7h of that was paused → active = ~1h.
        att = self._make_attempt(started_ago_seconds=8 * 3600, paused_seconds=7 * 3600)
        self.assertLessEqual(att.elapsed_seconds(), SIX_HOURS)  # active time is fine
        r = self._submit(att.id)
        self.assertIn(r.status_code, (200, 202), r.content)  # NOT 410

    def test_active_time_over_cap_still_expires(self):
        # 8h of genuine active time, no pause → legitimately over the 6h cap.
        att = self._make_attempt(started_ago_seconds=8 * 3600, paused_seconds=0)
        self.assertGreater(att.elapsed_seconds(), SIX_HOURS)
        r = self._submit(att.id)
        self.assertEqual(r.status_code, 410, r.content)
        self.assertIn("expired", r.data["detail"].lower())

    def test_fresh_attempt_submits(self):
        att = self._make_attempt(started_ago_seconds=600, paused_seconds=0)
        r = self._submit(att.id)
        self.assertIn(r.status_code, (200, 202), r.content)
