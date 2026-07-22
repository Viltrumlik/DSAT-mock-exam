"""
Regression: assessment question IMAGES must be delivered to students on the
attempt-bundle and review paths.

Content (including images) is served LIVE from the AssessmentQuestion rows for the
ids frozen onto the attempt (``question_order``). Before the original fix, image
URLs were dropped from delivery and figures/diagrams were invisible to students.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from assessments.models import AssessmentAttempt, AssessmentQuestion, AssessmentSet, HomeworkAssignment
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class LiveImageDeliveryTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("img_teacher@t.com", "x")
        self.teacher.role = "teacher"
        self.teacher.save(update_fields=["role"])
        self.student = User.objects.create_user("img_student@t.com", "x")

        self.room = Classroom.objects.create(
            name="Imgs", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.room, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.aset = AssessmentSet.objects.create(
            subject="math", title="Imgs", category="Algebra", created_by=self.teacher,
        )
        self.q = AssessmentQuestion.objects.create(
            assessment_set=self.aset, order=0, prompt="See figure.", question_type="multiple_choice",
            choices=[{"id": "A", "text": "1"}, {"id": "B", "text": "2"}], correct_answer="A",
            points=1, is_active=True,
        )
        # Attach image references (names only — no real files needed for URL resolution).
        self.q.question_image.name = "assessments/q1_diagram.png"
        self.q.option_a_image.name = "assessments/q1_opt_a.png"
        self.q.save()

        assignment = Assignment.objects.create(
            classroom=self.room, created_by=self.teacher, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, instructions="do it", max_score=100,
        )
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.room, assessment_set=self.aset, assignment=assignment, assigned_by=self.teacher,
        )

    def _make_attempt(self):
        return AssessmentAttempt.objects.create(
            homework=self.hw,
            student=self.student,
            question_order=[self.q.pk],
            grading_status=AssessmentAttempt.GRADING_PENDING,
            last_activity_at=timezone.now(),
        )

    def test_bundle_delivers_question_and_option_images(self):
        att = self._make_attempt()
        self.client.force_authenticate(self.student)
        res = self.client.get(reverse("assessment-attempt-bundle", args=[att.pk]))
        self.assertEqual(res.status_code, 200)
        q = next(x for x in res.data["questions"] if x["id"] == self.q.pk)
        self.assertTrue(q.get("question_image"), "bundle must deliver question_image")
        self.assertIn("q1_diagram.png", q["question_image"])
        self.assertIn("q1_opt_a.png", q["option_a_image"])
        self.assertIsNone(q["option_b_image"])  # an option with no image stays null

    def test_review_delivers_images(self):
        att = self._make_attempt()
        att.status = AssessmentAttempt.STATUS_SUBMITTED
        att.save(update_fields=["status"])
        self.client.force_authenticate(self.student)
        res = self.client.get(reverse("assessment-attempt-pedagogical-review", args=[att.pk]))
        self.assertEqual(res.status_code, 200)
        q = next(x for x in res.data["questions"] if x["id"] == self.q.pk)
        self.assertIn("q1_diagram.png", q.get("question_image") or "")
