"""Reward surfaces.

Points are earned by *doing the thing* — attending, sitting a midterm, finishing homework —
and every one of those writes goes through a hook. There is deliberately no endpoint that
grants points or XP: it would be a second, unaudited way in.

The one write here is conversion, and it is a write precisely because it is not an earning.
Turning points into coins is a choice the student makes about something they have already
earned, so it needs a button, and a button needs somewhere to POST.

Manual adjustments and season control land with the ops console; they are staff operations
with their own authorization, not part of this surface.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.contrib.auth import get_user_model
from rest_framework.views import APIView

from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status as http

from access import constants as acc_const
from access.services import is_global_scope_staff, normalized_role

from . import coins as coins_service
from . import constants
from .models import CoinTransaction, PointAward, RewardRule
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
        # Coins come from the wallet, not from `points // rate` computed here. Once coins are
        # spendable the two diverge immediately, and a screen that derives them would keep
        # showing a student coins they have already spent.
        wallet = coins_service.wallet_state(request.user)
        # No season in the payload — see `coins.wallet_state`. The student's balance is
        # already scoped to the current one; naming it would only invite the question.
        return Response({
            "points": balance(request.user, season=season),
            "coins": wallet["coins"],
            "xp": wallet["xp"],
            "points_per_coin": wallet["points_per_coin"],
            "points_to_next_coin": wallet["points_to_next_coin"],
            "convertible_coins": wallet["convertible_coins"],
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


def _is_reward_staff(user) -> bool:
    """Who may move somebody else's coins: global staff only, never a teacher."""
    return bool(getattr(user, "is_superuser", False)) or normalized_role(user) in (
        acc_const.ROLE_SUPER_ADMIN,
        acc_const.ROLE_ADMIN,
    )


class MyWalletView(APIView):
    """The signed-in student's wallet and its history."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        state = coins_service.wallet_state(request.user)
        wallet = coins_service.wallet_for(request.user)
        rows = wallet.transactions.all()[:HISTORY_LIMIT]
        return Response({
            **state,
            "transactions": [
                {
                    "id": t.id,
                    "kind": t.kind,
                    "label": t.get_kind_display(),
                    "amount": t.amount,
                    "balance_after": t.balance_after,
                    "reference": t.reference,
                    "created_at": t.created_at,
                }
                for t in rows
            ],
        })


class ConvertPointsView(APIView):
    """The student turns their own points into coins.

    Idempotent in the way that matters: pressing it twice in a row mints nothing the second
    time, because the amount owed is derived from what has already been paid rather than
    accumulated. So a double-tap, a retry on a flaky connection and a refreshed tab all land
    on the same balance, and the endpoint needs no idempotency key of its own.

    Only ever acts on the caller's own wallet. Staff move somebody else's coins through
    ``WalletAdminView``, which is a different operation with a different audit trail.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        minted = coins_service.convert(request.user)
        state = coins_service.wallet_state(request.user)
        return Response({
            "minted": minted,
            # Not an error. A student with 7 points and a rate of 10 has pressed a button that
            # legitimately does nothing yet, and telling them how far off they are is more
            # use than refusing them.
            "detail": (
                f"Converted {minted} coin{'s' if minted != 1 else ''}."
                if minted
                else f"Not enough points yet — {state['points_to_next_coin']} more for a coin."
            ),
            **state,
        })


class WalletAdminView(APIView):
    """Staff: spend a student's coins on their behalf, or adjust the balance by hand.

    Spending is staff-side on purpose. There is no catalogue yet — the school hands over a
    prize in person — so the honest model is "an admin records that coins were exchanged",
    not a shop the student clicks through. When a catalogue exists it can call the same
    `spend()`; nothing here has to change.

    ``action=convert`` exists because conversion became manual. Without it a student who
    never pressed Convert cannot be handed a prize at the desk at all: the admin sees points
    they cannot reach, `spend` refuses, and there is no way forward that does not involve
    finding the student and asking them to open the app. It is a separate action rather than
    something `spend` does quietly, so that converting somebody else's points is always a
    thing a member of staff chose and the ledger recorded.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        student = get_object_or_404(get_user_model(), pk=student_id)
        wallet = coins_service.wallet_for(student)
        return Response({
            **coins_service.wallet_state(student),
            "student_id": student.pk,
            "transactions": [
                {
                    "id": t.id, "kind": t.kind, "amount": t.amount,
                    "balance_after": t.balance_after, "reference": t.reference,
                    "created_at": t.created_at,
                }
                for t in wallet.transactions.all()[:HISTORY_LIMIT]
            ],
        })

    def post(self, request, student_id):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        student = get_object_or_404(get_user_model(), pk=student_id)

        if str(request.data.get("action") or "").lower() == "convert":
            minted = coins_service.convert(student)
            return Response({
                "detail": f"Converted {minted} coin{'s' if minted != 1 else ''}.",
                "minted": minted,
                **coins_service.wallet_state(student),
            })

        reference = (request.data.get("reference") or "").strip()
        if not reference:
            return Response(
                {"detail": "Say what the coins were for — the ledger is the only record."},
                status=400,
            )
        try:
            amount = int(request.data.get("amount"))
        except (TypeError, ValueError):
            return Response({"detail": "amount must be a whole number of coins."}, status=400)

        action = str(request.data.get("action") or "spend").lower()
        try:
            if action == "spend":
                tx = coins_service.spend(student, amount, reference=reference, actor=request.user)
            else:
                tx = coins_service.adjust(student, amount, reason=reference, actor=request.user)
        except ValidationError as exc:
            return Response({"detail": "; ".join(exc.messages)}, status=400)

        return Response({
            "detail": "Recorded.",
            "amount": tx.amount,
            "balance_after": tx.balance_after,
        }, status=http.HTTP_201_CREATED)
