"""Question-level delete: plain delete, the 409 guard when answers exist, and
the ?force=true escape hatch that removes the question + its answer rows while
leaving frozen snapshots and stored scores untouched."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import (
    AssessmentSet, AssessmentQuestion,
    HomeworkAssignment, AssessmentAttempt, AssessmentAnswer, AssessmentResult,
)
from classes.models import Assignment, Classroom

User = get_user_model()


class QuestionDeleteTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            "qdel_admin@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.set = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="S",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.admin,
        )
        self.q = [
            AssessmentQuestion.objects.create(
                assessment_set=self.set, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_SHORT_TEXT, correct_answer="x",
            )
            for i in range(3)
        ]

    def _del(self, qid, force=False):
        url = f"/api/assessments/admin/questions/{qid}/"
        if force:
            url += "?force=true"
        return self.client.delete(url)

    def _orders(self):
        return sorted(
            AssessmentQuestion.objects.filter(assessment_set=self.set).values_list("order", flat=True)
        )

    def test_delete_plain_question_204_and_compacts_order(self):
        resp = self._del(self.q[1].id)
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertFalse(AssessmentQuestion.objects.filter(pk=self.q[1].id).exists())
        # Remaining two questions are re-densified to 0,1 (no gap).
        self.assertEqual(self._orders(), [0, 1])

    def _attach_answer(self, question):
        classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        assignment = Assignment.objects.create(
            classroom=classroom, created_by=self.admin, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        hw = HomeworkAssignment.objects.create(
            classroom=classroom, assessment_set=self.set, assignment=assignment,
            assigned_by=self.admin,
        )
        student = User.objects.create_user("qdel_stu@test.com", "secret123")
        attempt = AssessmentAttempt.objects.create(homework=hw, student=student)
        AssessmentAnswer.objects.create(attempt=attempt, question=question, answer="B")
        result = AssessmentResult.objects.create(
            attempt=attempt, score_points=3, max_points=3, percent=100,
            correct_count=3, total_questions=3,
        )
        return attempt, result

    def test_delete_answered_question_blocked_409(self):
        self._attach_answer(self.q[0])
        resp = self._del(self.q[0].id)
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertTrue(AssessmentQuestion.objects.filter(pk=self.q[0].id).exists())

    def test_force_delete_answered_question_removes_it_keeps_scores(self):
        attempt, result = self._attach_answer(self.q[0])
        resp = self._del(self.q[0].id, force=True)
        self.assertEqual(resp.status_code, 204, resp.content)
        # Question + its answer rows are gone…
        self.assertFalse(AssessmentQuestion.objects.filter(pk=self.q[0].id).exists())
        self.assertFalse(AssessmentAnswer.objects.filter(question_id=self.q[0].id).exists())
        # …but the attempt and its stored aggregate score are untouched.
        self.assertTrue(AssessmentAttempt.objects.filter(pk=attempt.id).exists())
        result.refresh_from_db()
        self.assertEqual(result.correct_count, 3)
        self.assertEqual(float(result.score_points), 3.0)
        # Remaining questions densified.
        self.assertEqual(self._orders(), [0, 1])
