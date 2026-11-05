"""/ops person pages: ``GET /api/users/admin/people/<id>/`` and its parts (plan 2026-10-15-ops-detail-pages).

Whoever can see a person in the people lists can open them; anyone else, and a missing id, get 404.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import HasManageUsers, HasManageUsersOrAssignTestAccess
from billing.views import IsGlobalAdmin

from . import admin_audit
from .models import RefreshSession
from .people_detail import person_core
from .people_parts import PARTS
from .phone_utils import clean_parent_phone
from .views import manageable_users_queryset


def scoped_person(request, pk):
    return manageable_users_queryset(request.user).filter(pk=pk).first()


class PersonDetailView(APIView):
    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request, pk: int):
        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(person_core(user, request))


class PersonParentView(APIView):
    """PATCH {parent_name?, parent_phone?} — whom to call about this learner. Admins only, unlike the rest of the
    page. Its own endpoint because ``UserUpdateView``'s serializer also answers teachers. The log names the fields
    and not the values, since the person's History is read more widely than the details are."""

    permission_classes = [IsGlobalAdmin]

    def patch(self, request, pk: int):
        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        if user.role not in C.LEARNER_ROLES:
            return Response({"detail": "Only a learner has a parent here."}, status=400)
        changes = {}
        if "parent_name" in request.data:
            changes["parent_name"] = str(request.data["parent_name"] or "").strip()[:200]
        if "parent_phone" in request.data:
            try:
                changes["parent_phone"] = clean_parent_phone(request.data["parent_phone"])
            except ValueError as refused:
                return Response({"detail": f"Parent's phone: {refused}"}, status=400)
        changes = {field: value for field, value in changes.items() if getattr(user, field) != value}
        if changes:
            for field, value in changes.items():
                setattr(user, field, value)
            user.save(update_fields=list(changes))
            admin_audit.log_admin_action(
                request=request, user_id=user.pk, event_type=admin_audit.ADMIN_UPDATE, changes=dict.fromkeys(changes)
            )
        return Response({"name": user.parent_name, "phone": user.parent_phone})


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


#: Who may be given a one-time password here: learners and teaching staff. An admin's password is
#: not reset to four guessable digits from a console another admin can open.
ONE_TIME_PASSWORD_ROLES = {"student", "public_student", "teacher", "support_teacher"}


class PersonOneTimePasswordView(APIView):
    """POST — remove the account's password; it signs in once with its phone and that phone's last four
    digits, then must choose a new one (owner, 2026-10-15). Every device is signed out with it."""

    permission_classes = [HasManageUsers]

    def post(self, request, pk: int):
        from django.utils import timezone

        from lcup.accounts import OneTimePasswordRefused, issue_one_time_password

        from .people_detail import iso
        from .views import _revoke_session_rows

        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        if user.pk == request.user.pk:
            return Response({"detail": "Change your own password from your profile."}, status=400)
        if (user.role or "").strip().lower() not in ONE_TIME_PASSWORD_ROLES:
            return Response({"detail": "An administrator's password is not reset from here."}, status=400)
        try:
            claim = issue_one_time_password(user, now=timezone.now())
        except OneTimePasswordRefused as refused:
            return Response({"detail": str(refused)}, status=409)
        n = _revoke_session_rows(RefreshSession.objects.filter(user=user, revoked_at__isnull=True))
        admin_audit.log_admin_action(
            request=request, user_id=user.pk, event_type=admin_audit.ADMIN_ONE_TIME_PASSWORD, sessions=n
        )
        # The code is the phone's last four digits — on the admin's screen already; returned so the
        # page can say exactly what to tell the student.
        return Response({"login": claim.phone, "code": claim.phone[-4:], "expires_at": iso(claim.expires_at)})
