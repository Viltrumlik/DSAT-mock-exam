"""Attempt content is FROZEN at start: teacher edits made after a student starts
(adding/removing questions) never change that student's in-flight attempt or its
result. Only a fresh attempt (retry) picks up the latest content."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import (
    AssessmentSet, AssessmentQuestion, AssessmentAttempt, HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


class AttemptVersionFreezeTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            "vf_teacher@test.com", "secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.student = User.objects.create_user("vf_student@test.com", "secret123")
        self.set = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="S",
            source=AssessmentSet.SOURCE_MATHBOOK, level="junior", created_by=self.teacher,
        )
        self._add_questions(3)  # start with 3
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
        # No pinned version (set_version=None) → exercises the live/freeze path,
        # which is exactly the state that produced the 27→29 leak.
        self.hw = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self.set, assignment=self.assignment,
            assigned_by=self.teacher,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _add_questions(self, n, start=0):
        base = self.set.questions.count()
        for i in range(n):
            AssessmentQuestion.objects.create(
                assessment_set=self.set, order=base + i, prompt=f"Q{base+i}",
                question_type=AssessmentQuestion.TYPE_SHORT_TEXT, correct_answer="x",
            )

    def _start(self):
        return self.client.post("/api/assessments/attempts/start/", {"homework_id": self.hw.id}, format="json")

    def _submit(self, attempt_id):
        return self.client.post("/api/assessments/attempts/submit/", {"attempt_id": attempt_id}, format="json")

    def test_start_freezes_question_count(self):
        r = self._start()
        self.assertEqual(r.status_code, 200, r.content)
        attempt_id = r.data["id"]
        self.assertEqual(len(r.data["question_order"]), 3)

        # Teacher adds 2 more questions AFTER the student started.
        self._add_questions(2)
        self.assertEqual(self.set.questions.count(), 5)

        # Re-fetching / resuming must NOT grow the attempt — still 3.
        r2 = self._start()
        self.assertEqual(len(r2.data["question_order"]), 3)
        self.assertEqual(r2.data["id"], attempt_id)

    def test_submit_ignores_added_questions_no_409(self):
        attempt_id = self._start().data["id"]
        self._add_questions(2)  # now 5 live
        r = self._submit(attempt_id)
        self.assertIn(r.status_code, (200, 202), r.content)  # NOT 409
        att = AssessmentAttempt.objects.get(pk=attempt_id)
        res = getattr(att, "result", None)
        # Graded on the frozen 3, not the live 5.
        self.assertIsNotNone(res)
        self.assertEqual(res.total_questions, 3)

    def test_submit_not_blocked_when_question_removed(self):
        attempt_id = self._start().data["id"]
        # Teacher deactivates one of the frozen questions mid-attempt.
        q = self.set.questions.order_by("order").first()
        q.is_active = False
        q.save(update_fields=["is_active"])
        r = self._submit(attempt_id)
        self.assertIn(r.status_code, (200, 202), r.content)  # no "restart" 409

    def test_backfill_repairs_unfrozen_attempt(self):
        # Simulate a legacy attempt that was never frozen: empty question_order.
        att = AssessmentAttempt.objects.create(
            homework=self.hw, student=self.student, question_order=[],
        )
        r = self._start()  # reuse → should backfill the freeze
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["id"], att.id)
        self.assertEqual(len(r.data["question_order"]), 3)

    def test_retry_picks_up_new_questions(self):
        first = self._start().data["id"]
        self._submit(first)
        self._add_questions(2)  # now 5 live
        # A fresh attempt (retry) is created and freezes the LATEST content.
        r = self._start()
        self.assertNotEqual(r.data["id"], first)
        self.assertEqual(len(r.data["question_order"]), 5)

    def test_bundle_delivers_live_edited_content(self):
        # Like pastpaper: a builder edit shows up in the runner immediately (no
        # version snapshot). Start, then edit a question's prompt live.
        attempt_id = self._start().data["id"]
        q = self.set.questions.order_by("order").first()
        q.prompt = "EDITED LIVE PROMPT"
        q.save(update_fields=["prompt"])
        r = self.client.get(f"/api/assessments/attempts/{attempt_id}/bundle/")
        self.assertEqual(r.status_code, 200, r.content)
        prompts = [x["prompt"] for x in r.data["questions"]]
        self.assertIn("EDITED LIVE PROMPT", prompts)

    def test_review_shows_live_edited_content(self):
        attempt_id = self._start().data["id"]
        self._submit(attempt_id)
        q = self.set.questions.order_by("order").first()
        q.prompt = "EDITED AFTER SUBMIT"
        q.explanation = "New explanation"
        q.save(update_fields=["prompt", "explanation"])
        r = self.client.get(f"/api/assessments/attempts/{attempt_id}/review/")
        self.assertEqual(r.status_code, 200, r.content)
        prompts = [x["prompt"] for x in r.data["questions"]]
        self.assertIn("EDITED AFTER SUBMIT", prompts)
