"""/ops Classrooms: changelist, change form and its parts (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.changelist import apply_search, facets, paginate

from .models import Classroom
from .ops_classrooms import (
    CLASS_FILTERS, CLASS_ORDERING, CLASS_PARTS, CLASS_SEARCH, STUDENT_SEATS, class_row, classroom_core,
)


def is_ops_admin(user) -> bool:
    """The governance rule (views_assign._AdminClassroomGovernanceView._guard): superuser, super_admin, admin."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    return str(getattr(user, "role", "") or "").strip().lower() in ("super_admin", "admin")


class ClassroomChangeListView(APIView):
    """``GET /api/classes/admin/classrooms/`` — every class: search, filters with counts, ordering, pages."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from lcup.guards import lcup_managed_ids

        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        params = request.query_params
        qs = Classroom.objects.all()
        # A teacher-name search joins one teacher per class (a foreign key), so it cannot repeat a row.
        qs = apply_search(qs, params.get("q") or "", CLASS_SEARCH)
        qs, filters = facets(qs, CLASS_FILTERS, params)
        # Seats are counted after the facets, so no facet query carries the memberships join.
        qs = qs.select_related("teacher", "branch").annotate(students=STUDENT_SEATS)
        ordering = params.get("o") or "-created"
        if ordering not in CLASS_ORDERING:
            ordering = "-created"
        window, meta = paginate(qs.order_by(*CLASS_ORDERING[ordering], "-pk"), params)
        rooms = list(window)
        managed = lcup_managed_ids(r.pk for r in rooms)
        return Response({**meta, "ordering": ordering, "results": [class_row(r, managed) for r in rooms],
                         "filters": filters})


class ClassroomDetailView(APIView):
    """``GET /api/classes/admin/classrooms/<pk>/`` — what the class's change form opens with."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        room = Classroom.objects.select_related("teacher", "branch").filter(pk=pk).first()
        if room is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(classroom_core(room))


class ClassroomPartView(APIView):
    """``GET /api/classes/admin/classrooms/<pk>/<part>/`` — roster, attendance, homework or history, each on its
    own, so a slow or failing part never blanks the page."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int, part: str):
        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        build = CLASS_PARTS.get(part)
        room = Classroom.objects.filter(pk=pk).first() if build else None
        if room is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(build(room))
