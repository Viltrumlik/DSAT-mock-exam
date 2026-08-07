"""Coins: a spendable wallet minted from points.

Points and coins answer different questions and behave differently on purpose.

    points — a lifetime score for the season. Corrected freely, reset by the school.
    coins  — a currency. Minted from points, and once spent they are gone.

Minting is **monotonic**. The wallet never mints the same point twice, because it mints the
DIFFERENCE between what this season's points are now worth and what has already been minted
from them — a figure read straight out of the ledger rather than cached anywhere.

Minting also never runs backwards. If points are revoked after coins were minted from them —
a mark corrected to ABSENT, a re-grade dropping a bundle below its band — the coins stay. The
student may already have spent them, and a wallet that can go negative because somebody fixed
a register is not a wallet. The mint simply pauses until their points climb back past what has
already been paid out.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Sum

from .models import CoinTransaction, RewardSeason, StudentWallet
from .services import balance, current_season

logger = logging.getLogger(__name__)


def wallet_for(student) -> StudentWallet:
    wallet, _ = StudentWallet.objects.get_or_create(student=student)
    return wallet


def _minted_this_season(wallet: StudentWallet, season: RewardSeason) -> int:
    total = CoinTransaction.objects.filter(
        wallet=wallet, kind=CoinTransaction.KIND_EARN, season=season
    ).aggregate(total=Sum("amount"))["total"]
    return int(total or 0)


def _record(wallet, *, kind, amount, season=None, reference="", actor=None) -> CoinTransaction:
    """Append one transaction and move the cached balance. Caller holds the wallet lock."""
    wallet.coins_balance = int(wallet.coins_balance) + int(amount)
    wallet.save(update_fields=["coins_balance", "updated_at"])
    return CoinTransaction.objects.create(
        wallet=wallet, kind=kind, amount=int(amount),
        balance_after=wallet.coins_balance, season=season,
        reference=reference, actor=actor,
    )


@transaction.atomic
def mint_owed(student) -> int:
    """Mint any coins this season's points have earned but not yet paid. Returns how many.

    Called lazily, on read and before any spend, rather than from the award hooks: it keeps
    the hot write path free of wallet arithmetic, and because the calculation is derived
    rather than incremental, running it late gives exactly the same answer as running it
    often.
    """
    season = current_season()
    rate = max(1, int(season.points_per_coin or 1))
    wallet = StudentWallet.objects.select_for_update().filter(student=student).first()
    if wallet is None:
        wallet = StudentWallet.objects.create(student=student)
        wallet = StudentWallet.objects.select_for_update().get(pk=wallet.pk)

    earned_total = int(balance(student, season=season)) // rate
    owed = earned_total - _minted_this_season(wallet, season)
    if owed <= 0:
        # Either nothing new, or points fell after coins were minted. Never claw back.
        return 0

    _record(wallet, kind=CoinTransaction.KIND_EARN, amount=owed, season=season,
            reference=f"{rate} points = 1 coin")
    return owed


@transaction.atomic
def spend(student, amount: int, *, reference: str, actor=None) -> CoinTransaction:
    """Take coins out of a wallet. Raises ``ValidationError`` if there are not enough."""
    amount = int(amount)
    if amount <= 0:
        raise ValidationError("Spend a positive number of coins.")

    mint_owed(student)   # a student should be able to spend what they have just earned
    wallet = StudentWallet.objects.select_for_update().get(student=student)
    if wallet.coins_balance < amount:
        raise ValidationError(
            f"Not enough coins: {wallet.coins_balance} available, {amount} needed."
        )
    return _record(
        wallet, kind=CoinTransaction.KIND_SPEND, amount=-amount,
        reference=reference, actor=actor,
    )


@transaction.atomic
def adjust(student, amount: int, *, reason: str, actor=None) -> CoinTransaction:
    """An admin adds or removes coins by hand — a prize given, a mistake undone.

    A revocation is clamped at the balance rather than allowed to go negative: a wallet in
    debt has no meaning here, and the alternative is a student who earns coins that silently
    disappear into a hole somebody else dug.
    """
    amount = int(amount)
    if amount == 0:
        raise ValidationError("Adjust by a non-zero number of coins.")
    wallet = StudentWallet.objects.select_for_update().filter(student=student).first()
    if wallet is None:
        wallet = StudentWallet.objects.create(student=student)
        wallet = StudentWallet.objects.select_for_update().get(pk=wallet.pk)

    if amount < 0:
        amount = -min(wallet.coins_balance, -amount)
        if amount == 0:
            raise ValidationError("That wallet is already empty.")

    kind = (
        CoinTransaction.KIND_ADMIN_GRANT if amount > 0 else CoinTransaction.KIND_ADMIN_REVOKE
    )
    return _record(wallet, kind=kind, amount=amount, reference=reason, actor=actor)


def wallet_state(student) -> dict:
    """Everything a wallet screen needs, with any owed coins minted first.

    The season is deliberately NOT in here. It is an internal accounting boundary, not a
    thing the school wants students reasoning about — and hiding it in the UI alone would
    not hide it, since anything in this dict is served to the browser and readable by
    anyone who opens devtools. It has to leave the payload, not just the screen.
    """
    mint_owed(student)
    season = current_season()
    rate = max(1, int(season.points_per_coin or 1))
    wallet = wallet_for(student)
    points = int(balance(student, season=season))
    return {
        "coins": int(wallet.coins_balance),
        "points": points,
        "points_per_coin": rate,
        # How many more points until the next coin — the number a student actually wants.
        "points_to_next_coin": rate - (points % rate) if rate else 0,
    }
