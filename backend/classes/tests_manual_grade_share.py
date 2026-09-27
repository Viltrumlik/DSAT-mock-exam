"""The manual share of a homework grade: one number, composed in one place.

A homework holding four assessments and two word sets is a bundle, and a bundle has never
been finalized into a single grade — each part scores in its own engine and the classroom
assignment is left to a human. ``Assignment.manual_grade_weight_percent`` is the teacher's
answer to "how much of this grade do I award by hand", asked once, on the create form, and
``classes.grade_composition`` is the only place the two sides are added together.

What is under test here is the arithmetic and the states around it, not the engines:

* the default (NULL) composes nothing, so no homework that already exists changes;
* the learning center's own example — four assessments, a 20% manual share — composes the
  number the owner described;
* while the mark is missing, the composed grade reports the automatic part AND says it is
  not final, so the student can be shown a real number and "your teacher is still
  checking" rather than a blank or a grade that is quietly a fifth short of the truth;
* 0% and 100% are both legal and mean different things;
* a share outside 0-100 is refused at the API, not clamped into something plausible.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.grade_composition import (
    STATE_AWAITING_MANUAL,
    STATE_FINAL,
    STATE_NO_MANUAL_COMPONENT,
    compose_assignment_grade,
)
from classes.models import (
    Assignment,
    Classroom,
    ClassroomMembership,
    Submission,
    SubmissionReview,
)

User = get_user_model()


class ManualShareFixture(TestCase):
    """One classroom, one student, and a homework that bundles four assessments.

    Four, because that is the size the owner used when they described the split, and
    because a bundle is exactly the case nothing composed before.
    """

    def setUp(self):
        self.teacher = User.objects.create_user("ms_teacher@t.com", "secret123")
        self.student = User.objects.create_user("ms_student@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="MS",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="10:00",
            created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.teacher,
            title="Week 1",
            category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED,
        )
        self.homeworks = [self._attach_assessment(f"Set {i}") for i in range(4)]

    # ---- fixture helpers ------------------------------------------------

    def _attach_assessment(self, title) -> HomeworkAssignment:
        aset = AssessmentSet.objects.create(
            title=title,
            subject="math",
            level="middle",
            created_by=self.teacher,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        for i in range(4):
            AssessmentQuestion.objects.create(
                assessment_set=aset,
                order=i,
                prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
                correct_answer="A",
                points=1,
            )
        return HomeworkAssignment.objects.create(
            classroom=self.classroom,
            assessment_set=aset,
            assignment=self.assignment,
            assigned_by=self.teacher,
        )

    def _sit(self, homework, answer="A"):
        """Sit one assessment through the REAL grading service.

        Driving ``grade_attempt`` rather than writing an ``AssessmentResult`` by hand is
        the point: the composed grade is supposed to READ what the engine recorded, so a
        test that recorded the number itself would prove nothing about that.

        Deliberately NOT wrapped in ``captureOnCommitCallbacks``. The result lands inside
        the grading transaction, which is all this module reads; what defers to on_commit
        is the reward settlement and the push notification, and running the latter here
        only asks a test suite with no broker to reach one.
        """
        from assessments.grading_service import grade_attempt

        questions = list(homework.assessment_set.questions.order_by("order"))
        attempt = AssessmentAttempt.objects.create(
            homework=homework,
            student=self.student,
            status=AssessmentAttempt.STATUS_SUBMITTED,
            submitted_at=timezone.now(),
            question_order=[q.id for q in questions],
        )
        for q in questions:
            AssessmentAnswer.objects.create(attempt=attempt, question=q, answer=answer)
        grade_attempt(attempt_id=attempt.pk)
        return attempt

    def _sit_all(self, *, wrong=0):
        """Sit every attached assessment; the last ``wrong`` of them answered incorrectly."""
        for i, homework in enumerate(self.homeworks):
            self._sit(homework, answer="B" if i >= len(self.homeworks) - wrong else "A")

    def _set_share(self, share):
        self.assignment.manual_grade_weight_percent = share
        self.assignment.save(update_fields=["manual_grade_weight_percent"])

    def _mark(self, grade, *, max_score=None):
        """The teacher's own mark, the way the grading endpoint records one."""
        submission, _ = Submission.objects.get_or_create(
            assignment=self.assignment,
            student=self.student,
            defaults={"status": Submission.STATUS_SUBMITTED, "submitted_at": timezone.now()},
        )
        SubmissionReview.objects.update_or_create(
            submission=submission,
            defaults={
                "teacher": self.teacher,
                "grade": grade,
                "max_score": max_score,
                "is_auto": False,
            },
        )
        return submission

    def _compose(self):
        return compose_assignment_grade(self.assignment, self.student)


