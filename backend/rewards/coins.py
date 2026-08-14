"""Coins: a spendable wallet minted from points.

Points and coins answer different questions and behave differently on purpose.

    points — a lifetime score for the season. Corrected freely, reset by the school.
    coins  — a currency. Minted from points, and once spent they are gone.

Conversion is **manual**: it happens when a student presses the button, and at no other
time. Nothing on a read path mints, and neither does a spend. The arithmetic below is
unchanged from when it ran automatically — only the trigger moved — so leaving points
unconverted costs a student nothing and converting late gives the same answer as converting
often.

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
from .services import balance, current_season, xp_balance

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

    **Only ever called from :func:`convert`** — that is, only when a student has actually
    asked. It used to run lazily on every wallet read and before every spend, which made
    conversion invisible: points silently became coins and the student never chose anything.
    The school wants the exchange to be a deliberate act, so the arithmetic stayed exactly as
    it was and only the trigger moved.

    Because the figure is *derived* — the difference between what this season's points are
    worth and what has already been minted — running it late gives the same answer as running
    it often. Nothing accumulates while a student leaves it unconverted, and nothing is lost.
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


def convert(student) -> int:
    """The student presses the button. Mint whatever their points have earned, and say how many.

    A thin wrapper on purpose: it exists so there is exactly one entry point that means "a
    person asked for this", which is what separates conversion from the accounting underneath
    it. Returning 0 is an ordinary outcome, not a failure — it means they have not earned a
    whole coin yet, and the caller should say so rather than raise.
    """
    return mint_owed(student)


@transaction.atomic
def spend(student, amount: int, *, reference: str, actor=None) -> CoinTransaction:
    """Take coins out of a wallet. Raises ``ValidationError`` if there are not enough.

    Does **not** mint first. Unconverted points are not money: a spend that quietly converted
    them would be the automatic conversion the school asked us to remove, arriving through the
    back door at the moment a student buys something. If they are short, the honest answer is
    that they have points to convert — which the wallet payload already tells them.
    """
    amount = int(amount)
    if amount <= 0:
        raise ValidationError("Spend a positive number of coins.")

    wallet = StudentWallet.objects.select_for_update().filter(student=student).first()
    if wallet is None:
        raise ValidationError("Not enough coins: 0 available.")
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


def convertible_coins(student) -> int:
    """How many coins the student could mint right now, without minting them.

    The same arithmetic as :func:`mint_owed`, read-only. Since conversion became manual the
    wallet screen has to show this number — an unconverted balance the student cannot see is
    one they will never press the button for.
    """
    season = current_season()
    rate = max(1, int(season.points_per_coin or 1))
    wallet = StudentWallet.objects.filter(student=student).first()
    if wallet is None:
        return max(0, int(balance(student, season=season)) // rate)
    return max(0, int(balance(student, season=season)) // rate - _minted_this_season(wallet, season))


def wallet_state(student) -> dict:
    """Everything a wallet screen needs. Reads only — it no longer mints.

    The season is deliberately NOT in here. It is an internal accounting boundary, not a
    thing the school wants students reasoning about — and hiding it in the UI alone would
    not hide it, since anything in this dict is served to the browser and readable by
    anyone who opens devtools. It has to leave the payload, not just the screen.
    """
    season = current_season()
    rate = max(1, int(season.points_per_coin or 1))
    wallet = wallet_for(student)
    points = int(balance(student, season=season))
    return {
        "coins": int(wallet.coins_balance),
        "points": points,
        "xp": xp_balance(student),
        "points_per_coin": rate,
        # How many more points until the next coin — the number a student actually wants.
        "points_to_next_coin": rate - (points % rate) if rate else 0,
        # What pressing Convert would give them. Zero means the button is honest but idle.
        "convertible_coins": convertible_coins(student),
    }
