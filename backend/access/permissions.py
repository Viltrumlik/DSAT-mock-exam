"""DRF permission classes built on permission codenames (no role string checks in views)."""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from . import constants
from .services import (
    can_approve_assessment,
    can_edit_tests,
    actor_subject_probe_for_domain_perm,
    authorize,
    can_view_tests,
    can_assign_tests,
    can_manage_questions,
    get_effective_permission_codenames,
    is_global_scope_staff,
    normalized_role,
)


class CanManageQuestions(BasePermission):
    """
    CRUD on ``/api/exams/admin/`` (mocks, pastpapers, tests, modules, questions).
    Global staff only; Django superusers always allowed.
    """

    def has_permission(self, request, view):
        return can_manage_questions(request.user)

    def has_object_permission(self, request, view, obj):
        return can_manage_questions(request.user)


class CanManageJournals(BasePermission):
    """
    Author Journals (course homework plans) under ``/api/journals/``.

    Global staff ONLY (admin / test_admin / super_admin / Django superuser). Teachers are
    intentionally excluded: journals are prepared by admins, and teachers must never author
    homework in this system.
    """

    def has_permission(self, request, view):
        return is_global_scope_staff(request.user)

    def has_object_permission(self, request, view, obj):
        return is_global_scope_staff(request.user)


class CanCreateMockSessions(BasePermission):
    """Mint an invigilated mock sitting and its access code — ADMIN only.

    Deliberately narrower than ``CanRunMockSessions``: an admin decides that a sitting
    happens and owns the code; a teacher runs the room on the day. Teachers are excluded
    here for the same reason they are excluded from journals — scheduling a whole-school
    exam is not a classroom decision.
    """

    def has_permission(self, request, view):
        return is_global_scope_staff(request.user)

    def has_object_permission(self, request, view, obj):
        return is_global_scope_staff(request.user)


class CanRunMockSessions(BasePermission):
    """Approve join requests, press Start, close the room — teacher OR admin.

    The teacher is the person actually standing in front of the students, so they hold the
    controls that have to be used at the moment the exam runs.
    """

    def has_permission(self, request, view):
        user = request.user
        if is_global_scope_staff(user):
            return True
        return normalized_role(user) == constants.ROLE_TEACHER

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class HasLMSPermission(BasePermission):
    """Set ``permission_codename`` on the view or subclass."""

    permission_codename: str = ""

    def has_permission(self, request, view):
        code = getattr(view, "permission_codename", None) or self.permission_codename
        if not code:
            return False
        subj = getattr(view, "permission_subject", None)
        return authorize(request.user, code, subject=subj)


class HasManageUsers(BasePermission):
    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and authorize(request.user, constants.PERM_MANAGE_USERS, subject=subj))


class HasManageUsersOrAssignTestAccess(BasePermission):
    """List users for admin UI: user managers or subject-scoped staff who can assign access."""

    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(
            subj
            and (
                authorize(request.user, constants.PERM_MANAGE_USERS, subject=subj)
                or authorize(request.user, constants.PERM_ASSIGN_ACCESS, subject=subj)
            )
        )


class HasManageRoles(BasePermission):
    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and authorize(request.user, constants.PERM_ASSIGN_ACCESS, subject=subj))


class HasManageClassrooms(BasePermission):
    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and authorize(request.user, constants.PERM_CREATE_CLASSROOM, subject=subj))


class RequiresSubmitTest(BasePermission):
    """Student test-taking flows (attempts, modules, review)."""

    def has_permission(self, request, view):
        return authorize(request.user, constants.PERM_SUBMIT_TEST)


class CanViewTests(BasePermission):
    """
    View test-like library content (list/retrieve).
    Uses access.services.can_view_tests with a safe platform-subject probe.
    """

    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and can_view_tests(request.user, subj))


class CanEditTests(BasePermission):
    """
    Edit test-like content (create/update/delete).
    Uses access.services.can_edit_tests with a safe platform-subject probe.
    """

    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and can_edit_tests(request.user, subj))


class CanAuthorAssessmentContent(BasePermission):
    """
    Create/update/delete ``/api/assessments/admin/`` sets and questions.

    Allowed for global staff (admin / test_admin / super_admin / Django superuser)
    AND teachers — teachers prepare and assign assessments to their own classrooms,
    so they need authoring rights as well.
    """

    def has_permission(self, request, view):
        u = request.user
        if not getattr(u, "is_authenticated", False):
            return False
        subj = actor_subject_probe_for_domain_perm(u)
        if not subj:
            return False
        if is_global_scope_staff(u) and can_edit_tests(u, subj):
            return True
        # Teachers also author assessments for their classrooms.
        if normalized_role(u) == constants.ROLE_TEACHER and can_edit_tests(u, subj):
            return True
        return False


class CanApproveAssessmentContent(BasePermission):
    """
    Approve an assessment set (transition it to ``approved``).

    Stricter than :class:`CanAuthorAssessmentContent`: authoring is open to teachers
    and self-scoped test_admins, but only Django superusers and admin / super_admin
    may approve. See :func:`access.services.can_approve_assessment`.
    """

    def has_permission(self, request, view):
        return can_approve_assessment(request.user)


class CanAssignTests(BasePermission):
    """
    Assign tests/sets into classrooms (homework).
    """

    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and can_assign_tests(request.user, subj))


class IsSuperAdmin(BasePermission):
    """super_admin (or a Django superuser) and nobody else.

    Narrower than :class:`CanManageQuestions` and than ``is_global_scope_staff`` on purpose.
    Used by the question CSV exports: the school asked for those as a super_admin review
    tool, and a whole test's answer key leaving the building as a file is a different act
    from reading the same questions one at a time in the builder. Widening it is a one-line
    change if they decide test_admin should download their own work.
    """

    def has_permission(self, request, view):
        return bool(getattr(request.user, "is_superuser", False)) or normalized_role(
            request.user
        ) == constants.ROLE_SUPER_ADMIN

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class CanAuthorVocabulary(BasePermission):
    """
    Author the vocabulary bank (sections / sets / words) under ``/api/vocabulary/admin/``.

    Builder staff ONLY (admin / test_admin / test_auditor / super_admin / Django
    superuser). Deliberately NOT :class:`CanManageQuestions`, whose ``can_manage_questions``
    also returns True for teachers: a teacher only *assigns* an existing vocabulary set as
    homework and never authors the bank. Vocabulary is subject-agnostic, so there is no
    domain-subject probe either — every builder sees every section.
    """

    def has_permission(self, request, view):
        return is_global_scope_staff(request.user)

    def has_object_permission(self, request, view, obj):
        return is_global_scope_staff(request.user)