class DefaultLeavesEverythingAloneTests(ManualShareFixture):
    def test_the_field_defaults_to_null(self):
        self.assertIsNone(self.assignment.manual_grade_weight_percent)

    def test_null_composes_nothing(self):
        """No manual component was asked for, so there is nothing to compose and the
        caller reads the grade exactly where it read it before."""
        self._sit_all()
        composed = self._compose()
        self.assertEqual(composed.state, STATE_NO_MANUAL_COMPONENT)
        self.assertIsNone(composed.percent)
        self.assertIsNone(composed.automatic_percent)
        self.assertIsNone(composed.manual_percent)

    def test_the_submission_payload_carries_null(self):
        """Present and null, never absent: a client must not have to tell "this homework
        does not compose" from "this response forgot to say"."""
        self._sit_all()
        submission = self._mark(None)
        client = APIClient()
        client.force_authenticate(self.teacher)
        resp = client.get(
            f"/api/classes/{self.classroom.id}/assignments/{self.assignment.id}/submissions/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        row = next(r for r in resp.json() if r["id"] == submission.id)
        self.assertIn("composed_grade", row)
        self.assertIsNone(row["composed_grade"])


class WhatTheMarkWasOutOfTests(ManualShareFixture):
    """The denominator `_manual_mark_percent` divides the teacher's mark by.

    Every other test in this module leaves both ceilings null, so the settings fallback of
    100 is taken every time and ``100 * grade / ceiling`` is only ever exercised at a ratio
    of one. A mark of 50 then reads as 50% whether the scaling works or not: replace the
    whole expression with ``float(review.grade)`` and the suite stays green.

    These four run it at ratios that are not one, so the arithmetic and the precedence are
    both pinned. They also say which ceiling wins, because two of them can be set at once
    and only the row's own answers what THIS mark was typed against.
    """

    def test_the_row_says_what_the_mark_was_out_of(self):
        self._sit_all()
        self._set_share(20)
        # 15 out of 20 is 75%, not 15%.
        self._mark(15, max_score=20)

        composed = self._compose()
        self.assertAlmostEqual(composed.manual_percent, 75.0)
        self.assertAlmostEqual(composed.percent, 95.0)  # 100 x 0.8 + 75 x 0.2

    def test_the_homework_answers_when_the_row_does_not(self):
        self.assignment.max_score = 25
        self.assignment.save(update_fields=["max_score"])
        self._sit_all()
        self._set_share(20)
        self._mark(20)  # no max_score on the review

        composed = self._compose()
        self.assertAlmostEqual(composed.manual_percent, 80.0)  # 20 of 25
        self.assertAlmostEqual(composed.percent, 96.0)  # 100 x 0.8 + 80 x 0.2

    def test_the_row_wins_over_the_homework(self):
        """A homework's ceiling can be edited after a mark was typed against the old one.

        The review carries the scale the teacher actually used, so it decides — otherwise
        editing `max_score` would silently restate every mark already given.
        """
        self.assignment.max_score = 25
        self.assignment.save(update_fields=["max_score"])
        self._sit_all()
        self._set_share(20)
        self._mark(15, max_score=20)

        composed = self._compose()
        self.assertAlmostEqual(composed.manual_percent, 75.0)  # 15 of 20, not 15 of 25

    def test_a_ceiling_of_zero_falls_back_rather_than_dividing_by_it(self):
        """Weights and ceilings are data, and data can be wrong.

        Zero here is the difference between the configured 0-100 range being read and a
        ZeroDivisionError reaching a teacher mid-grading.
        """
        self.assignment.max_score = 0
        self.assignment.save(update_fields=["max_score"])
        self._sit_all()
        self._set_share(20)
        self._mark(40, max_score=0)

        composed = self._compose()
        self.assertAlmostEqual(composed.manual_percent, 40.0)  # the settings range, 0-100
        self.assertAlmostEqual(composed.percent, 88.0)


class TheOwnersExampleTests(ManualShareFixture):
    def test_a_twenty_percent_share_over_four_assessments(self):
        """The learning center's own worked example.

        Four assessments sat perfectly is 100% on the automatic side; the teacher awards
        50 out of 100 by hand. With a 20% manual share the grade is
        ``100 x 0.8 + 50 x 0.2 = 90``.
        """
        self._sit_all()
        self._set_share(20)
        self._mark(50)

        composed = self._compose()
        self.assertEqual(composed.state, STATE_FINAL)
        self.assertTrue(composed.is_final)
        self.assertAlmostEqual(composed.automatic_percent, 100.0)
        self.assertAlmostEqual(composed.manual_percent, 50.0)
        self.assertEqual(composed.manual_weight, 20)
        self.assertEqual(composed.automatic_weight, 80)
        self.assertAlmostEqual(composed.percent, 90.0)

    def test_the_automatic_side_is_the_engines_number_not_a_pass_mark(self):
        """One of the four missed entirely: the automatic side is 75, not 100 and not a
        boolean "they did it". Without this the test above would pass just as happily if
        the automatic side were hard-coded."""
        self._sit_all(wrong=1)
        self._set_share(20)
        self._mark(50)

        composed = self._compose()
        self.assertAlmostEqual(composed.automatic_percent, 75.0)
        self.assertAlmostEqual(composed.percent, 70.0)  # 75 x 0.8 + 50 x 0.2

    def test_the_composed_grade_reaches_the_api(self):
        self._sit_all()
        self._set_share(20)
        submission = self._mark(50)

        client = APIClient()
        client.force_authenticate(self.student)
        resp = client.get(
            f"/api/classes/{self.classroom.id}/assignments/{self.assignment.id}/my-submission/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        payload = resp.json()["composed_grade"]
        self.assertEqual(payload["state"], STATE_FINAL)
        self.assertTrue(payload["is_final"])
        self.assertAlmostEqual(payload["percent"], 90.0)
        self.assertEqual(payload["manual_weight_percent"], 20)
        self.assertEqual(payload["automatic_weight_percent"], 80)
        self.assertEqual(submission.assignment_id, self.assignment.id)


class WhileTheTeacherIsStillCheckingTests(ManualShareFixture):
    def test_the_automatic_part_is_reported_and_flagged_as_not_final(self):
        """The student sees a real number AND is told it can still move.

        The number is the automatic part's own contribution — 80 of the 100 available —
        never the automatic percent scaled up to fill the missing fifth.
        """
        self._sit_all()
        self._set_share(20)

        composed = self._compose()
        self.assertEqual(composed.state, STATE_AWAITING_MANUAL)
        self.assertFalse(composed.is_final)
        self.assertAlmostEqual(composed.percent, 80.0)
        self.assertAlmostEqual(composed.automatic_percent, 100.0)
        self.assertIsNone(composed.manual_percent)

    def test_feedback_without_a_grade_is_not_a_mark(self):
        """A teacher who opened the work and wrote a note has not marked it yet."""
        self._sit_all()
        self._set_share(20)
        self._mark(None)

        self.assertEqual(self._compose().state, STATE_AWAITING_MANUAL)

    def test_an_automatic_grade_is_never_mistaken_for_the_teachers_mark(self):
        """``is_auto`` is what tells the two apart, and the auto-grading paths set it on
        every row they write. Reading such a row as the manual mark would finalize a grade
        the teacher never gave."""
        self._sit_all()
        self._set_share(20)
        submission, _ = Submission.objects.get_or_create(
            assignment=self.assignment,
            student=self.student,
            defaults={"status": Submission.STATUS_REVIEWED, "submitted_at": timezone.now()},
        )
        SubmissionReview.objects.create(
            submission=submission, teacher=self.teacher, grade=100, is_auto=True
        )

        composed = self._compose()
        self.assertEqual(composed.state, STATE_AWAITING_MANUAL)
        self.assertIsNone(composed.manual_percent)
        self.assertAlmostEqual(composed.percent, 80.0)


class ZeroAndOneHundredTests(ManualShareFixture):
    def test_a_hundred_percent_hands_the_whole_grade_to_the_teacher(self):
        self._sit_all()
        self._set_share(100)
        self._mark(64)

        composed = self._compose()
        self.assertEqual(composed.state, STATE_FINAL)
        self.assertEqual(composed.manual_weight, 100)
        self.assertEqual(composed.automatic_weight, 0)
        self.assertAlmostEqual(composed.percent, 64.0)

    def test_a_hundred_percent_shows_no_number_before_the_mark(self):
        """Nothing automatic carries weight, so there is no settled part to show. A 0 here
        would read as "you scored zero" for a homework nobody has looked at yet."""
        self._sit_all()
        self._set_share(100)

        composed = self._compose()
        self.assertEqual(composed.state, STATE_AWAITING_MANUAL)
        self.assertIsNone(composed.percent)
        self.assertAlmostEqual(composed.automatic_percent, 100.0)

    def test_zero_percent_is_a_review_that_carries_no_weight(self):
        """The teacher asked to look at the work without it moving the grade. The number
        is the automatic side's, and it is final the moment the engines have it: waiting
        on a mark that cannot change it would be telling the student to wait for nothing.
        """
        self._sit_all(wrong=1)
        self._set_share(0)

        composed = self._compose()
        self.assertEqual(composed.state, STATE_FINAL)
        self.assertEqual(composed.manual_weight, 0)
        self.assertEqual(composed.automatic_weight, 100)
        self.assertAlmostEqual(composed.percent, 75.0)

    def test_zero_percent_marked_leaves_the_grade_where_it_was(self):
        self._sit_all(wrong=1)
        self._set_share(0)
        self._mark(10)

        self.assertAlmostEqual(self._compose().percent, 75.0)


class NothingAutoGradedTests(ManualShareFixture):
    """The contradiction: a share below 100 on a homework with nothing to grade by machine.

    The create form is supposed to prevent it. A draft whose assessments were detached
    after the fact arrives here anyway, so the backend has to decide — and it gives the
    teacher's mark the whole grade rather than scoring the absent machine side 0.
    """

    def setUp(self):
        super().setUp()
        for homework in self.homeworks:
            homework.delete()
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])

    def test_the_mark_takes_the_whole_grade(self):
        self._set_share(20)
        self._mark(70)

        composed = self._compose()
        self.assertIsNone(composed.automatic_percent)
        self.assertEqual(composed.manual_weight, 100)
        self.assertEqual(composed.automatic_weight, 0)
        self.assertAlmostEqual(composed.percent, 70.0)

    def test_a_hand_in_is_not_an_automatic_score(self):
        """Handing a file in is how the student reaches the teacher, not a grade.

        ``rewards.homework`` scores the hand-in slot 100 on upload so that points never
        wait on a teacher's backlog; counting that on the automatic side would pay the
        student full marks for the manual work twice — once for uploading it, again when
        it is marked.
        """
        submission = self._mark(None)
        submission.status = Submission.STATUS_SUBMITTED
        submission.submitted_at = timezone.now()
        submission.save(update_fields=["status", "submitted_at"])
        self._set_share(20)

        composed = self._compose()
        self.assertIsNone(
            composed.automatic_percent,
            "an uploaded file is not something a machine graded",
        )
        self.assertEqual(composed.state, STATE_AWAITING_MANUAL)
        self.assertIsNone(composed.percent)


