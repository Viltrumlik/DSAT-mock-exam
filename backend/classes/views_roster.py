"""Roster / member management API (TA rollout).

GET   /api/classes/<pk>/members/                → roster (non-removed; ?include_removed=1 for all)
POST  /api/classes/<pk>/members/  { user_id }    → code-less student enrollment (admins only)
PATCH /api/classes/<pk>/members/<user_id>/  { role?, status? }

Per the finalized capability matrix:
  - Assigning/revoking TA or TEACHER (role change)  → Owner only (can_assign_ta)
  - Removing/restoring a STUDENT (status change)      → Teacher+Owner (can_manage_roster)
  - Code-less ADD of a student                        → global admin only (super_admin/admin);
        teachers keep the join-code flow. Mirrors JoinClassView (reactivate REMOVED, enforce
        max_students, create the subject UserAccess grant).
The class owner's membership can never be changed or removed here.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.response import Response

from access import constants as acc_const
from access.models import UserAccess
from .capabilities import classroom_capabilities, is_global_admin
from .models import Classroom, ClassroomMembership
from .serializers import ClassroomMembershipSerializer
from .views_rankings import _ClassroomScopedView, _display_name

User = get_user_model()

_ASSIGNABLE_ROLES = {ClassroomMembership.ROLE_TA, ClassroomMembership.ROLE_TEACHER, ClassroomMembership.ROLE_STUDENT}
_OWNER_ROLES = {ClassroomMembership.ROLE_OWNER, ClassroomMembership.ROLE_ADMIN}
_TRUTHY = {"1", "true", "yes", "on"}


class MemberManageView(_ClassroomScopedView):
    def patch(self, request, classroom_pk, user_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        membership = get_object_or_404(ClassroomMembership, classroom=classroom, user_id=user_id)

        if membership.role in _OWNER_ROLES:
            return Response({"detail": "The class owner cannot be modified here."}, status=http.HTTP_400_BAD_REQUEST)

        new_role = request.data.get("role")
        new_status = request.data.get("status")
        if new_role is None and new_status is None:
            return Response({"detail": "Provide role and/or status."}, status=http.HTTP_400_BAD_REQUEST)

        if new_role is not None:
            if new_role not in _ASSIGNABLE_ROLES:
                return Response({"detail": "Invalid role."}, status=http.HTTP_400_BAD_REQUEST)
            # Promoting/demoting between staff and student is an ownership decision.
            if not caps.can_assign_ta:
                return Response({"detail": "Only the class owner can change member roles."}, status=http.HTTP_403_FORBIDDEN)
            membership.role = new_role

        if new_status is not None:
            if new_status not in (ClassroomMembership.STATUS_ACTIVE, ClassroomMembership.STATUS_REMOVED):
                return Response({"detail": "Invalid status."}, status=http.HTTP_400_BAD_REQUEST)
            target_is_staff = membership.role in ClassroomMembership.STAFF_ROLES
            allowed = caps.can_assign_ta if target_is_staff else caps.can_manage_roster
            if not allowed:
                return Response({"detail": "You do not have permission to change this member."}, status=http.HTTP_403_FORBIDDEN)
            membership.status = new_status

        membership.save(update_fields=["role", "status"])
        return Response({
            "user_id": membership.user_id,
            "name": _display_name(membership.user),
            "role": membership.role,
            "status": membership.status,
        })


class ClassroomRosterView(_ClassroomScopedView):
    """Roster read + code-less student enrollment, primarily for the ops admin panel.

    GET is available to any class member (global admins included via IsClassMemberCap, so an
    ops admin can inspect any classroom's roster). POST (code-less add) is restricted to
    global admins — ordinary teachers keep the join-code enrollment path.
    """

    def get(self, request, classroom_pk):
        classroom = self.get_classroom()
        memberships = classroom.memberships.select_related("user").order_by("role", "-joined_at")
        include_removed = str(request.query_params.get("include_removed", "")).strip().lower() in _TRUTHY
        if not include_removed:
            memberships = memberships.exclude(status=ClassroomMembership.STATUS_REMOVED)
        return Response(
            ClassroomMembershipSerializer(memberships, many=True, context={"request": request}).data
        )

    def post(self, request, classroom_pk):
        classroom = self.get_classroom()
        # Code-less enrollment is an admin governance action. Teachers still use the join code,
        # matching the existing People-page UX (no teacher-side add-student control exists).
        if not is_global_admin(request.user):
            return Response(
                {"detail": "Only administrators can add a student without a join code."},
                status=http.HTTP_403_FORBIDDEN,
            )

        user_id = request.data.get("user_id")
        if not user_id:
            return Response({"detail": "Provide user_id."}, status=http.HTTP_400_BAD_REQUEST)
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            return Response({"detail": "User not found."}, status=http.HTTP_404_NOT_FOUND)
        if str(getattr(target, "role", "") or "").strip().lower() != acc_const.ROLE_STUDENT:
            return Response(
                {"detail": "Only student accounts can be enrolled here. Assign teachers via the teacher tools."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        existing = ClassroomMembership.objects.filter(classroom=classroom, user=target).first()
        if existing is not None and existing.role in ClassroomMembership.STAFF_ROLES:
            return Response(
                {"detail": "This user is a staff member of this class; manage their role via the teacher tools."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        # Enforce max_students exactly like JoinClassView: a returning (already-a-member, even
        # if REMOVED) student is a reactivation, not a net-new seat, so it bypasses the cap.
        if classroom.max_students is not None and existing is None:
            current_students = (
                classroom.memberships.filter(role=ClassroomMembership.ROLE_STUDENT)
                .exclude(status=ClassroomMembership.STATUS_REMOVED)
                .count()
            )
            if current_students >= classroom.max_students:
                return Response({"detail": "This group is full."}, status=http.HTTP_400_BAD_REQUEST)

        membership, created = ClassroomMembership.objects.get_or_create(
            classroom=classroom, user=target, defaults={"role": ClassroomMembership.ROLE_STUDENT}
        )
        # Reactivate a previously-removed student — get_or_create's defaults only apply on
        # create, so a stale REMOVED row would otherwise leave the student locked out.
        if not created and membership.status != ClassroomMembership.STATUS_ACTIVE:
            membership.status = ClassroomMembership.STATUS_ACTIVE
            membership.save(update_fields=["status"])

        # Per-classroom subject access grant — parity with JoinClassView so the enrolled
        # student can actually enter the subject's content.
        dom = (
            acc_const.DOMAIN_MATH
            if classroom.subject == Classroom.SUBJECT_MATH
            else acc_const.DOMAIN_ENGLISH
        )
        UserAccess.objects.get_or_create(
            user=target, subject=dom, classroom=classroom, defaults={"granted_by": request.user}
        )
        return Response(
            {
                "user_id": target.pk,
                "name": _display_name(target),
                "role": membership.role,
                "status": membership.status,
                "created": created,
            },
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )
