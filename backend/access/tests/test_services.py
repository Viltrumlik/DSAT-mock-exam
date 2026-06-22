"""Security-critical tests for RBAC + ``UserAccess`` helpers."""

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from access import constants as C
from access.exceptions import SubjectContractViolation
from access.models import Permission, UserAccess, UserPermission
from access.services import (
    access_level_for_practice_test,
    authorize,
    can_edit_multi_subject_object,
    can_edit_tests,
    can_manage_questions,
    can_view_tests,
    filter_practice_tests_for_user,
    has_access_for_classroom,
    has_global_subject_access,
    normalized_role,
    student_has_any_subject_grant,
    visible_practice_test_platform_subjects_for_query,
)

User = get_user_model()


class CanManageQuestionsTests(TestCase):
    def test_student_cannot_manage_questions(self):
        u = User.objects.create_user(email="stq@example.com", password="x", role=C.ROLE_STUDENT)
        self.assertFalse(can_manage_questions(u))

    def test_teacher_cannot_manage_questions(self):
        u = User.objects.create_user(
            email="tq@example.com", password="x", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.assertFalse(can_manage_questions(u))

    def test_test_admin_can_manage_questions(self):
        u = User.objects.create_user(email="taq@example.com", password="x", role=C.ROLE_TEST_ADMIN)
        self.assertTrue(can_manage_questions(u))


class AccessPrimitivesTests(TestCase):
    def setUp(self):
        self.math_teacher = User.objects.create_user(
            email="t_math@example.com",
            password="x",
            role=C.ROLE_TEACHER,
            subject=C.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.math_teacher,
            subject=C.DOMAIN_MATH,
            classroom=None,
            granted_by=self.math_teacher,
        )
        self.english_teacher = User.objects.create_user(
            email="t_en@example.com",
            password="x",
            role=C.ROLE_TEACHER,
            subject=C.DOMAIN_ENGLISH,
        )
        UserAccess.objects.create(
            user=self.english_teacher,
            subject=C.DOMAIN_ENGLISH,
            classroom=None,
            granted_by=self.english_teacher,
        )

    def test_teacher_cannot_pass_english_authorize_with_math_subject(self):
        self.assertFalse(
            authorize(
                self.math_teacher,
                C.PERM_MANAGE_TESTS,
                subject=C.SUBJECT_ENGLISH_PLATFORM,
            )
        )

    def test_domain_permissions_require_explicit_subject(self):
        with self.assertRaises(SubjectContractViolation):
            authorize(self.math_teacher, C.PERM_MANAGE_TESTS)
        self.assertTrue(
            authorize(self.math_teacher, C.PERM_MANAGE_TESTS, subject=C.SUBJECT_MATH_PLATFORM)
        )

    def test_global_access_requires_null_classroom_row_for_student(self):
        student = User.objects.create_user(
            email="st@example.com",
            password="x",
            role=C.ROLE_STUDENT,
        )
        UserAccess.objects.create(
            user=student,
            subject=C.DOMAIN_MATH,
            classroom=None,
            granted_by=None,
        )
        self.assertTrue(has_global_subject_access(student, C.DOMAIN_MATH))
        self.assertTrue(student_has_any_subject_grant(student, C.DOMAIN_MATH))

        only_class = User.objects.create_user(
            email="st2@example.com",
            password="x",
            role=C.ROLE_STUDENT,
        )
        from classes.models import Classroom

        c = Classroom.objects.create(
            name="M",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.math_teacher,
        )
        UserAccess.objects.create(
            user=only_class,
            subject=C.DOMAIN_MATH,
            classroom=c,
            granted_by=None,
        )
        self.assertFalse(has_global_subject_access(only_class, C.DOMAIN_MATH))
        self.assertTrue(student_has_any_subject_grant(only_class, C.DOMAIN_MATH))
        self.assertTrue(has_access_for_classroom(only_class, C.DOMAIN_MATH, c.pk))

    def test_student_global_and_any_grant_alignment(self):
        student = User.objects.create_user(
            email="st3@example.com",
            password="x",
            role=C.ROLE_STUDENT,
        )
        UserAccess.objects.create(
            user=student,
            subject=C.DOMAIN_ENGLISH,
            classroom=None,
            granted_by=None,
        )
        self.assertTrue(student_has_any_subject_grant(student, C.DOMAIN_ENGLISH))
        self.assertTrue(has_global_subject_access(student, C.DOMAIN_ENGLISH))

    def test_authorize_rejects_domain_string_as_subject(self):
        with self.assertRaises(SubjectContractViolation):
            authorize(
                self.math_teacher,
                C.PERM_MANAGE_TESTS,
                subject=C.DOMAIN_MATH,
            )

    def test_authorize_rejects_unknown_platform_subject(self):
        with self.assertRaises(SubjectContractViolation):
            authorize(self.math_teacher, C.PERM_MANAGE_TESTS, subject="BIOLOGY")

    def test_has_global_rejects_platform_string(self):
        with self.assertRaises(SubjectContractViolation):
            has_global_subject_access(self.math_teacher, C.SUBJECT_MATH_PLATFORM)

    def test_cross_subject_db_row_ignored_for_teacher(self):
        """Subject gate runs before trusting rows in another subject (defensive)."""
        UserAccess.objects.create(
            user=self.math_teacher,
            subject=C.DOMAIN_ENGLISH,
            classroom=None,
            granted_by=self.math_teacher,
        )
        self.assertFalse(has_global_subject_access(self.math_teacher, C.DOMAIN_ENGLISH))

    def test_global_test_admin_authorizes_any_platform_subject(self):
        ta = User.objects.create_user(
            email="ta_math@example.com",
            password="x",
            role=C.ROLE_TEST_ADMIN,
        )
        self.assertTrue(authorize(ta, C.PERM_MANAGE_TESTS, subject=C.SUBJECT_MATH_PLATFORM))
        self.assertTrue(authorize(ta, C.PERM_MANAGE_TESTS, subject=C.SUBJECT_ENGLISH_PLATFORM))

    def test_normalized_role_maps_legacy_strings(self):
        u = User.objects.create_user(
            email="legacy_t@example.com",
            password="x",
            role=C.ROLE_TEACHER,
            subject=C.DOMAIN_MATH,
        )
        User.objects.filter(pk=u.pk).update(role="math_teacher")
        u.refresh_from_db()
        self.assertEqual(normalized_role(u), C.ROLE_TEACHER)

    @override_settings(LMS_AUTHZ_RAISE_ON_MISSING_SUBJECT=True)
    def test_authorize_raises_when_strict_missing_subject(self):
        with self.assertRaises(SubjectContractViolation):
            authorize(self.math_teacher, C.PERM_MANAGE_TESTS)

    def test_assign_only_teacher_can_view_not_edit(self):
        u = User.objects.create_user(
            email="assign_only@example.com",
            password="x",
            role=C.ROLE_TEACHER,
            subject=C.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=u,
            subject=C.DOMAIN_MATH,
            classroom=None,
            granted_by=u,
        )
        p_mt, _ = Permission.objects.get_or_create(
            codename=C.PERM_MANAGE_TESTS,
            defaults={"name": "Manage tests"},
        )
        p_aa, _ = Permission.objects.get_or_create(
            codename=C.PERM_ASSIGN_ACCESS,
            defaults={"name": "Assign access"},
        )
        UserPermission.objects.update_or_create(
            user=u,
            permission=p_mt,
            defaults={"granted": False},
        )
        UserPermission.objects.update_or_create(
            user=u,
            permission=p_aa,
            defaults={"granted": True},
        )
        self.assertTrue(can_view_tests(u, C.SUBJECT_MATH_PLATFORM))
        self.assertFalse(can_edit_tests(u, C.SUBJECT_MATH_PLATFORM))
        from exams.models import PracticeTest

        pt = PracticeTest.objects.create(subject=C.SUBJECT_MATH_PLATFORM, skip_default_modules=True)
        self.assertEqual(access_level_for_practice_test(u, pt), "view")

    def test_test_admin_access_level_view_vs_edit(self):
        from exams.models import PracticeTest

        ta = User.objects.create_user(
            email="ta_lvl@example.com",
            password="x",
            role=C.ROLE_TEST_ADMIN,
        )
        pt = PracticeTest.objects.create(subject=C.SUBJECT_MATH_PLATFORM, skip_default_modules=True)
        self.assertEqual(access_level_for_practice_test(ta, pt), "edit")

    def test_global_staff_visible_queryset_unfiltered(self):
        admin = User.objects.create_user(
            email="adm@example.com",
            password="x",
            role=C.ROLE_ADMIN,
        )
        v = visible_practice_test_platform_subjects_for_query(admin)
        self.assertIsNone(v)

    def test_anonymous_visible_practice_subjects_unfiltered(self):
        from django.contrib.auth.models import AnonymousUser

        v = visible_practice_test_platform_subjects_for_query(AnonymousUser())
        self.assertIsNone(v)

    def test_student_visible_platform_subjects_full_pastpaper_library(self):
        student = User.objects.create_user(
            email="st_lib@example.com",
            password="x",
            role=C.ROLE_STUDENT,
        )
        v = visible_practice_test_platform_subjects_for_query(student)
        self.assertIsNone(v)

    def test_student_filter_includes_standalone_pastpaper_rows(self):
        from exams.models import PracticeTest

        student = User.objects.create_user(
            email="st_ptlib@example.com",
            password="x",
            role=C.ROLE_STUDENT,
        )
        pt = PracticeTest.objects.create(subject=C.SUBJECT_MATH_PLATFORM, skip_default_modules=True)
        qs = filter_practice_tests_for_user(
            student, PracticeTest.objects.filter(mock_exam__isnull=True, pk=pt.pk)
        )
        self.assertTrue(qs.exists())

    def test_filter_queryset_matches_can_view_tests(self):
        from exams.models import PracticeTest

        pt = PracticeTest.objects.create(subject=C.SUBJECT_MATH_PLATFORM, skip_default_modules=True)
        qs = filter_practice_tests_for_user(self.math_teacher, PracticeTest.objects.filter(pk=pt.pk))
        self.assertTrue(qs.exists())
        self.assertTrue(can_view_tests(self.math_teacher, C.SUBJECT_MATH_PLATFORM))

    def test_visible_platform_subjects_locked_to_can_view_tests(self):
        v = visible_practice_test_platform_subjects_for_query(self.math_teacher)
        self.assertEqual(v, frozenset([C.SUBJECT_MATH_PLATFORM]))

    def test_can_edit_multi_subject_mock_requires_all_sections(self):
        from exams.models import MockExam, PracticeTest

        exam = MockExam.objects.create(title="dual", kind=MockExam.KIND_MOCK_SAT)
        PracticeTest.objects.create(
            mock_exam=exam,
            subject=C.SUBJECT_MATH_PLATFORM,
            skip_default_modules=True,
        )
        PracticeTest.objects.create(
            mock_exam=exam,
            subject=C.SUBJECT_ENGLISH_PLATFORM,
            skip_default_modules=True,
        )
        self.assertFalse(can_edit_multi_subject_object(self.math_teacher, exam))

    def test_global_test_admin_can_edit_multi_subject_shell(self):
        from exams.models import MockExam, PracticeTest

        ta = User.objects.create_user(
            email="ta_multi@example.com",
            password="x",
            role=C.ROLE_TEST_ADMIN,
        )
        exam = MockExam.objects.create(title="dual2", kind=MockExam.KIND_MOCK_SAT)
        PracticeTest.objects.create(
            mock_exam=exam,
            subject=C.SUBJECT_MATH_PLATFORM,
            skip_default_modules=True,
        )
        PracticeTest.objects.create(
            mock_exam=exam,
            subject=C.SUBJECT_ENGLISH_PLATFORM,
            skip_default_modules=True,
        )
        self.assertTrue(can_edit_multi_subject_object(ta, exam))

    def test_super_admin_sees_all_standalone_sections(self):
        """Regression: global roles see the full standalone practice/pastpaper library."""
        from exams.models import PracticeTest

        su = User.objects.create_user(
            email="su_pp@example.com",
            password="x",
            role=C.ROLE_SUPER_ADMIN,
        )
        sec = PracticeTest.objects.create(
            collection_name="October form",
            subject=C.SUBJECT_MATH_PLATFORM,
            mock_exam=None,
            skip_default_modules=True,
        )
        qs = filter_practice_tests_for_user(
            su, PracticeTest.objects.filter(mock_exam__isnull=True)
        )
        self.assertTrue(qs.filter(pk=sec.pk).exists())

