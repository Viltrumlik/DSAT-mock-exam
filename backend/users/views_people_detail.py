"""/ops person pages: ``GET /api/users/admin/people/<id>/`` and its parts (plan 2026-10-15-ops-detail-pages).

Whoever can see a person in the people lists can open them; anyone else, and a missing id, get 404.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from django.db import transaction

from access import constants as C
from access.models import Permission, UserPermission
from access.permissions import HasManageUsers, Requires
from access.services import get_effective_permission_codenames, normalized_role, role_permissions_matrix

from . import admin_audit
from .account_rank import OWNER_ONLY, account_rank, is_staff_account, may_change_account
from .models import RefreshSession
from .people_detail import person_core
from .people_parts import PARTS
from .phone_utils import clean_parent_phone
from .views import manageable_users_queryset


def scoped_person(request, pk):
    return manageable_users_queryset(request.user).filter(pk=pk).first()


class PersonDetailView(APIView):
    permission_classes = [Requires(C.PERM_VIEW_PEOPLE)]

    def get(self, request, pk: int):
        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(person_core(user, request))


class PersonParentView(APIView):
    """PATCH {parent_name?, parent_phone?} — whom to call about this learner. ``edit_people`` only, unlike the rest
    of the page. Its own endpoint because ``UserUpdateView``'s serializer also answers teachers. The log names the
    fields and not the values, since the person's History is read more widely than the details are."""

    permission_classes = [Requires(C.PERM_EDIT_PEOPLE)]

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
    permission_classes = [Requires(C.PERM_VIEW_PEOPLE)]

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
        if not may_change_account(request.user, user):
            return Response({"detail": OWNER_ONLY}, status=403)
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
        if not may_change_account(request.user, user):  # e.g. a Django superuser whose role string says teacher
            return Response({"detail": OWNER_ONLY}, status=403)
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


# ── staff: per-person permissions and access (plan 2026-11-12-crm-roles, PR 4; the owner's alone) ──────────


def _is_owner_account(user) -> bool:
    return account_rank(user) >= account_rank_of_owner()


def account_rank_of_owner() -> int:
    from .serializers import UserSerializer

    return UserSerializer._ROLE_RANK[C.ROLE_SUPER_ADMIN]


def permissions_state(user) -> dict:
    """The role's preset and the owner's ticks, over the permissions a tick may move."""
    preset = role_permissions_matrix().get(normalized_role(user), frozenset())
    ticks = {
        row.permission.codename: row.granted
        for row in UserPermission.objects.filter(user=user, permission__codename__in=C.TICKABLE_PERMISSION_CODENAMES)
        .select_related("permission")
    }
    effective = get_effective_permission_codenames(user)
    return {
        "role": user.role,
        "tickable": list(C.TICKABLE_PERMISSION_CODENAMES),
        "preset": [code for code in C.TICKABLE_PERMISSION_CODENAMES if code in preset],
        "ticks": ticks,
        "effective": [code for code in C.TICKABLE_PERMISSION_CODENAMES if code in effective or C.WILDCARD in effective],
    }


class PersonPermissionsView(APIView):
    """GET / PUT a staff person's permissions. PUT ``{"ticks": {codename: true | false | null}}``: true gives one the
    role does not, false takes one the role gives, null goes back to the role's preset. A tick equal to the preset
    is not stored. Never the owner's account, a learner's, or ``manage_staff``."""

    permission_classes = [Requires(C.PERM_MANAGE_STAFF)]

    def _target(self, request, pk):
        user = scoped_person(request, pk)
        if user is None:
            return None, Response({"detail": "Not found."}, status=404)
        if not is_staff_account(user) or _is_owner_account(user):
            return None, Response({"detail": "Permissions are ticked for staff other than the owner."}, status=400)
        return user, None

    def get(self, request, pk: int):
        user, refused = self._target(request, pk)
        return refused or Response(permissions_state(user))

    def put(self, request, pk: int):
        user, refused = self._target(request, pk)
        if refused:
            return refused
        ticks = request.data.get("ticks") if isinstance(request.data, dict) else None
        if not isinstance(ticks, dict) or not ticks:
            return Response({"detail": "Send ticks: {permission: true, false or null}."}, status=400)
        unknown = sorted(code for code in ticks if code not in C.TICKABLE_PERMISSION_CODENAMES)
        if unknown:
            return Response({"detail": f"These cannot be ticked: {', '.join(unknown)}."}, status=400)
        if any(value not in (True, False, None) for value in ticks.values()):
            return Response({"detail": "Each tick is true, false or null."}, status=400)
        preset = role_permissions_matrix().get(normalized_role(user), frozenset())
        before = permissions_state(user)["ticks"]
        with transaction.atomic():
            for code, value in ticks.items():
                permission, _ = Permission.objects.get_or_create(codename=code, defaults={"name": code})
                if value is None or value == (code in preset):
                    UserPermission.objects.filter(user=user, permission=permission).delete()
                else:
                    UserPermission.objects.update_or_create(user=user, permission=permission, defaults={"granted": value})
        state = permissions_state(user)
        changed = {code: state["ticks"].get(code) for code in ticks if before.get(code) != state["ticks"].get(code)}
        if changed:
            admin_audit.log_admin_action(
                request=request, user_id=user.pk, event_type=admin_audit.ADMIN_PERMISSIONS, ticks=changed
            )
        return Response(state)


class PersonAccessView(APIView):
    """POST ``{"active": false}`` — turn off an employee's access: the account can no longer sign in, and every
    device is signed out at once. ``{"active": true}`` turns it back on. Staff accounts only (a learner is frozen
    instead), never your own."""

    permission_classes = [Requires(C.PERM_MANAGE_STAFF)]

    def post(self, request, pk: int):
        from .views import _revoke_session_rows

        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        active = request.data.get("active") if isinstance(request.data, dict) else None
        if not isinstance(active, bool):
            return Response({"detail": "Send active: true or false."}, status=400)
        if user.pk == request.user.pk:
            return Response({"detail": "Not your own account."}, status=400)
        if not is_staff_account(user):
            return Response({"detail": "A learner is frozen, not turned off."}, status=400)
        if not may_change_account(request.user, user):
            return Response({"detail": OWNER_ONLY}, status=403)
        revoked = 0
        if user.is_active != active:
            user.is_active = active
            user.save(update_fields=["is_active"])
            if not active:
                revoked = _revoke_session_rows(RefreshSession.objects.filter(user=user, revoked_at__isnull=True))
            admin_audit.log_admin_action(
                request=request,
                user_id=user.pk,
                event_type=admin_audit.ADMIN_ACCESS_ON if active else admin_audit.ADMIN_ACCESS_OFF,
                sessions=revoked,
            )
        return Response({"active": user.is_active, "revoked": revoked})