class TheMarkArrivesThroughTheGradingEndpointTests(ManualShareFixture):
    """The teacher enters their mark inside a classroom's Grading section, which posts to
    the submission's ``grade`` endpoint. End to end, because the composed grade is only
    worth anything if the mark the teacher actually types reaches it."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _submission(self, status=Submission.STATUS_SUBMITTED):
        return Submission.objects.create(
            assignment=self.assignment,
            student=self.student,
            status=status,
            submitted_at=timezone.now(),
        )

    def test_grading_finalizes_the_composed_grade(self):
        self._sit_all()
        self._set_share(20)
        submission = self._submission()

        resp = self.client.post(
            f"/api/classes/submissions/{submission.id}/grade/", {"grade": 50}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        payload = resp.json()["composed_grade"]
        self.assertEqual(payload["state"], STATE_FINAL)
        self.assertAlmostEqual(payload["percent"], 90.0)

    def test_grading_records_the_mark_as_a_humans(self):
        """``is_auto`` was only ever set by the auto-grading paths and never cleared when a
        person re-marked the same submission. A row that still claimed to be automatic
        would keep the composed grade waiting for a mark that had already been given."""
        self._sit_all()
        self._set_share(20)
        submission = self._submission(status=Submission.STATUS_REVIEWED)
        SubmissionReview.objects.create(
            submission=submission, teacher=self.teacher, grade=100, is_auto=True
        )

        resp = self.client.post(
            f"/api/classes/submissions/{submission.id}/grade/", {"grade": 50}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        review = SubmissionReview.objects.get(submission=submission)
        self.assertFalse(review.is_auto, "a person just graded this")
        self.assertEqual(resp.json()["composed_grade"]["state"], STATE_FINAL)
        self.assertAlmostEqual(resp.json()["composed_grade"]["percent"], 90.0)


class TheShareIsWrittenAndKeptTests(ManualShareFixture):
    """The field has to survive the two doors a homework goes out through."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _url(self, assignment):
        return f"/api/classes/{self.classroom.id}/assignments/{assignment.id}/"

    def test_create_accepts_the_share(self):
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {"title": "Essay", "category": Assignment.CATEGORY_HOMEWORK,
             "manual_grade_weight_percent": 20},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["manual_grade_weight_percent"], 20)
        created = Assignment.objects.get(pk=resp.json()["id"])
        self.assertEqual(created.manual_grade_weight_percent, 20)

    def test_publishing_a_draft_from_the_edit_form_keeps_the_share(self):
        """Publishing goes through ``update()``, and a field silently dropped there is a
        bug this branch has already fixed once."""
        draft = Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.teacher,
            title="Draft",
            category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_DRAFT,
        )
        resp = self.client.patch(
            self._url(draft),
            {"status": Assignment.STATUS_PUBLISHED, "manual_grade_weight_percent": 35},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        draft.refresh_from_db()
        self.assertEqual(draft.status, Assignment.STATUS_PUBLISHED)
        self.assertEqual(draft.manual_grade_weight_percent, 35)

    def test_the_share_can_be_cleared(self):
        self._set_share(20)
        resp = self.client.patch(
            self._url(self.assignment), {"manual_grade_weight_percent": None}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(Assignment.objects.get(pk=self.assignment.pk).manual_grade_weight_percent)

    def test_a_share_over_a_hundred_is_refused(self):
        resp = self.client.patch(
            self._url(self.assignment), {"manual_grade_weight_percent": 101}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("manual_grade_weight_percent", resp.json())
        self.assertIsNone(
            Assignment.objects.get(pk=self.assignment.pk).manual_grade_weight_percent
        )

    def test_a_negative_share_is_refused(self):
        resp = self.client.patch(
            self._url(self.assignment), {"manual_grade_weight_percent": -1}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIsNone(
            Assignment.objects.get(pk=self.assignment.pk).manual_grade_weight_percent
        )


class ANoteIsNotAMarkTests(ManualShareFixture):
    """The grading endpoint also takes feedback on its own — "Have another go." with the
    grade box left empty — and a save like that must not be recorded as a human mark.

    Two things break when it is. The composed grade declares the ENGINE's percent to be the
    teacher's, final, when no person awarded anything; and the re-sync guard that exists to
    protect a teacher's grade starts protecting a number no teacher gave, on homework that
    never asked for a manual share at all.
    """

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _auto_reviewed(self, grade):
        """A submission the machine already graded, as the auto-grading paths leave it."""
        submission = Submission.objects.create(
            assignment=self.assignment,
            student=self.student,
            status=Submission.STATUS_REVIEWED,
            submitted_at=timezone.now(),
        )
        SubmissionReview.objects.create(
            submission=submission, teacher=self.teacher, grade=grade, is_auto=True
        )
        return submission

    def _post(self, submission, payload):
        return self.client.post(
            f"/api/classes/submissions/{submission.id}/grade/", payload, format="json"
        )

    def test_feedback_alone_leaves_the_row_machine_graded(self):
        submission = self._auto_reviewed(88)

        resp = self._post(submission, {"feedback": "Have another go."})

        self.assertEqual(resp.status_code, 200, resp.content)
        review = SubmissionReview.objects.get(submission=submission)
        self.assertTrue(review.is_auto, "nobody typed a grade")
        self.assertEqual(review.feedback, "Have another go.")
        self.assertEqual(float(review.grade), 88.0, "the note must not move the number")

    def test_an_empty_save_leaves_the_row_machine_graded(self):
        submission = self._auto_reviewed(88)

        resp = self._post(submission, {})

        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(SubmissionReview.objects.get(submission=submission).is_auto)

    def test_clearing_the_grade_is_not_a_mark_either(self):
        """An explicit null takes a number away; it does not put a person's behind it."""
        submission = self._auto_reviewed(88)

        resp = self._post(submission, {"grade": None})

        self.assertEqual(resp.status_code, 200, resp.content)
        review = SubmissionReview.objects.get(submission=submission)
        self.assertIsNone(review.grade)
        self.assertTrue(review.is_auto, "there is no mark left to protect")

    def test_a_number_typed_by_a_teacher_is_a_mark(self):
        """The other half of the rule: a grade a person actually awarded IS theirs, and the
        row must stop claiming the machine wrote it."""
        submission = self._auto_reviewed(88)

        resp = self._post(submission, {"grade": 50})

        self.assertEqual(resp.status_code, 200, resp.content)
        review = SubmissionReview.objects.get(submission=submission)
        self.assertFalse(review.is_auto, "a person just graded this")
        self.assertEqual(float(review.grade), 50.0)

    def test_the_engines_percent_is_never_presented_as_the_teachers_mark(self):
        self._sit_all()
        self._set_share(20)
        submission = self._auto_reviewed(88)

        self._post(submission, {"feedback": "Nearly — check question 3."})

        composed = self._compose()
        self.assertEqual(composed.state, STATE_AWAITING_MANUAL)
        self.assertIsNone(composed.manual_percent, "no person has awarded a mark")
        self.assertAlmostEqual(composed.percent, 80.0)


class TheEngineKeepsGradingAfterANoteTests(ManualShareFixture):
    """Ordinary auto-graded homework — ONE assessment, no manual share ever asked for.

    A teacher leaves a note and the student re-sits. The engine has always updated the grade
    on the next sitting, and the only thing that ever stopped it was a genuine human mark.
    """

    def setUp(self):
        super().setUp()
        # One assessment: a bundle is instructional and the assessment signal deliberately
        # leaves it alone (``sync_assessment_submission`` returns on ``is_multi_content``).
        for homework in self.homeworks[1:]:
            homework.delete()
        self.homework = self.homeworks[0]
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _sit_and_sync(self, answer):
        """Sit the quiz and run the sync the attempt-submit view runs.

        Re-read from the database first, exactly as that view does: grading writes the
        result and the GRADED status on the stored row, and a sync handed the stale
        in-memory attempt sees a sitting that is still ungraded.
        """
        from classes.homework_auto_submit import sync_assessment_submission

        attempt = self._sit(self.homework, answer=answer)
        attempt.refresh_from_db()
        return sync_assessment_submission(attempt)

    def test_a_note_does_not_freeze_the_automatic_grade(self):
        self._sit_and_sync("B")
        submission = Submission.objects.get(assignment=self.assignment, student=self.student)
        review = SubmissionReview.objects.get(submission=submission)
        self.assertEqual(float(review.grade), 0.0)

        resp = self.client.post(
            f"/api/classes/submissions/{submission.id}/grade/",
            {"feedback": "Have another go."},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        self.assertTrue(self._sit_and_sync("A"), "the engine still owns this grade")
        review.refresh_from_db()
        self.assertEqual(
            float(review.grade), 100.0, "the student re-sat it and got everything right"
        )

    def test_a_teachers_own_mark_is_still_never_overwritten(self):
        """The guard the note must not trip is still standing where it belongs."""
        self._sit_and_sync("B")
        submission = Submission.objects.get(assignment=self.assignment, student=self.student)

        resp = self.client.post(
            f"/api/classes/submissions/{submission.id}/grade/", {"grade": 40}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)

        self.assertFalse(self._sit_and_sync("A"), "a human graded this")
        review = SubmissionReview.objects.get(submission=submission)
        self.assertEqual(float(review.grade), 40.0)


class LateWorkSettlesWhereThePointsSettleTests(ManualShareFixture):
    """The automatic side is read at the moment the points ledger reads it.

    ``rewards.homework.recompute_bundle`` scores live until the deadline and as of the
    deadline afterwards. Reading the same items without that cutoff gives a student a
    homework page that says 100 while their points row for the identical work says 0%.
    """

    def _dates(self, *, created_days_ago, due_in_days):
        from datetime import timedelta

        now = timezone.now()
        Assignment.objects.filter(pk=self.assignment.pk).update(
            created_at=now - timedelta(days=created_days_ago),
            due_at=now + timedelta(days=due_in_days),
        )
        self.assignment.refresh_from_db()

    def test_work_done_after_the_deadline_does_not_lift_the_automatic_side(self):
        from rewards.homework import bundle_percent

        self._dates(created_days_ago=10, due_in_days=-5)
        self._sit_all()  # five days late
        self._set_share(20)

        composed = self._compose()
        settled = bundle_percent(self.assignment, self.student, self.assignment.due_at)
        self.assertAlmostEqual(composed.automatic_percent, settled)
        self.assertAlmostEqual(composed.automatic_percent, 0.0)
        self.assertAlmostEqual(composed.percent, 0.0)
        self.assertEqual(composed.state, STATE_AWAITING_MANUAL)

    def test_before_the_deadline_the_automatic_side_is_live(self):
        self._dates(created_days_ago=2, due_in_days=2)
        self._sit_all()
        self._set_share(20)

        composed = self._compose()
        self.assertAlmostEqual(composed.automatic_percent, 100.0)
        self.assertAlmostEqual(composed.percent, 80.0)

    def test_a_deadline_that_predates_the_homework_is_no_deadline(self):
        """``journals.delivery`` mints carriers already overdue at creation — the lesson's
        planned date, not today's. ``rewards.homework._scoring_cutoff`` refuses to settle
        such a homework at 0%, and this side must refuse it the same way or the student's
        grade and their points disagree again, in the opposite direction."""
        self._dates(created_days_ago=1, due_in_days=-3)
        self._sit_all()
        self._set_share(20)

        composed = self._compose()
        self.assertAlmostEqual(composed.automatic_percent, 100.0)
        self.assertAlmostEqual(composed.percent, 80.0)


class TheGradeShowsBeforeAnythingIsHandedInTests(ManualShareFixture):
    """Two word sets mastered on Monday, the PDFs handed in on Friday.

    Vocabulary records its progress in its own engine, so until the student uploads there is
    no ``Submission`` row at all. The automatic side is settled the whole time, and a
    composed grade served only off a submission row would show the student nothing — the
    very week the "your teacher is still checking" line exists for.
    """

    def setUp(self):
        super().setUp()
        for homework in self.homeworks:
            homework.delete()
        self.assignment.allow_file_upload = True
        self.assignment.save(update_fields=["allow_file_upload"])
        self._master_two_word_sets()
        self._set_share(20)

    def _master_two_word_sets(self):
        """Both sets, all four games played clean — the bar ``rewards.homework`` scores on."""
        from vocabulary.models import (
            VocabHomework,
            VocabSection,
            VocabSet,
            VocabSetItem,
            VocabStudySession,
            VocabWord,
        )

        section = VocabSection.objects.create(title="Real Exam Words", slug="ms-real-exam-words")
        for n in range(2):
            vocab_set = VocabSet.objects.create(section=section, title=f"Set {n}")
            word_ids = []
            for w in range(2):
                word = VocabWord.objects.create(
                    section=section, word=f"word-{n}-{w}", definition="a definition"
                )
                VocabSetItem.objects.create(vocab_set=vocab_set, word=word, order=w)
                word_ids.append(word.id)
            VocabHomework.objects.create(
                classroom=self.classroom,
                assignment=self.assignment,
                vocab_set=vocab_set,
                assigned_by=self.teacher,
            )
            for mode, _label in VocabStudySession.MODE_CHOICES:
                VocabStudySession.objects.create(
                    user=self.student,
                    vocab_set=vocab_set,
                    mode=mode,
                    completed_at=timezone.now(),
                    correct_count=len(word_ids),
                    total_count=len(word_ids),
                    accuracy=100.0,
                    distinct_words=len(word_ids),
                    answered_word_ids=word_ids,
                )

    def _my_submission(self):
        client = APIClient()
        client.force_authenticate(self.student)
        return client.get(
            f"/api/classes/{self.classroom.id}/assignments/{self.assignment.id}/my-submission/"
        )

    def test_the_settled_part_reaches_the_student_with_no_submission_row(self):
        self.assertFalse(
            Submission.objects.filter(assignment=self.assignment, student=self.student).exists()
        )

        resp = self._my_submission()

        self.assertEqual(resp.status_code, 200, resp.content)
        payload = resp.json()["composed_grade"]
        self.assertEqual(payload["state"], STATE_AWAITING_MANUAL)
        self.assertFalse(payload["is_final"])
        self.assertAlmostEqual(payload["automatic_percent"], 100.0)
        self.assertAlmostEqual(payload["percent"], 80.0)
        self.assertIsNone(payload["manual_percent"])

    def test_the_key_is_present_and_null_when_no_share_was_asked_for(self):
        """A client reads one shape whether or not the homework composes; an absent key
        would read as "this response forgot to say"."""
        self._set_share(None)

        body = self._my_submission().json()

        self.assertIn("composed_grade", body)
        self.assertIsNone(body["composed_grade"])
