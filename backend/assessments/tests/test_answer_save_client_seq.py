from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from access import constants as acc_const
from assessments.models import AssessmentQuestion, AssessmentSet, HomeworkAssignment
from classes.models import Assignment, Classroom, ClassroomMembership


@override_settings(ASSESSMENT_MAX_ATTEMPT_LIFETIME_SECONDS=0)
class AssessmentAnswerClientSeqTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.teacher = User.objects.create_user(
            email="tmath_seq@example.com",
            password="x",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        self.student = User.objects.create_user(email="st_seq@example.com", password="x", role=acc_const.ROLE_STUDENT)

        self.classroom = Classroom.objects.create(
            name="Math class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN)
        ClassroomMembership.objects.create(classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT)

        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="algebra",
            title="Algebra set",
            created_by=self.teacher,
            is_active=True,
        )
        q = AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=1,
            prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC,
            correct_answer=4,
            points=1,
            is_active=True,
        )
        self.qid = q.id

        assignment = Assignment.objects.create(classroom=self.classroom, created_by=self.teacher, title="HW", instructions="")
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.classroom,
            assessment_set=self.aset,
            assignment=assignment,
            assigned_by=self.teacher,
        )

    def test_stale_client_seq_is_rejected(self):
        self.client.force_authenticate(self.student)
        # Start attempt
        r0 = self.client.post("/api/assessments/attempts/start/", {"assignment_id": self.hw.assignment_id}, format="json")
        self.assertEqual(r0.status_code, 200)
        attempt_id = r0.data["id"]

        # Save seq=2
        r1 = self.client.post(
            "/api/assessments/attempts/answer/",
            {"attempt_id": attempt_id, "question_id": self.qid, "answer": 5, "client_seq": 2},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)

        # Save seq=1 (stale) must 409
        r2 = self.client.post(
            "/api/assessments/attempts/answer/",
            {"attempt_id": attempt_id, "question_id": self.qid, "answer": 4, "client_seq": 1},
            format="json",
        )
        self.assertEqual(r2.status_code, 409)
        self.assertEqual(r2.data.get("code"), "stale_write")

