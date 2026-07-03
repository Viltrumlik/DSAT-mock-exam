from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments import async_tasks as assessments_async_tasks
from assessments import grading_service
from assessments import views_attempt as assessments_views_attempt
from assessments.models import AssessmentAttempt, AssessmentQuestion, AssessmentSet, AssessmentResult, HomeworkAssignment
from assessments.async_tasks import grade_attempt_task
from classes.models import Assignment, Classroom, ClassroomMembership


@override_settings(ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=0)
class SubmitGradingOnceTests(TestCase):
    """Submit must not grade inline and again in grade_attempt — single scoring pass."""

    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="t_submit_grade@example.com",
            password="x",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher,
            subject=acc_const.DOMAIN_MATH,
            classroom=None,
            granted_by=self.teacher,
        )
        self.student = User.objects.create_user(
            email="st_submit_grade@example.com",
            password="x",
            role=acc_const.ROLE_STUDENT,
            subject="",
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

        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="algebra",
            title="Algebra set",
            created_by=self.teacher,
            is_active=True,
        )
        AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=1,
            prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=4,
            points=1,
            is_active=True,
        )

        assignment = Assignment.objects.create(classroom=self.classroom, created_by=self.teacher, title="HW", instructions="")
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.classroom,
            assessment_set=self.aset,
            assignment=assignment,
            assigned_by=self.teacher,
        )

        self.client = APIClient()
        self.client.force_authenticate(self.student)

        r0 = self.client.post(
            "/api/assessments/attempts/start/",
            {"assignment_id": self.hw.assignment_id},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.attempt_id = r0.data["id"]
        qid = AssessmentQuestion.objects.get(assessment_set=self.aset).id
        r1 = self.client.post(
            "/api/assessments/attempts/answer/",
            {"attempt_id": self.attempt_id, "question_id": qid, "answer": 4},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)

    @override_settings(
        CELERY_TASK_ALWAYS_EAGER=True,
        CELERY_BROKER_URL="",
    )
    def test_submit_enqueue_path_calls_grade_attempt_once(self):
        real_grade = grading_service.grade_attempt
        with patch.object(assessments_async_tasks, "grade_attempt", wraps=real_grade) as gm:
            with patch.object(grade_attempt_task, "delay", wraps=grade_attempt_task.delay) as dmock:
                with self.captureOnCommitCallbacks(execute=True):
                    r = self.client.post(
                        "/api/assessments/attempts/submit/",
                        {"attempt_id": self.attempt_id},
                        format="json",
                    )
                self.assertEqual(r.status_code, 202)
                self.assertEqual(r.data.get("grading"), "pending")
                self.assertIsNone(r.data.get("result"))
                self.assertEqual(gm.call_count, 1)
                self.assertEqual(dmock.call_count, 1)

            r2 = self.client.post(
                "/api/assessments/attempts/submit/",
                {"attempt_id": self.attempt_id},
                format="json",
            )
            self.assertEqual(r2.status_code, 200)
            self.assertIsNotNone(r2.data.get("result"))
            self.assertEqual(gm.call_count, 1)

    @override_settings(
        CELERY_TASK_ALWAYS_EAGER=False,
        CELERY_BROKER_URL="",
    )
    def test_submit_inline_fallback_calls_grade_attempt_once(self):
        real_grade = grading_service.grade_attempt
        with patch.object(assessments_views_attempt, "grade_attempt", wraps=real_grade) as gm:
            r = self.client.post(
                "/api/assessments/attempts/submit/",
                {"attempt_id": self.attempt_id},
                format="json",
            )
            self.assertEqual(r.status_code, 200)
            self.assertIsNotNone(r.data.get("result"))
            self.assertEqual(gm.call_count, 1)

            r2 = self.client.post(
                "/api/assessments/attempts/submit/",
                {"attempt_id": self.attempt_id},
                format="json",
            )
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(gm.call_count, 1)

    def test_redundant_grade_attempt_after_graded_no_extra_attempt_counter(self):
        with override_settings(CELERY_TASK_ALWAYS_EAGER=False, CELERY_BROKER_URL=""):
            r = self.client.post(
                "/api/assessments/attempts/submit/",
                {"attempt_id": self.attempt_id},
                format="json",
            )
        self.assertEqual(r.status_code, 200)

        attempt = AssessmentAttempt.objects.get(pk=self.attempt_id)
        self.assertEqual(attempt.grading_attempts, 1)
        res1_id = AssessmentResult.objects.get(attempt=attempt).id

        grading_service.grade_attempt(attempt_id=self.attempt_id)
        attempt.refresh_from_db()
        self.assertEqual(attempt.grading_attempts, 1)
        self.assertEqual(AssessmentResult.objects.get(attempt=attempt).id, res1_id)
