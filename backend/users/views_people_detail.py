"""/ops person pages: ``GET /api/users/admin/people/<id>/`` and its parts (plan 2026-10-15-ops-detail-pages).

Whoever can see a person in the people lists can open them; anyone else, and a missing id, get 404.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import HasManageUsersOrAssignTestAccess

from .people_detail import person_core
from .views import manageable_users_queryset


def scoped_person(request, pk):
    return manageable_users_queryset(request.user).filter(pk=pk).first()


class PersonDetailView(APIView):
    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request, pk: int):
        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(person_core(user))
