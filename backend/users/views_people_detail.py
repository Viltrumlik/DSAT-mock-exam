"""/ops person pages: ``GET /api/users/admin/people/<id>/`` and its parts (plan 2026-10-15-ops-detail-pages).

Whoever can see a person in the people lists can open them; anyone else, and a missing id, get 404.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import HasManageUsers, HasManageUsersOrAssignTestAccess

from . import admin_audit
from .models import RefreshSession
from .people_detail import person_core
from .people_parts import PARTS
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


class PersonPartView(APIView):
    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request, pk: int, part: str):
        build = PARTS.get(part)
        user = scoped_person(request, pk) if build else None
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(build(user))


class PersonRevokeSessionsView(APIView):
    """POST — sign this account out of every device. An open tab keeps its access token until it expires."""

    permission_classes = [HasManageUsers]

    def post(self, request, pk: int):
        from .views import _revoke_session_rows

        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        if user.pk == request.user.pk:
            return Response({"detail": "Use your own account's sign-out instead."}, status=400)
        n = _revoke_session_rows(RefreshSession.objects.filter(user=user, revoked_at__isnull=True))
        admin_audit.log_admin_action(request=request, user_id=user.pk, event_type=admin_audit.ADMIN_REVOKE_SESSIONS,
                                     sessions=n)
        return Response({"revoked": n})
