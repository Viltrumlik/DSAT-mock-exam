"""Learner population for the /ops card: centre vs public vs frozen, and how people moved lately
(plan 2026-10-13)."""

from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import HasManageUsersOrAssignTestAccess

from . import audience as A
from .models import RoleChange, User


class PopulationView(APIView):
    """``GET /api/users/admin/population/`` — the same audience as the users list."""

    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request):
        now = timezone.now()
        learners = User.objects.filter(is_active=True, role__in=C.LEARNER_ROLES)
        body = learners.aggregate(
            centre=Count("id", filter=Q(role=C.ROLE_STUDENT, is_frozen=False)),
            public=Count("id", filter=Q(role=C.ROLE_PUBLIC_STUDENT, is_frozen=False)),
            frozen_debt=Count("id", filter=Q(is_frozen=True, frozen_reason=A.FROZEN_LCUP_DEBT)),
            frozen_admin=Count("id", filter=Q(is_frozen=True) & ~Q(frozen_reason=A.FROZEN_LCUP_DEBT)),
            signups_7d=Count("id", filter=Q(date_joined__gte=now - timedelta(days=7))),
            signups_30d=Count("id", filter=Q(date_joined__gte=now - timedelta(days=30))),
        )
        recent = RoleChange.objects.filter(created_at__gte=now - timedelta(days=30), reverted_at__isnull=True)
        body["joined_30d"] = recent.filter(reason=A.REASON_JOINED).count()
        body["left_30d"] = recent.filter(reason__in=(A.REASON_LEFT, A.REASON_LEFT_WITH_DEBT)).count()
        return Response(body)
