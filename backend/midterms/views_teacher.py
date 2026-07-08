"""Teacher-panel STANDALONE midterm endpoints.

The standalone "Midterms" area: a teacher opens a midterm, grants access to individual
students, and (beside the access control) sees each student's Results. When a student
finishes, the attempt auto-grades and issues a certificate whose instructor = the granting
teacher; there is NO class ranking (that is the classroom flavor, handled in `classes`).

Access is a per-student ``ResourceAccessGrant`` (resource_type ``midterm_v2``, classroom=NULL,
granted_by=the teacher). Mounted under /api/midterms/teacher/.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from access.constants import ROLE_ADMIN, ROLE_SUPER_ADMIN, ROLE_TEACHER
from access.engine.assignment_service import AssignmentService
from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from access.services import normalized_role

from .models import Midterm, MidtermAttempt

User = get_user_model()

_STAFF_ROLES = {ROLE_TEACHER, ROLE_ADMIN, ROLE_SUPER_ADMIN}


class IsTeacherOrStaff(BasePermission):
    message = "Only teachers or staff may manage midterm access."

    def has_permission(self, request, view):
        u = getattr(request, "user", None)
        if not (u and u.is_authenticated):
            return False
        return bool(normalized_role(u) in _STAFF_ROLES or u.is_staff or u.is_superuser)


def _display_name(user) -> str:
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    return full or getattr(user, "username", None) or getattr(user, "email", "") or f"User {user.pk}"


def _midterm_brief(m: Midterm) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "subject": m.subject,
        "scoring_scale": m.scoring_scale,
        "score_ceiling": m.score_ceiling,
        "duration_minutes": m.duration_minutes,
        "question_count": m.questions().count(),
        "is_published": m.is_published,
    }


class MidtermCatalogView(APIView):
    """GET /midterms/teacher/midterms/ — published midterms a teacher can assign standalone."""

    permission_classes = [IsTeacherOrStaff]

    def get(self, request):
        qs = Midterm.objects.filter(is_published=True).order_by("-created_at")
        return Response({"results": [_midterm_brief(m) for m in qs]})


def _standalone_grants(midterm_id: int):
    return ResourceAccessGrant.objects.filter(
        scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM_V2,
        resource_id=midterm_id,
        status=ResourceAccessGrant.STATUS_ACTIVE,
        classroom__isnull=True,
    )


class MidtermGrantView(APIView):
    """POST /midterms/teacher/midterms/<pk>/grant/ {user_ids:[...], expires_at?} — grant standalone access."""

    permission_classes = [IsTeacherOrStaff]

    def post(self, request, pk=None):
        midterm = get_object_or_404(Midterm, pk=pk)
        user_ids = request.data.get("user_ids") or ([request.data["user_id"]] if request.data.get("user_id") else [])
        try:
            user_ids = [int(x) for x in user_ids]
        except (TypeError, ValueError):
            return Response({"detail": "user_ids must be integers."}, status=400)
        if not user_ids:
            return Response({"detail": "user_ids is required."}, status=400)
        students = list(User.objects.filter(pk__in=user_ids))
        expires_at = request.data.get("expires_at") or None
        granted = []
        for student in students:
            AssignmentService.assign_resource(
                student,
                RT_MIDTERM_V2,
                midterm.id,
                actor=request.user,
                source=ResourceAccessGrant.SOURCE_MANUAL,
                classroom=None,
                expires_at=expires_at,
                note="teacher standalone midterm grant",
            )
            granted.append(student.id)
        return Response({"granted": granted, "midterm_id": midterm.id}, status=status.HTTP_201_CREATED)


class MidtermRevokeView(APIView):
    """POST /midterms/teacher/midterms/<pk>/revoke/ {user_ids:[...]} — revoke standalone access."""

    permission_classes = [IsTeacherOrStaff]

    def post(self, request, pk=None):
        midterm = get_object_or_404(Midterm, pk=pk)
        user_ids = request.data.get("user_ids") or ([request.data["user_id"]] if request.data.get("user_id") else [])
        try:
            user_ids = [int(x) for x in user_ids]
        except (TypeError, ValueError):
            return Response({"detail": "user_ids must be integers."}, status=400)
        revoked = 0
        for student in User.objects.filter(pk__in=user_ids):
            revoked += AssignmentService.revoke_resource(
                student, RT_MIDTERM_V2, midterm.id, actor=request.user, note="teacher standalone revoke"
            )
        return Response({"revoked": revoked, "midterm_id": midterm.id})


class MidtermStandaloneResultsView(APIView):
    """GET /midterms/teacher/midterms/<pk>/results/ — grantees + attempt status + frozen score.

    This is the 'Results' surface that sits beside the access control in the standalone area.
    Teachers always see the actual score (the student-side release gate does not apply here).
    """

    permission_classes = [IsTeacherOrStaff]

    def get(self, request, pk=None):
        midterm = get_object_or_404(Midterm, pk=pk)
        grants = _standalone_grants(midterm.id).select_related("user", "granted_by")
        # Latest attempt per student for this midterm.
        attempts = {
            a.student_id: a
            for a in MidtermAttempt.objects.filter(midterm=midterm).order_by("created_at")
        }
        rows = []
        for g in grants:
            student = g.user
            att = attempts.get(student.id)
            rows.append(
                {
                    "student_id": student.id,
                    "student_name": _display_name(student),
                    "instructor_id": g.granted_by_id,
                    "instructor_name": _display_name(g.granted_by) if g.granted_by_id else None,
                    "state": att.current_state if att else "NOT_STARTED",
                    "submitted": bool(att and att.is_completed),
                    "score": att.score if (att and att.is_completed) else None,
                    "score_ceiling": midterm.score_ceiling,
                }
            )
        rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["student_name"]))
        return Response({"midterm": _midterm_brief(midterm), "students": rows})
