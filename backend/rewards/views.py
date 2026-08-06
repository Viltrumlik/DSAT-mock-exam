"""Read-only reward surfaces.

Deliberately no write endpoints yet. Points are earned by *doing the thing* — attending,
sitting a midterm, finishing homework — and every write goes through a hook. An HTTP endpoint
that granted points would be a second, unaudited way in.

Manual adjustments and season control land with the ops console; they are staff operations
with their own authorization, not part of this surface.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import constants
from .models import PointAward, RewardRule
from .serializers import PointAwardSerializer, RewardRuleSerializer
from .services import balance, current_season

#: History page size. The feed is a motivator, not an archive — the full ledger lives in ops.
HISTORY_LIMIT = 50


class MyRewardsView(APIView):
    """The signed-in student's own balance and recent earnings."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        season = current_season()
        awards = (
            PointAward.objects.filter(student=request.user, season=season)
            .exclude(points=0)   # revoked/zero rows are ledger bookkeeping, not achievements
            .select_related("classroom")
            .order_by("-awarded_at", "-id")[:HISTORY_LIMIT]
        )
        return Response({
            "season": {"id": season.id, "name": season.name, "started_at": season.started_at},
            "points": balance(request.user, season=season),
            "points_per_coin": constants.DEFAULT_POINTS_PER_COIN,
            "history": PointAwardSerializer(awards, many=True).data,
        })


class RewardRulesView(APIView):
    """What earns what — so the rules are visible in the product, not just in a spreadsheet."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rules = RewardRule.objects.filter(is_active=True).exclude(
            event=constants.EVENT_MANUAL   # an admin adjustment is not something to aim for
        )
        return Response({"rules": RewardRuleSerializer(rules, many=True).data})
