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
# Reused rather than re-implemented: it already handles the nullable username/email pair
# that made the classroom board's sort blow up on two not-started students.
from classes.views_rankings import _display_name

from . import coins as coins_service
from . import constants
from . import leaderboard
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
            "max_convertible_points": wallet["max_convertible_points"],
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
                    # What the coins cost. Zero on a spend or an admin grant, which consume
                    # no points — the history row can then say "40 points → 4 coins" without
                    # the client re-deriving it from a rate that may since have changed.
                    "points_spent": t.points_spent,
                    "reference": t.reference,
                    "created_at": t.created_at,
                }
                for t in rows
            ],
        })


class ConvertPointsView(APIView):
    """The student spends their own points on coins.

    ``POST {"points": 30}`` converts thirty of them; ``POST {}`` converts as many as will buy
    whole coins — the Max button. Max is the omitted case rather than a flag, because "all of
    it" is the common press and a client that forgets to send an amount should do the obvious
    thing rather than nothing.

    **This is no longer idempotent, and it cannot be.** It used to be: conversion derived what
    was owed from what had already been paid, so a double-tap was harmless. Now that points
    are actually spent, a second press is a second purchase — which is correct (a student may
    convert twice), and it is why the write holds a row lock on the wallet and re-reads the
    balance inside it. Two taps on a slow connection cannot both spend the same points; the
    second one simply finds fewer left.

    Only ever acts on the caller's own wallet. Staff move somebody else's coins through
    ``WalletAdminView``, which is a different operation with a different audit trail.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw = request.data.get("points", None)
        points = None
        if raw not in (None, ""):
            try:
                points = int(raw)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "points must be a whole number."}, status=http.HTTP_400_BAD_REQUEST
                )

        try:
            result = coins_service.convert(request.user, points)
        except ValidationError as exc:
            # Asking for more points than they hold is a real refusal, not a quiet clamp: a
            # student who typed 400 and received 4 coins would read the balance as broken.
            return Response(
                {"detail": " ".join(exc.messages)}, status=http.HTTP_400_BAD_REQUEST
            )

        minted = result["coins"]
        state = coins_service.wallet_state(request.user)
        return Response({
            "minted": minted,
            "points_spent": result["points_spent"],
            # Not an error. A student with 7 points and a rate of 10 has pressed a button that
            # legitimately does nothing yet, and telling them how far off they are is more
            # use than refusing them.
            "detail": (
                f"Converted {result['points_spent']} points into "
                f"{minted} coin{'s' if minted != 1 else ''}."
                if minted
                else f"Not enough points yet — {state['points_to_next_coin']} more for a coin."
            ),
            **state,
        })


class LeaderboardView(APIView):
    """The platform-wide XP board: My Group, My Branch, Global, and the filters over them.

    Named on `/api/rewards/` rather than a namespace of its own for two reasons. It is a
    projection of this ledger and nothing else, so it belongs beside the balance it is derived
    from; and `/api/rewards/` is already allowlisted on the admin and teacher subdomains
    (access/host_guard.py), so staff can open the board on the console they are already using
    instead of it 403ing there until somebody notices.

    **Every student is named.** The per-classroom boards honour `ClassroomRankingConfig`,
    where a teacher can anonymise their own class — but that setting is scoped to a classroom
    and this board crosses all of them. Honouring it here would mean one teacher's preference
    silently blanking rows on a school-wide board, and refusing to would leak what they asked
    to hide. Neither is defensible, so the school-wide board is a school-wide decision: it
    shows names, and a school that wants otherwise needs a platform-level policy rather than
    this endpoint guessing at one.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from classes.models_org import Branch
        from users.photos import profile_image_url

        from classes.models_org import branch_ids_for_students

        query = leaderboard.BoardQuery.from_params(request.query_params)
        rows, meta = leaderboard.board(query, request.user)

        # The viewer's own standing, computed separately so it is present even when they are
        # nowhere near the visible top. A board that cannot tell a student where they stand is
        # one they have no reason to open twice.
        mine = leaderboard.rank_of(request.user, query, viewer=request.user)

        wanted = {r["student_id"] for r in rows}
        if mine:
            wanted.add(mine["student_id"])   # they may be far below the limit

        students = {
            u.pk: u
            for u in get_user_model().objects.filter(pk__in=wanted)
            .only("id", "first_name", "last_name", "username", "email", "profile_image")
        }
        branch_by_student = branch_ids_for_students(list(wanted))
        branches = {
            b.pk: b
            for b in Branch.objects.filter(
                pk__in=set(branch_by_student.values())
            ).select_related("region")
        }

        def _row(r):
            student = students.get(r["student_id"])
            branch = branches.get(branch_by_student.get(r["student_id"]))
            return {
                "rank": r["rank"],
                "student_id": r["student_id"],
                "name": _display_name(student) if student else "Student",
                "profile_image_url": profile_image_url(student, request) if student else None,
                "xp": r["xp"],
                "awards": r["awards"],
                "branch": branch.name if branch else None,
                "region": branch.region.name if branch else None,
                "is_me": r["student_id"] == request.user.pk,
            }

        return Response({
            **meta,
            "rows": [_row(r) for r in rows],
            "my": _row(mine) if mine else None,
        })


