"""
Regression + scenario tests for the engine→legacy write-through (the access bug fix).

The production bug: an engine grant wrote only ``ResourceAccessGrant`` (read by
nothing in prod) so the student never received access while the API reported
success. These tests assert that every grant ALSO writes the active legacy
enforcement signal (``assigned_users`` / ``UserAccess``), that Past Paper Pack
Math/Reading/Both grants only the chosen sections, that classroom grants reach
every student, and that a grant which cannot be verified rolls back instead of
reporting a false success.

Run:
    python manage.py test access.tests.test_grant_enforcement \
        --settings=config.settings_test_nomigrations
"""

from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from access import constants as C
from access import resources
from access.engine import AssignmentService, ClassroomAccessService
from access.engine import enforcement
from access.models import ResourceAccessGrant, UserAccess
from classes.models import Classroom, ClassroomMembership
from exams.models import MockExam, PastpaperPack, PortalMockExam, PracticeTest

User = get_user_model()


def make_student(email):
    return User.objects.create_user(email=email, password="x", role=C.ROLE_STUDENT)


def can_see_practice_test(student, pt) -> bool:
    """The exact production student read gate (exams/views.py)."""
    return PracticeTest.objects.filter(
        pk=pt.pk, mock_exam__isnull=True, assigned_users=student
    ).exists()


class WriteThroughRegressionTests(TestCase):
    """The core bug: grant must make access real, not merely recorded."""

    def setUp(self):
        self.actor = User.objects.create_user(email="adm@e.com", password="x", role=C.ROLE_ADMIN)
        self.student = make_student("s1@e.com")
        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )

    def test_resource_grant_writes_assigned_users_and_is_visible(self):
        targets = resources.expand_subject_targets(resources.RT_PRACTICE_TEST, self.pt.pk)
        AssignmentService.bulk_assign_targets(
            [self.student], targets, actor=self.actor
        )
        # Source of truth row exists...
        self.assertTrue(
            ResourceAccessGrant.objects.filter(
                user=self.student, scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=resources.RT_PRACTICE_TEST, resource_id=self.pt.pk,
                status=ResourceAccessGrant.STATUS_ACTIVE,
            ).exists()
        )
        # ...AND the student actually has usable access via the legacy read gate.
        self.assertTrue(can_see_practice_test(self.student, self.pt))
        # A resource grant must confer resource access ONLY — it must not widen the
        # student to the whole subject (no global UserAccess side effect).
        self.assertFalse(
            UserAccess.objects.filter(
                user=self.student, subject=C.DOMAIN_MATH, classroom__isnull=True
            ).exists()
        )

    def test_regrant_repairs_stale_grant_missing_enforcement(self):
        # Simulate the broken prod state: a grant row exists but assigned_users was
        # never written (the bug). Re-granting must repair it.
        ResourceAccessGrant.objects.create(
            user=self.student, scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=resources.RT_PRACTICE_TEST, resource_id=self.pt.pk,
            status=ResourceAccessGrant.STATUS_ACTIVE, source=ResourceAccessGrant.SOURCE_MANUAL,
        )
        self.assertFalse(can_see_practice_test(self.student, self.pt))
        targets = resources.expand_subject_targets(resources.RT_PRACTICE_TEST, self.pt.pk)
        AssignmentService.bulk_assign_targets([self.student], targets, actor=self.actor)
        self.assertTrue(can_see_practice_test(self.student, self.pt))


class PackSubjectScopeTests(TestCase):
    """Past Paper Pack: Math / Reading / Both grants only the chosen sections."""

    def setUp(self):
        self.actor = User.objects.create_user(email="adm2@e.com", password="x", role=C.ROLE_ADMIN)
        self.student = make_student("ps@e.com")
        self.pack = PastpaperPack.objects.create(title="Pack A", is_published=True)
        self.math = PracticeTest.objects.create(
            subject="MATH", pastpaper_pack=self.pack, skip_default_modules=True
        )
        self.rw = PracticeTest.objects.create(
            subject="READING_WRITING", pastpaper_pack=self.pack, skip_default_modules=True
        )

    def _grant(self, scope):
        targets = resources.expand_subject_targets(
            resources.RT_PASTPAPER_PACK, self.pack.pk, scope
        )
        AssignmentService.bulk_assign_targets([self.student], targets, actor=self.actor)

    def test_math_scope_grants_only_math_section(self):
        self._grant("math")
        self.assertTrue(can_see_practice_test(self.student, self.math))
        self.assertFalse(can_see_practice_test(self.student, self.rw))

    def test_reading_scope_grants_only_reading_section(self):
        self._grant("reading")
        self.assertFalse(can_see_practice_test(self.student, self.math))
        self.assertTrue(can_see_practice_test(self.student, self.rw))

    def test_both_scope_grants_all_sections(self):
        self._grant("both")
        self.assertTrue(can_see_practice_test(self.student, self.math))
        self.assertTrue(can_see_practice_test(self.student, self.rw))


class ClassroomWriteThroughTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            email="t2@e.com", password="x", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.classroom = Classroom.objects.create(
            name="C2", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.students = [make_student(f"cw{i}@e.com") for i in range(3)]
        for s in self.students:
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=s, role=ClassroomMembership.ROLE_STUDENT
            )
        self.pt = PracticeTest.objects.create(
            subject="MATH", skip_default_modules=True
        )

    def test_classroom_grant_reaches_every_student(self):
        targets = resources.expand_subject_targets(resources.RT_PRACTICE_TEST, self.pt.pk)
        ClassroomAccessService.assign_targets_to_classroom(
            self.classroom, targets, actor=self.teacher
        )
        for s in self.students:
            self.assertTrue(can_see_practice_test(s, self.pt))


class MidtermWriteThroughTests(TestCase):
    """A midterm is a MockExam(kind=MIDTERM); granting it must reach the mock gate."""

    def setUp(self):
        self.actor = User.objects.create_user(email="adm5@e.com", password="x", role=C.ROLE_ADMIN)
        self.student = make_student("mt@e.com")
        self.midterm = MockExam.objects.create(
            title="Midterm A", kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH", is_published=True, is_active=True,
        )
        PracticeTest.objects.create(
            subject="MATH", mock_exam=self.midterm, skip_default_modules=True
        )

    def test_midterm_grant_writes_mock_gate(self):
        targets = resources.expand_subject_targets(resources.RT_MIDTERM, self.midterm.pk)
        # midterm is not a pack -> grants the midterm itself.
        self.assertEqual(targets, [(resources.RT_MIDTERM, self.midterm.pk)])
        AssignmentService.bulk_assign_targets([self.student], targets, actor=self.actor)
        self.assertTrue(self.midterm.assigned_users.filter(pk=self.student.pk).exists())
        self.assertTrue(
            PortalMockExam.objects.filter(
                mock_exam=self.midterm, assigned_users=self.student
            ).exists()
        )
        self.assertTrue(
            ResourceAccessGrant.objects.filter(
                user=self.student, resource_type=resources.RT_MIDTERM,
                resource_id=self.midterm.pk, status=ResourceAccessGrant.STATUS_ACTIVE,
            ).exists()
        )


class VerificationRollbackTests(TestCase):
    """A grant that cannot be verified must roll back — never a false success."""

    def setUp(self):
        self.actor = User.objects.create_user(email="adm3@e.com", password="x", role=C.ROLE_ADMIN)
        self.student = make_student("vr@e.com")
        self.pt = PracticeTest.objects.create(subject="MATH", skip_default_modules=True)

    def test_verification_failure_rolls_back_grant(self):
        targets = resources.expand_subject_targets(resources.RT_PRACTICE_TEST, self.pt.pk)
        # Suppress the legacy write so verification will (correctly) fail.
        with mock.patch.object(enforcement, "apply_resource", return_value=None):
            with self.assertRaises(enforcement.AccessVerificationError):
                AssignmentService.bulk_assign_targets(
                    [self.student], targets, actor=self.actor
                )
        # Whole transaction rolled back: no grant, no enforcement.
        self.assertFalse(
            ResourceAccessGrant.objects.filter(
                user=self.student, resource_id=self.pt.pk
            ).exists()
        )
        self.assertFalse(can_see_practice_test(self.student, self.pt))


class SubjectGrantWriteThroughTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user(email="adm4@e.com", password="x", role=C.ROLE_ADMIN)
        self.student = make_student("sg@e.com")

    def test_subject_grant_ensures_legacy_user_access(self):
        AssignmentService.bulk_assign_subject(
            [self.student], C.DOMAIN_MATH, actor=self.actor
        )
        self.assertTrue(
            UserAccess.objects.filter(
                user=self.student, subject=C.DOMAIN_MATH, classroom__isnull=True
            ).exists()
        )
