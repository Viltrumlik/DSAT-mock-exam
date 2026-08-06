"""The ``support_teacher`` global role.

A new global role is not a one-line change: every chokepoint that spells out a role list
either denies the unknown role outright or, worse, silently downgrades it. These tests pin
each one, and the first class pins the rule that would have made the whole family of bugs
impossible to reintroduce.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from access import constants as C
from access.models import UserAccess
from access.services import (
    authorize,
    has_access_for_classroom,
    has_global_subject_access,
    is_global_scope_staff,
    normalized_role,
    role_permissions_matrix,
    staff_must_have_subject,
    user_domain_subject,
)
from classes.models import Classroom
from users.serializers import UserSerializer

User = get_user_model()


def _support(email="sup@t.com", subject=C.DOMAIN_MATH):
    return User.objects.create_user(
        email, "secret123", role=C.ROLE_SUPPORT_TEACHER, subject=subject
    )


class EveryCanonicalRoleIsAccountedForTests(TestCase):
    """Guards against the class of bug this role exposed: a role list that quietly omits a
    member, so the new role falls through a default instead of being rejected loudly."""

    def test_every_canonical_role_has_a_privilege_rank(self):
        """**Security.** ``_resolve_system_role_for_write`` compares
        ``_ROLE_RANK.get(rc, 1)`` against the actor's rank. A role missing from the table
        therefore ranks as *student* — and any actor holding assign_access could mint it.
        """
        missing = C.CANONICAL_ROLES - set(UserSerializer._ROLE_RANK)
        self.assertEqual(missing, set(), f"roles with no privilege rank: {missing}")

    def test_every_canonical_role_has_a_permission_set(self):
        """``authorize`` reads this map; an absent role gets an empty permission set and is
        denied everywhere with no signal that the role was simply forgotten."""
        missing = C.CANONICAL_ROLES - set(role_permissions_matrix())
        self.assertEqual(missing, set(), f"roles with no permission set: {missing}")

    def test_subject_scoped_staff_is_a_subset_of_canonical_roles(self):
        self.assertTrue(C.SUBJECT_SCOPED_STAFF_ROLES <= C.CANONICAL_ROLES)

    def test_teacher_portal_roles_are_canonical(self):
        self.assertTrue(C.TEACHER_PORTAL_ROLES <= C.CANONICAL_ROLES)


class RoleRecognitionTests(TestCase):
    def test_the_role_survives_normalization(self):
        """``normalized_role`` maps anything it does not recognise to ``student``, so a role
        missing from CANONICAL_ROLES is not merely unprivileged — it is silently a student."""
        self.assertEqual(normalized_role(_support()), C.ROLE_SUPPORT_TEACHER)

    def test_it_is_subject_scoped_not_global(self):
        user = _support()
        self.assertTrue(staff_must_have_subject(user))
        self.assertFalse(is_global_scope_staff(user))

    def test_it_carries_a_domain_subject(self):
        """Every subject-alignment check funnels through this. Returning None here denies the
        role everywhere, regardless of what is stored on the row."""
        self.assertEqual(user_domain_subject(_support(subject=C.DOMAIN_MATH)), C.DOMAIN_MATH)
        self.assertEqual(
            user_domain_subject(_support("sup2@t.com", C.DOMAIN_ENGLISH)), C.DOMAIN_ENGLISH
        )


class PermissionSetTests(TestCase):
    def setUp(self):
        self.user = _support()

    def test_it_can_reach_the_portal_and_sit_an_assessment(self):
        perms = role_permissions_matrix()[C.ROLE_SUPPORT_TEACHER]
        self.assertIn(C.PERM_VIEW_DASHBOARD, perms)
        self.assertIn(C.PERM_SUBMIT_TEST, perms)

    def test_it_authors_nothing_and_manages_nobody(self):
        """The whole point of a separate role: weaker than teacher."""
        perms = role_permissions_matrix()[C.ROLE_SUPPORT_TEACHER]
        for denied in (
            C.PERM_MANAGE_TESTS,
            C.PERM_CREATE_CLASSROOM,
            C.PERM_ASSIGN_ACCESS,
            C.PERM_MANAGE_USERS,
        ):
            self.assertNotIn(denied, perms)

    def test_authorize_refuses_the_permissions_it_does_not_hold(self):
        for denied in (C.PERM_MANAGE_TESTS, C.PERM_CREATE_CLASSROOM, C.PERM_ASSIGN_ACCESS):
            self.assertFalse(
                authorize(self.user, denied, subject=C.SUBJECT_MATH_PLATFORM),
                f"support_teacher must not hold {denied}",
            )

    def test_authorize_grants_a_non_subject_scoped_permission(self):
        self.assertTrue(authorize(self.user, C.PERM_VIEW_DASHBOARD))


class SubjectAlignmentTests(TestCase):
    def setUp(self):
        self.user = _support(subject=C.DOMAIN_MATH)
        UserAccess.objects.create(
            user=self.user, subject=C.DOMAIN_MATH, classroom_id=None, granted_by=self.user
        )
        self.classroom = Classroom.objects.create(
            name="C", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.user,
        )

    def test_global_access_within_its_own_subject(self):
        self.assertTrue(has_global_subject_access(self.user, C.DOMAIN_MATH))

    def test_no_access_to_the_other_subject(self):
        """A Maths support teacher must not turn up as bookable for English."""
        self.assertFalse(has_global_subject_access(self.user, C.DOMAIN_ENGLISH))

    def test_classroom_access_within_its_own_subject(self):
        self.assertTrue(
            has_access_for_classroom(self.user, C.DOMAIN_MATH, self.classroom.id)
        )

    def test_a_support_teacher_without_the_access_row_is_denied(self):
        """The row is created by ``_sync_global_user_access`` on write; without it the role
        holds the right subject and still fails every check."""
        other = _support("sup_norow@t.com", C.DOMAIN_MATH)
        self.assertFalse(has_global_subject_access(other, C.DOMAIN_MATH))


class AccountCreationTests(TestCase):
    def test_a_support_teacher_requires_a_subject(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(
                "nosubj@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER
            )

    def test_model_validation_rejects_a_missing_subject(self):
        from django.core.exceptions import ValidationError

        user = User(email="clean@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=None)
        with self.assertRaises(ValidationError):
            user.clean()

    def test_a_valid_support_teacher_passes_validation(self):
        user = User(email="ok@t.com", role=C.ROLE_SUPPORT_TEACHER, subject=C.DOMAIN_MATH)
        user.clean()   # must not raise


class PortalAccessTests(TestCase):
    def test_support_teachers_are_admitted_to_the_teacher_portal(self):
        self.assertIn(C.ROLE_SUPPORT_TEACHER, C.TEACHER_PORTAL_ROLES)

    def test_admins_are_still_kept_off_the_teacher_portal(self):
        """Deliberately role-based, not permission-based — admin and test_admin hold staff
        permissions elsewhere but do not belong on this subdomain."""
        self.assertNotIn(C.ROLE_ADMIN, C.TEACHER_PORTAL_ROLES)
        self.assertNotIn(C.ROLE_TEST_ADMIN, C.TEACHER_PORTAL_ROLES)
