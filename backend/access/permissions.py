"""DRF permission classes built on permission codenames (no role string checks in views)."""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from . import constants
from .services import (
    can_edit_tests,
    actor_subject_probe_for_domain_perm,
    authorize,
    can_view_tests,
    can_assign_tests,
    can_manage_questions,
    can_publish_questions,
    get_effective_permission_codenames,
    is_global_scope_staff,
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


class CanPublishQuestions(BasePermission):
    """Approve or reject questions after review (admin / super_admin / superuser)."""

    def has_permission(self, request, view):
        return can_publish_questions(request.user)

    def has_object_permission(self, request, view, obj):
        return can_publish_questions(request.user)


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

    Narrower than :class:`CanEditTests`: **global staff only** (admin / test_admin / super_admin /
    Django superuser). Teachers may list sets (for assignment UX) via :class:`CanViewTests` but must
    not mutate assessment catalogue content — authoring lives with library staff on the questions
    console; teachers assign on the admin console.
    """

    def has_permission(self, request, view):
        u = request.user
        if not getattr(u, "is_authenticated", False):
            return False
        if not is_global_scope_staff(u):
            return False
        subj = actor_subject_probe_for_domain_perm(u)
        return bool(subj and can_edit_tests(u, subj))


class CanAssignTests(BasePermission):
    """
    Assign tests/sets into classrooms (homework).
    """

    def has_permission(self, request, view):
        subj = actor_subject_probe_for_domain_perm(request.user)
        return bool(subj and can_assign_tests(request.user, subj))
