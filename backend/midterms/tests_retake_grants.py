"""Retake grants must reach only the students who failed the parent — on every path.

Two paths were leaking a retake grant to students it does not belong to:

* enrolling INTO a class that already has a retake assigned backfilled the grant blindly
  (a new student has no failing verdict, so they can never sit it);
* the LEGACY MockExam-based assign endpoint granted a retake to the whole room, unlike the
  v2 path which already narrows to failers.

The start gate catches both (a passer/ineligible student is 403'd), but a stray grant
misrepresents who is owed the retake and — on the classroom path — summons them by email.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from access.engine.classroom_service import ClassroomAccessService
from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from classes.models import Classroom, ClassroomMembership
from exams.models import Module, Question
from midterms.models import Midterm, MidtermOutcome

User = get_user_model()


def _midterm(title, *, mtype=Midterm.TYPE_MIDTERM, parent=None, n=2):
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=25)
    for i in range(n):
        Question.objects.create(
            module=module, question_type="MATH", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", score=10, order=i,
        )
    return Midterm.objects.create(
        title=title, subject=Midterm.MATH, scoring_scale="SCALE_100", midterm_type=mtype,
        pass_mark=60, retake_of=parent, question_module=module, is_published=True,
    )


def _grants(user, midterm):
    return ResourceAccessGrant.objects.filter(
        user=user, resource_type=RT_MIDTERM_V2, resource_id=midterm.id,
        status=ResourceAccessGrant.STATUS_ACTIVE,
    )


class EnrollmentBackfillTests(TestCase):
    """Enrolling into a class with a retake already assigned must not grant it to a
    student who was never eligible."""

    def setUp(self):
        self.teacher = User.objects.create_user(username="t", email="t@example.com", password="x", role="teacher", subject="math")
        self.classroom = Classroom.objects.create(name="G12 Math", subject="MATH", created_by=self.teacher)
        self.parent = _midterm("Midterm 3")
        self.retake = _midterm("Midterm 3 — Retake", mtype=Midterm.TYPE_RETAKE, parent=self.parent)
        # A retake grant already exists on the classroom (from an earlier assign).
        self.failer = User.objects.create_user(username="f", email="f@example.com", password="x", role="student")
        MidtermOutcome.objects.create(
            midterm=self.parent, student=self.failer, score=40, pass_mark=60,
            scoring_scale="SCALE_100", passed=False,
        )
        ResourceAccessGrant.objects.create(
            user=self.failer, classroom=self.classroom, resource_type=RT_MIDTERM_V2,
            resource_id=self.retake.id, scope=ResourceAccessGrant.SCOPE_RESOURCE,
            source=ResourceAccessGrant.SOURCE_CLASSROOM, status=ResourceAccessGrant.STATUS_ACTIVE,
        )

    def _enroll(self, user):
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
        )
        return ClassroomAccessService.on_student_enrolled(self.classroom, user, actor=self.teacher)

    def test_a_new_student_is_not_granted_the_retake(self):
        newcomer = User.objects.create_user(username="n", email="n@example.com", password="x", role="student")
        self._enroll(newcomer)
        self.assertFalse(_grants(newcomer, self.retake).exists())

    def test_a_new_student_who_failed_the_parent_IS_granted_the_retake(self):
        # A transfer student who genuinely failed the parent elsewhere is eligible.
        transferred = User.objects.create_user(username="x2", email="x2@example.com", password="x", role="student")
        MidtermOutcome.objects.create(
            midterm=self.parent, student=transferred, score=35, pass_mark=60,
            scoring_scale="SCALE_100", passed=False,
        )
        self._enroll(transferred)
        self.assertTrue(_grants(transferred, self.retake).exists())

    def test_an_ordinary_midterm_still_backfills_for_everyone(self):
        ResourceAccessGrant.objects.create(
            classroom=self.classroom, resource_type=RT_MIDTERM_V2, resource_id=self.parent.id,
            scope=ResourceAccessGrant.SCOPE_RESOURCE, source=ResourceAccessGrant.SOURCE_CLASSROOM,
            status=ResourceAccessGrant.STATUS_ACTIVE,
            user=User.objects.create_user(username="seed", email="seed@example.com", password="x", role="student"),
        )
        newcomer = User.objects.create_user(username="n2", email="n2@example.com", password="x", role="student")
        self._enroll(newcomer)
        self.assertTrue(_grants(newcomer, self.parent).exists())


class LegacyAssignNarrowingTests(TestCase):
    """The legacy MockExam assign path narrows a retake to failers, like the v2 path."""

    def setUp(self):
        from exams.models import MockExam

        self.teacher = User.objects.create_user(username="lt", email="lt@example.com", password="x", role="teacher", subject="math")
        self.classroom = Classroom.objects.create(name="G11 Math", subject="MATH", created_by=self.teacher)
        self.passer = User.objects.create_user(username="p", email="p@example.com", password="x", role="student")
        self.failer = User.objects.create_user(username="f2", email="f2@example.com", password="x", role="student")
        for u in (self.passer, self.failer):
            ClassroomMembership.objects.create(classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT)

        # A legacy retake MockExam mirrored to a midterms.Midterm retake of a parent.
        self.parent = _midterm("Legacy parent")
        self.retake_exam = MockExam.objects.create(
            title="Legacy Retake", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type="RETAKE",
        )
        self.retake = _midterm("Legacy Retake mirror", mtype=Midterm.TYPE_RETAKE, parent=self.parent)
        Midterm.objects.filter(pk=self.retake.pk).update(legacy_mock_exam_id=self.retake_exam.id)

        MidtermOutcome.objects.create(midterm=self.parent, student=self.passer, score=80, pass_mark=60, scoring_scale="SCALE_100", passed=True)
        MidtermOutcome.objects.create(midterm=self.parent, student=self.failer, score=40, pass_mark=60, scoring_scale="SCALE_100", passed=False)

    def _legacy_grants(self, user):
        from access.resources import RT_MIDTERM

        return ResourceAccessGrant.objects.filter(
            user=user, resource_type=RT_MIDTERM, resource_id=self.retake_exam.id,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        )

    def test_only_the_failer_gets_the_legacy_retake_grant(self):
        from classes.views_assign import _assign_legacy_midterm_grant

        _assign_legacy_midterm_grant(self.classroom, self.retake_exam, self.teacher)
        self.assertTrue(self._legacy_grants(self.failer).exists())
        self.assertFalse(self._legacy_grants(self.passer).exists())

    def test_an_ordinary_legacy_midterm_still_grants_the_whole_class(self):
        from exams.models import MockExam

        from classes.views_assign import _assign_legacy_midterm_grant

        ordinary = MockExam.objects.create(
            title="Legacy Midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH", midterm_type="MIDTERM",
        )
        _assign_legacy_midterm_grant(self.classroom, ordinary, self.teacher)
        from access.resources import RT_MIDTERM

        granted = ResourceAccessGrant.objects.filter(
            resource_type=RT_MIDTERM, resource_id=ordinary.id, status=ResourceAccessGrant.STATUS_ACTIVE,
        ).values_list("user_id", flat=True)
        self.assertIn(self.passer.id, granted)
        self.assertIn(self.failer.id, granted)
