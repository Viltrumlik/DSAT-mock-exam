from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access import resources
from access.models import AccessGrantEvent, ResourceAccessGrant, UserAccess
from access.permissions import HasManageUsersOrAssignTestAccess
from access.serializers import (
    AccessGrantEventSerializer,
    ResourceAccessGrantSerializer,
)
from access.services import (
    authorize,
    has_access_for_classroom,
    has_global_subject_access,
    normalized_role,
    user_domain_subject,
)
from access.subject_mapping import domain_subject_to_platform

User = get_user_model()
logger = logging.getLogger("security.access")


class GrantAccessView(APIView):
    """
    POST /api/access/grant/
    Body: { "userId": <int>, "subject": "math"|"english", "classroomId": <int|null> }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        actor_role = normalized_role(request.user)
        if actor_role == C.ROLE_STUDENT:
            return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)

        subject = str(request.data.get("subject") or "").strip().lower()
        if subject not in C.ALL_DOMAIN_SUBJECTS:
            return Response({"detail": "Invalid subject."}, status=status.HTTP_400_BAD_REQUEST)

        platform_subj = domain_subject_to_platform(subject)
        if not platform_subj:
            return Response({"detail": "Invalid subject."}, status=status.HTTP_400_BAD_REQUEST)

        if not authorize(request.user, C.PERM_ASSIGN_ACCESS, subject=platform_subj):
            logger.info(
                "access_grant denied_by_authorize actor_id=%s actor_role=%s subject=%s",
                getattr(request.user, "pk", None),
                actor_role,
                subject,
            )
            return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)

        raw_uid = request.data.get("userId", request.data.get("user_id"))
        try:
            uid = int(raw_uid)
        except (TypeError, ValueError):
            return Response({"detail": "userId is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Teachers are restricted to their domain; global roles may grant any subject.
        if actor_role == C.ROLE_TEACHER and user_domain_subject(request.user) != subject:
            logger.info(
                "access_grant denied_subject_mismatch actor_id=%s actor_domain=%s requested=%s",
                getattr(request.user, "pk", None),
                user_domain_subject(request.user),
                subject,
            )
            return Response({"detail": "Subject mismatch."}, status=status.HTTP_403_FORBIDDEN)

        classroom_id = request.data.get("classroomId", request.data.get("classroom_id"))
        cid = None
        if classroom_id not in (None, "", "null"):
            try:
                cid = int(classroom_id)
            except (TypeError, ValueError):
                return Response({"detail": "Invalid classroomId."}, status=status.HTTP_400_BAD_REQUEST)

        if cid is not None:
            from classes.models import Classroom

            classroom = Classroom.objects.filter(pk=cid).first()
            if not classroom:
                return Response({"detail": "Classroom not found."}, status=status.HTTP_404_NOT_FOUND)
            cdom = (
                C.DOMAIN_MATH
                if classroom.subject == Classroom.SUBJECT_MATH
                else C.DOMAIN_ENGLISH
            )
            if cdom != subject:
                return Response(
                    {"detail": "Subject does not match the classroom's subject."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if actor_role != C.ROLE_SUPER_ADMIN and not has_access_for_classroom(
                request.user, subject, cid
            ):
                return Response(
                    {"detail": "You do not have access to grant membership for this classroom."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if cid is None and actor_role == C.ROLE_TEACHER:
            if not has_global_subject_access(request.user, subject):
                return Response(
                    {
                        "detail": "Global access grants require a global subject grant on your account.",
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            target = User.objects.get(pk=uid)
        except User.DoesNotExist:
            return Response({"detail": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            grant, was_created = UserAccess.objects.get_or_create(
                user=target,
                subject=subject,
                classroom_id=cid,
                defaults={"granted_by": request.user},
            )
            if not was_created:
                UserAccess.objects.filter(pk=grant.pk).update(granted_by=request.user)

        logger.info(
            "access_grant actor_id=%s actor_role=%s actor_is_superuser=%s target_id=%s subject=%s classroom_id=%s created=%s",
            request.user.pk,
            actor_role,
            getattr(request.user, "is_superuser", False),
            target.pk,
            subject,
            cid,
            was_created,
        )
        return Response(
            {
                "id": grant.pk,
                "user_id": target.pk,
                "subject": subject,
                "classroom_id": grant.classroom_id,
                "created": was_created,
            },
            status=status.HTTP_201_CREATED if was_created else status.HTTP_200_OK,
        )


# ===========================================================================
# Access engine admin API (Phase 2). Operates directly on ResourceAccessGrant
# via the engine services; independent of the ACCESS_ENGINE_* read flags (the
# admin populates grants before any read cutover). See docs/access-redesign/.
# ===========================================================================

from access.engine import AssignmentService, ClassroomAccessService  # noqa: E402
from access.engine.access_service import AccessService  # noqa: E402


class GrantsPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


def _resource_label(rt, instance) -> str:
    if instance is None:
        return f"{rt.key}#?"
    title = (getattr(instance, "title", None) or getattr(instance, "name", None) or "").strip()
    if rt.key == resources.RT_PRACTICE_TEST:
        subj = getattr(instance, "subject", "")
        form = getattr(instance, "form_type", "")
        date = getattr(instance, "practice_date", "") or ""
        bits = [b for b in [title, subj, form, str(date) if date else ""] if b]
        return " · ".join(bits) or f"Practice test #{instance.pk}"
    return title or f"{rt.key} #{instance.pk}"


class EngineGrantListView(generics.ListAPIView):
    """GET /api/access/grants/ — search/filter grants for the admin console."""

    permission_classes = [HasManageUsersOrAssignTestAccess]
    serializer_class = ResourceAccessGrantSerializer
    pagination_class = GrantsPagination

    def get_queryset(self):
        qs = ResourceAccessGrant.objects.select_related("user", "classroom", "granted_by")
        p = self.request.query_params
        if p.get("user"):
            qs = qs.filter(user_id=p["user"])
        if p.get("scope"):
            qs = qs.filter(scope=p["scope"])
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("source"):
            qs = qs.filter(source=p["source"])
        if p.get("resource_type"):
            qs = qs.filter(resource_type=p["resource_type"])
        if p.get("classroom"):
            qs = qs.filter(classroom_id=p["classroom"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(user__email__icontains=q)
                | Q(user__username__icontains=q)
                | Q(user__first_name__icontains=q)
                | Q(user__last_name__icontains=q)
            )
        return qs.order_by("-created_at", "-id")


class EngineGrantEventsView(generics.ListAPIView):
    """GET /api/access/grants/<id>/events/ — immutable audit trail for one grant."""

    permission_classes = [HasManageUsersOrAssignTestAccess]
    serializer_class = AccessGrantEventSerializer

    def get_queryset(self):
        return AccessGrantEvent.objects.filter(
            grant_id=self.kwargs["grant_id"]
        ).select_related("actor").order_by("-created_at", "-id")


def _int_list(raw) -> list[int]:
    out: list[int] = []
    for x in raw or []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


class EngineGrantSubjectView(APIView):
    """POST /api/access/grants/subject/ — grant a SUBJECT to one or many users."""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def post(self, request):
        data = request.data or {}
        user_ids = _int_list(data.get("user_ids")) or _int_list([data.get("user_id")])
        subject = str(data.get("subject") or "").strip().lower()
        if not user_ids:
            return Response({"detail": "user_ids is required."}, status=400)
        if subject not in C.ALL_DOMAIN_SUBJECTS:
            return Response({"detail": "Invalid subject (math/english)."}, status=400)
        users = list(User.objects.filter(pk__in=user_ids))
        try:
            result = AssignmentService.bulk_assign_subject(
                users, subject, actor=request.user,
                source=ResourceAccessGrant.SOURCE_MANUAL,
                expires_at=data.get("expires_at") or None,
            )
        except Exception as exc:  # validation etc.
            return Response({"detail": str(exc)}, status=400)
        return Response(result, status=201)


class EngineGrantResourceView(APIView):
    """POST /api/access/grants/resource/ — grant a RESOURCE to one or many users."""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def post(self, request):
        data = request.data or {}
        user_ids = _int_list(data.get("user_ids")) or _int_list([data.get("user_id")])
        resource_type = str(data.get("resource_type") or "").strip()
        try:
            resource_id = int(data.get("resource_id"))
        except (TypeError, ValueError):
            return Response({"detail": "resource_id is required."}, status=400)
        if not user_ids:
            return Response({"detail": "user_ids is required."}, status=400)
        if not resources.is_registered(resource_type):
            return Response({"detail": f"Unknown resource_type {resource_type!r}."}, status=400)
        users = list(User.objects.filter(pk__in=user_ids))
        subject_scope = data.get("subject_scope")
        targets = resources.expand_subject_targets(resource_type, resource_id, subject_scope)
        if not targets:
            return Response({"detail": "No matching sections for the chosen subject."}, status=400)
        try:
            result = AssignmentService.bulk_assign_targets(
                users, targets, actor=request.user,
                source=ResourceAccessGrant.SOURCE_MANUAL,
                expires_at=data.get("expires_at") or None,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(result, status=201)


class EngineGrantClassroomView(APIView):
    """POST /api/access/grants/classroom/ — transactional resource grant to a whole class."""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def post(self, request):
        from classes.models import Classroom

        data = request.data or {}
        try:
            classroom_id = int(data.get("classroom_id"))
            resource_id = int(data.get("resource_id"))
        except (TypeError, ValueError):
            return Response({"detail": "classroom_id and resource_id are required."}, status=400)
        resource_type = str(data.get("resource_type") or "").strip()
        if not resources.is_registered(resource_type):
            return Response({"detail": f"Unknown resource_type {resource_type!r}."}, status=400)
        classroom = Classroom.objects.filter(pk=classroom_id).first()
        if not classroom:
            return Response({"detail": "Classroom not found."}, status=404)
        subject_scope = data.get("subject_scope")
        targets = resources.expand_subject_targets(resource_type, resource_id, subject_scope)
        if not targets:
            return Response({"detail": "No matching sections for the chosen subject."}, status=400)
        try:
            result = ClassroomAccessService.assign_targets_to_classroom(
                classroom, targets, actor=request.user,
                expires_at=data.get("expires_at") or None,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(result, status=201)


class EngineGrantRevokeView(APIView):
    """POST /api/access/grants/<id>/revoke/"""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def post(self, request, grant_id):
        grant = ResourceAccessGrant.objects.filter(pk=grant_id).first()
        if not grant:
            return Response({"detail": "Grant not found."}, status=404)
        AccessService.revoke(grant, actor=request.user, note=str(request.data.get("note") or ""))
        grant.refresh_from_db()
        return Response(ResourceAccessGrantSerializer(grant).data, status=200)


class EngineGrantExtendView(APIView):
    """POST /api/access/grants/<id>/extend/ — body: {expires_at: iso|null}"""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def post(self, request, grant_id):
        grant = ResourceAccessGrant.objects.filter(pk=grant_id).first()
        if not grant:
            return Response({"detail": "Grant not found."}, status=404)
        AccessService.extend(
            grant, expires_at=request.data.get("expires_at") or None,
            actor=request.user, note=str(request.data.get("note") or ""),
        )
        grant.refresh_from_db()
        return Response(ResourceAccessGrantSerializer(grant).data, status=200)


class EngineResourceSearchView(APIView):
    """GET /api/access/resources/?type=<rt>&q=<text>&limit=30 — resource picker."""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request):
        rt_key = str(request.query_params.get("type") or "").strip()
        rt = resources.get(rt_key)
        if rt is None:
            return Response({"detail": "Unknown or missing ?type."}, status=400)
        q = (request.query_params.get("q") or "").strip()
        try:
            limit = min(int(request.query_params.get("limit", 30)), 100)
        except (TypeError, ValueError):
            limit = 30

        qs = rt.model().objects.all()
        if rt.queryset_filter:
            qs = qs.filter(**rt.queryset_filter)
        if q:
            cond = Q()
            for field in ("title", "name"):
                if any(f.name == field for f in rt.model()._meta.get_fields() if hasattr(f, "name")):
                    cond |= Q(**{f"{field}__icontains": q})
            if str(q).isdigit():
                cond |= Q(pk=int(q))
            if cond:
                qs = qs.filter(cond)
        items = []
        for obj in qs.order_by("-id")[:limit]:
            items.append({
                "resource_type": rt.key,
                "resource_id": obj.pk,
                "label": _resource_label(rt, obj),
                "subjects": sorted(rt.domain_subjects(obj)),
                "published": rt.is_published(obj),
            })
        return Response({"results": items, "resource_type": rt.key})


class EngineResourceTypesView(APIView):
    """GET /api/access/resource-types/ — registry keys for the picker dropdown."""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request):
        return Response({"results": sorted(rt.key for rt in resources.all_types())})
