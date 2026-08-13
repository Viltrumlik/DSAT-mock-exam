"""A DRAFT or ARCHIVED assignment cannot be turned into an attempt.

``StartAttemptView`` resolved the homework by pk and then checked one thing: that
the caller is a STUDENT of that homework's classroom. It never consulted the
parent assignment's lifecycle status, so any student of the class could start
work the teacher had not published yet — or had already archived — and the
dashboard (``/api/classes/my-assignments/``) was handing out the ids to do it
with. Membership is not authorization on its own.

Work already in flight stays resumable, so archiving a homework mid-session never
strands a student's answers.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import (
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership

START_URL = "/api/assessments/attempts/start/"


@override_settings(
    ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=0,
    CELERY_BROKER_URL="",
    CELERY_TASK_ALWAYS_EAGER=False,
)
class StartRequiresPublishedAssignmentTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="t_draft_gate@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.student = User.objects.create_user(
            email="st_draft_gate@example.com", password="x",
            role=acc_const.ROLE_STUDENT, subject="",
        )
        self.classroom = Classroom.objects.create(
            name="Math class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _homework(self, status):
        assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher,
            title=f"{status} work", instructions="", status=status,
        )
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra",
            title=f"Set for {status}", created_by=self.teacher, is_active=True,
        )
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=1, prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC, correct_answer=4,
            points=1, is_active=True,
        )
        return assignment, HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=assignment, assigned_by=self.teacher,
        )

    def _start(self, hw, expect):
        r = self.client.post(START_URL, {"homework_id": hw.id}, format="json")
        self.assertEqual(r.status_code, expect, r.content)
        return r

    def test_draft_homework_cannot_be_started(self):
        _assignment, hw = self._homework(Assignment.STATUS_DRAFT)
        self._start(hw, 403)
        self.assertFalse(AssessmentAttempt.objects.filter(homework=hw).exists())

    def test_archived_homework_cannot_be_started(self):
        _assignment, hw = self._homework(Assignment.STATUS_ARCHIVED)
        self._start(hw, 403)
        self.assertFalse(AssessmentAttempt.objects.filter(homework=hw).exists())

    def test_published_homework_can_be_started(self):
        # Control: the gate must not break the normal path.
        _assignment, hw = self._homework(Assignment.STATUS_PUBLISHED)
        r = self._start(hw, 200)
        self.assertEqual(r.data["status"], AssessmentAttempt.STATUS_IN_PROGRESS)

    def test_publishing_a_draft_makes_it_startable(self):
        assignment, hw = self._homework(Assignment.STATUS_DRAFT)
        self._start(hw, 403)

        assignment.status = Assignment.STATUS_PUBLISHED
        assignment.save(update_fields=["status"])
        self._start(hw, 200)

    def test_archiving_mid_session_does_not_strand_an_attempt_in_flight(self):
        assignment, hw = self._homework(Assignment.STATUS_PUBLISHED)
        started = self._start(hw, 200).data["id"]

        assignment.status = Assignment.STATUS_ARCHIVED
        assignment.save(update_fields=["status"])

        # The student keeps the attempt they were already working on...
        self.assertEqual(self._start(hw, 200).data["id"], started)

        # ...but once it is finished, archived work cannot be picked up again.
        AssessmentAttempt.objects.filter(pk=started).update(
            status=AssessmentAttempt.STATUS_SUBMITTED
        )
        self._start(hw, 403)