class LeaderboardFiltersView(APIView):
    """The options the board's filter chips offer — branches, regions, subjects, windows.

    Served rather than hardcoded in the client so a school that opens a branch does not need a
    frontend deploy for it to appear.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from classes.models import Classroom
        from classes.models_org import Branch, Region, branch_for_student

        my_branch = branch_for_student(request.user)
        return Response({
            "regions": [
                {"id": r.pk, "name": r.name, "code": r.code}
                for r in Region.objects.filter(is_active=True)
            ],
            "branches": [
                {"id": b.pk, "name": b.name, "code": b.code, "region_id": b.region_id}
                for b in Branch.objects.filter(is_active=True).select_related("region")
            ],
            "subjects": [
                {"value": value, "label": label} for value, label in Classroom.SUBJECT_CHOICES
            ],
            "levels": [
                {"value": value, "label": label} for value, label in Classroom.LEVEL_CHOICES
            ],
            # Two chips. The filter bar renders whatever is in this list and nothing else,
            # so withdrawing "This week" and "This term" was a change here — the frontend
            # only had to narrow its `LeaderboardWindow` union, not touch the bar. The
            # retired values still parse (`leaderboard.BoardQuery.from_params` coerces
            # anything it does not recognise); they just no longer have a chip to press.
            "windows": [
                {"value": leaderboard.WINDOW_ALL, "label": "All time"},
                {"value": leaderboard.WINDOW_MONTH, "label": "This month"},
            ],
            # So the client can label the "My Branch" tab with a name instead of the word
            # "mine", and can hide the tab entirely when there is no branch behind it.
            "my_branch": (
                {"id": my_branch.pk, "name": my_branch.name, "region": my_branch.region.name}
                if my_branch else None
            ),
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
                    "balance_after": t.balance_after, "points_spent": t.points_spent,
                    "reference": t.reference,
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
            # Staff convert on a student's behalf at the desk, so this is always Max — an
            # administrator has no business choosing how many of somebody else's points to
            # spend, and the student is standing there asking for their coins.
            try:
                result = coins_service.convert(student, None, actor=request.user)
            except ValidationError as exc:
                return Response(
                    {"detail": " ".join(exc.messages)}, status=http.HTTP_400_BAD_REQUEST
                )
            minted = result["coins"]
            return Response({
                "detail": (
                    f"Converted {result['points_spent']} points into "
                    f"{minted} coin{'s' if minted != 1 else ''}."
                ),
                "minted": minted,
                "points_spent": result["points_spent"],
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
