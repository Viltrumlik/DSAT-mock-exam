"""Regression: resuming a *bundled* assessment by assignment_id alone.

An assignment can bundle several assessments (each a HomeworkAssignment). The
``?homework=`` disambiguator that the client normally sends can be lost on resume
(a bookmark, a link that dropped the query, a stale cached page). Historically the
start endpoint then hard-failed with 400 "This homework has multiple assessments —
pass homework_id", even when the student had exactly one attempt in flight — which
is unambiguous.

Prod data (2026-07-25): 15 of 27 in-progress bundle attempts sat on a *non-first*
homework, so the by-assignment result endpoint (which only inspects the first
homework) could not even surface the attempt for the client to name — every one of
those students was stuck on the 400. These tests lock the resolution: with a single
in-progress attempt, start-by-assignment resumes THAT attempt; genuine ambiguity
(none, or two different assessments mid-flight) still asks the client to specify.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments.models import (
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership


@override_settings(
    ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=0,
    CELERY_BROKER_URL="",
    CELERY_TASK_ALWAYS_EAGER=False,
)
class StartBundleResumeByAssignmentTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="t_bundle_resume@example.com",
            password="x",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH, classroom=None, granted_by=self.teacher
        )
        self.student = User.objects.create_user(
            email="st_bundle_resume@example.com", password="x", role=acc_const.ROLE_STUDENT, subject=""
        )

        self.classroom = Classroom.objects.create(
            name="Math class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

        # One assignment that bundles TWO assessments. hw_first is created first, so
        # it is the one the by-assignment endpoint would surface (.order_by("id")).
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="Writing bundle", instructions=""
        )
        self.set_first = self._make_set("FSS Part 1")
        self.set_second = self._make_set("FSS Part 5")
        self.hw_first = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self.set_first,
            assignment=self.assignment, assigned_by=self.teacher,
        )
        self.hw_second = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self.set_second,
            assignment=self.assignment, assigned_by=self.teacher,
        )

        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _make_set(self, title):
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra", title=title,
            created_by=self.teacher, is_active=True,
        )
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=1, prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC, correct_answer=4, points=1, is_active=True,
        )
        return aset

    def _start(self, payload, expect=200):
        r = self.client.post("/api/assessments/attempts/start/", payload, format="json")
        self.assertEqual(r.status_code, expect, r.content)
        return r

    # ── the fix: a single in-progress attempt resolves start-by-assignment ──────
    def test_resumes_in_progress_attempt_on_non_first_homework(self):
        # Student is mid-flight on the SECOND (non-first) assessment of the bundle.
        started = self._start({"homework_id": self.hw_second.id}).data["id"]
        att = AssessmentAttempt.objects.get(pk=started)
        self.assertEqual(att.status, AssessmentAttempt.STATUS_IN_PROGRESS)

        # Resuming with assignment_id alone (the ?homework= param was lost) must
        # resume THAT attempt, not 400 and not silently start the first assessment.
        r = self._start({"assignment_id": self.assignment.id})
        self.assertEqual(r.data["id"], started)
        self.assertEqual(r.data["homework_id"], self.hw_second.id)

    def test_resumes_in_progress_attempt_on_first_homework(self):
        started = self._start({"homework_id": self.hw_first.id}).data["id"]
        r = self._start({"assignment_id": self.assignment.id})
        self.assertEqual(r.data["id"], started)
        self.assertEqual(r.data["homework_id"], self.hw_first.id)

    # ── genuine ambiguity still asks the client to specify ──────────────────────
    def test_no_in_progress_attempt_still_requires_homework_id(self):
        r = self._start({"assignment_id": self.assignment.id}, expect=400)
        self.assertIn("multiple assessments", r.data["detail"])

    def test_two_distinct_in_progress_attempts_still_requires_homework_id(self):
        self._start({"homework_id": self.hw_first.id})
        self._start({"homework_id": self.hw_second.id})
        r = self._start({"assignment_id": self.assignment.id}, expect=400)
        self.assertIn("multiple assessments", r.data["detail"])

    # ── a non-bundle assignment is unaffected (single homework resolves) ────────
    def test_single_assessment_assignment_resolves_by_assignment(self):
        solo = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="Solo", instructions=""
        )
        hw = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self._make_set("Solo set"),
            assignment=solo, assigned_by=self.teacher,
        )
        r = self._start({"assignment_id": solo.id})
        self.assertEqual(r.data["homework_id"], hw.id)
