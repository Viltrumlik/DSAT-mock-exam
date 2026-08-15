"""Regions and branches — the reference data every branch board depends on.

These exist because the derivation had nowhere to derive *from*. A student's branch comes from
their classroom's branch, and that is the whole rule — but with no way to create a branch and
no way to put a classroom in one, every student resolved to no branch, the "My Branch" tab
hid itself, and the feature was inert on a live deployment. Django admin could do it; the
school does not use Django admin.

Staff only, and deliberately not deletable over HTTP. A branch is pointed at by classrooms and
a region by branches, both with PROTECT — a delete would either fail with an integrity error
or, worse, be made to work by cascading and take the classrooms with it. Deactivating is the
supported way to retire one, which is why `is_active` is writable and DELETE is absent.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as acc_const
from access.services import is_global_scope_staff, normalized_role

from .models_org import Branch, Region


def _is_org_staff(user) -> bool:
    """Who may shape the school's own structure: global staff, never a teacher.

    A teacher owning a classroom must not be able to move it to another branch — that would
    move their students onto a different leaderboard, which is a school-level decision.
    """
    return bool(getattr(user, "is_superuser", False)) or normalized_role(user) in (
        acc_const.ROLE_SUPER_ADMIN,
        acc_const.ROLE_ADMIN,
    )


def _region_json(region) -> dict:
    return {
        "id": region.pk,
        "name": region.name,
        "code": region.code,
        "is_active": region.is_active,
        "branch_count": getattr(region, "branch_count", None),
    }


def _branch_json(branch) -> dict:
    return {
        "id": branch.pk,
        "name": branch.name,
        "code": branch.code,
        "address": branch.address,
        "is_active": branch.is_active,
        "region": branch.region_id,
        "region_name": branch.region.name,
        "classroom_count": getattr(branch, "classroom_count", None),
    }


class _OrgStaffView(APIView):
    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        if not (_is_org_staff(request.user) or is_global_scope_staff(request.user)):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


class RegionListCreateView(_OrgStaffView):
    def get(self, request):
        from django.db.models import Count

        denied = self._guard(request)
        if denied:
            return denied
        regions = Region.objects.annotate(branch_count=Count("branches"))
        return Response({"regions": [_region_json(r) for r in regions]})

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "Give the region a name."}, status=400)
        if Region.objects.filter(name__iexact=name).exists():
            # Checked explicitly rather than left to the unique constraint: two regions
            # differing only by case would split a leaderboard and read as a database error
            # rather than as the duplicate it is.
            return Response({"detail": f"“{name}” already exists."}, status=400)
        region = Region.objects.create(
            name=name, code=(request.data.get("code") or "").strip()[:16]
        )
        return Response(_region_json(region), status=http.HTTP_201_CREATED)


class RegionDetailView(_OrgStaffView):
    def patch(self, request, region_id):
        denied = self._guard(request)
        if denied:
            return denied
        region = get_object_or_404(Region, pk=region_id)
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "Give the region a name."}, status=400)
            region.name = name
        if "code" in request.data:
            region.code = (request.data.get("code") or "").strip()[:16]
        if "is_active" in request.data:
            region.is_active = bool(request.data.get("is_active"))
        region.save()
        return Response(_region_json(region))


class BranchListCreateView(_OrgStaffView):
    def get(self, request):
        from django.db.models import Count

        denied = self._guard(request)
        if denied:
            return denied
        branches = (
            Branch.objects.select_related("region").annotate(classroom_count=Count("classrooms"))
        )
        return Response({"branches": [_branch_json(b) for b in branches]})

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        name = (request.data.get("name") or "").strip()
        region_id = request.data.get("region")
        if not name:
            return Response({"detail": "Give the branch a name."}, status=400)
        region = Region.objects.filter(pk=region_id).first()
        if region is None:
            return Response({"detail": "Choose a region for it."}, status=400)
        if Branch.objects.filter(region=region, name__iexact=name).exists():
            return Response(
                {"detail": f"“{name}” already exists in {region.name}."}, status=400
            )
        branch = Branch.objects.create(
            region=region,
            name=name,
            code=(request.data.get("code") or "").strip()[:16],
            address=(request.data.get("address") or "").strip()[:240],
        )
        return Response(_branch_json(branch), status=http.HTTP_201_CREATED)


class BranchDetailView(_OrgStaffView):
    def patch(self, request, branch_id):
        denied = self._guard(request)
        if denied:
            return denied
        branch = get_object_or_404(Branch.objects.select_related("region"), pk=branch_id)
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "Give the branch a name."}, status=400)
            branch.name = name
        if "region" in request.data:
            region = Region.objects.filter(pk=request.data.get("region")).first()
            if region is None:
                return Response({"detail": "Unknown region."}, status=400)
            branch.region = region
        for field, cap in (("code", 16), ("address", 240)):
            if field in request.data:
                setattr(branch, field, (request.data.get(field) or "").strip()[:cap])
        if "is_active" in request.data:
            branch.is_active = bool(request.data.get("is_active"))
        branch.save()
        return Response(_branch_json(branch))


class ClassroomBranchView(_OrgStaffView):
    """Put one classroom in a branch — the write that makes every student's branch resolve.

    Its own endpoint rather than a field on the classroom update form, because it is the one
    edit that moves a whole roster onto a different leaderboard, and it is done by a different
    person at a different time from renaming a class.
    """

    def post(self, request, classroom_pk):
        from .models import Classroom, ClassroomMembership

        denied = self._guard(request)
        if denied:
            return denied
        classroom = get_object_or_404(Classroom, pk=classroom_pk)

        raw = request.data.get("branch")
        if raw in (None, "", 0):
            # Explicitly clearable: a classroom that moved out of a branch and has not moved
            # into another is a real state, and leaving it pointed at the old one would put
            # its students on a board they no longer belong to.
            classroom.branch = None
            classroom.save(update_fields=["branch", "updated_at"])
            return Response({"detail": "Branch cleared.", "branch": None})

        branch = Branch.objects.select_related("region").filter(pk=raw).first()
        if branch is None:
            return Response({"detail": "Unknown branch."}, status=400)
        classroom.branch = branch
        classroom.save(update_fields=["branch", "updated_at"])
        return Response({
            "detail": f"{classroom.name} is now at {branch.name}.",
            "branch": _branch_json(branch),
            # How many students this just moved onto a branch board — the number the
            # administrator actually wants to see after pressing it.
            "students_affected": classroom.memberships.filter(
                role=ClassroomMembership.ROLE_STUDENT,
                status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            ).count(),
        })
