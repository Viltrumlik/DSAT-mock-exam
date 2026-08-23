"""Coins: a spendable wallet bought with points.

Points and coins answer different questions, and the exchange between them is a purchase.

    points — what a student has earned and not yet spent. Goes up when they work, and
             DOWN when they convert.
    coins  — a currency. Bought with points, and once spent they are gone.

Conversion is **manual and explicit**: it happens when a student presses the button, for the
number of points they chose, and at no other time. Nothing on a read path converts, and
neither does a spend.

**Converting costs points.** This is the whole shape of the module and it is worth being
plain about, because it did not always work this way. Conversion used to MINT — it computed
what this season's points were worth, subtracted what had already been paid out, and handed
over the difference while the points themselves stayed where they were. A student's points
were a lifetime score that coins were derived from, so the same 100 points could show on the
scoreboard forever and still be worth 10 coins. The school asked for the ordinary meaning
instead: spend your points, and you no longer have them.

That turns the exchange from a derivation into a transaction, and everything below follows
from it:

* the amount is an INPUT, not a computed figure — a student may cash in 30 of their 340
  points and keep the rest;
* the deduction is a real negative row in the point ledger (``EVENT_COIN_CONVERSION``), so
  ``services.balance`` falls out of the same SUM it always was and no second number has to
  be kept in step;
* there is nothing left to make monotonic. The old ``mint_owed`` had to guard against paying
  twice for one point and against clawing coins back when a mark was corrected. A debit
  cannot be applied twice — the points are gone the moment it lands — so both guards are
  deleted rather than ported.

**XP does not move.** The conversion row carries ``xp=0``, so a student who cashes in every
point keeps their whole XP total and their place on the board. That is deliberate: the
leaderboard ranks on XP precisely so that spending your points is never punished.

**Only whole coins.** 34 points at 10 points a coin buys 3 coins and costs 30; the remaining
4 stay in the student's balance. Charging for a fraction of a coin nobody receives would be
the one thing a 15-year-old would never forgive.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError
from django.db import transaction

from . import constants
from .models import CoinTransaction, PointAward, RewardSeason, StudentWallet
from .services import balance, current_season, xp_balance

logger = logging.getLogger(__name__)


def wallet_for(student) -> StudentWallet:
    wallet, _ = StudentWallet.objects.get_or_create(student=student)
    return wallet


def _record(wallet, *, kind, amount, season=None, reference="", actor=None, points_spent=0):
    """Append one transaction and move the cached balance. Caller holds the wallet lock."""
    wallet.coins_balance = int(wallet.coins_balance) + int(amount)
    wallet.save(update_fields=["coins_balance", "updated_at"])
    return CoinTransaction.objects.create(
        wallet=wallet, kind=kind, amount=int(amount),
        balance_after=wallet.coins_balance, season=season,
        reference=reference, actor=actor, points_spent=int(points_spent),
    )


def _rate(season: RewardSeason) -> int:
    """Points per coin. Clamped at 1 — a rate of 0 would make every point infinite coins."""
    return max(1, int(season.points_per_coin or 1))


@transaction.atomic
def convert(student, points: int | None = None, *, actor=None) -> dict:
    """Spend ``points`` on coins. ``points=None`` means all of them — the Max button.

    Returns ``{"coins": minted, "points_spent": spent}``. Minting zero is an ordinary
    outcome, not a failure: it means the student asked for less than one coin's worth, and
    the caller should say so rather than raise.

    Raises ``ValidationError`` only for a request that cannot be honoured at all — a negative
    amount, or more points than the student has. Being told "you only have 40" is useful;
    silently converting 40 when 400 was asked for is not, because the student would read the
    resulting coin count as a bug.

    The whole thing is one transaction with the wallet row locked, so two taps on a slow
    connection cannot both read the same balance and spend it twice.
    """
    season = current_season()
    rate = _rate(season)

    wallet = StudentWallet.objects.select_for_update().filter(student=student).first()
    if wallet is None:
        wallet = StudentWallet.objects.create(student=student)
        wallet = StudentWallet.objects.select_for_update().get(pk=wallet.pk)

    available = int(balance(student, season=season))

    if points is None:
        # Max. Not simply `available`: spending every point would charge for the remainder
        # that does not add up to a coin. Round DOWN to whole coins so the leftover stays.
        requested = (available // rate) * rate
    else:
        requested = int(points)
        if requested < 0:
            raise ValidationError("Convert a positive number of points.")
        if requested > available:
            raise ValidationError(
                f"Not enough points: {available} available, {requested} needed."
            )

    coins = requested // rate
    spent = coins * rate  # never charge for a fraction of a coin
    if coins <= 0:
        return {"coins": 0, "points_spent": 0}

    # Coins first, so the debit can be keyed on the row it paid for.
    #
    # `PointAward.idempotency_key` is unique and every other writer derives it from the thing
    # that caused the award — an attendance mark, a submission. A conversion's cause is this
    # transaction, and its id is the only value in the system that is unique per conversion.
    # Deriving the key from the student and the amount instead would make a student's second
    # 30-point conversion collide with their first and vanish.
    tx = _record(
        wallet, kind=CoinTransaction.KIND_EARN, amount=coins, season=season,
        reference=f"{rate} points = 1 coin", actor=actor, points_spent=spent,
    )

    # The debit. A plain negative row in the same ledger every earning lives in, so
    # `services.balance` — a SUM over that table — reflects it with no other code involved.
    # `xp` stays 0: see the module docstring.
    PointAward.objects.create(
        student=student,
        season=season,
        event=constants.EVENT_COIN_CONVERSION,
        points=-spent,
        xp=0,
        source_type="coin_transaction",
        source_id=tx.pk,
        idempotency_key=f"coin-conversion:{tx.pk}",
        note=f"{spent} points → {coins} coin{'' if coins == 1 else 's'}",
        created_by=actor,
    )

    return {"coins": coins, "points_spent": spent}


@transaction.atomic
def spend(student, amount: int, *, reference: str, actor=None) -> CoinTransaction:
    """Take coins out of a wallet. Raises ``ValidationError`` if there are not enough.

    Does **not** convert first. Unconverted points are not money: a spend that quietly
    converted them would take points a student had not chosen to give up, at the moment they
    were buying something else. If they are short, the honest answer is that they have points
    to convert — which the wallet payload already tells them.
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
    disappear into a hole somebody else dug. Points are not refunded by a revocation; taking
    a prize back is not the same act as undoing the purchase that paid for it.
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
    """How many coins the student's points would buy right now, without buying them.

    Now simply ``points // rate``. It used to have to subtract what had already been minted,
    because minting left the points in place and the same point could otherwise be paid for
    twice. A spent point is gone from the balance, so there is nothing left to subtract.
    """
    season = current_season()
    return max(0, int(balance(student, season=season)) // _rate(season))


def wallet_state(student) -> dict:
    """Everything a wallet screen needs. Reads only — it never converts.

    The season is deliberately NOT in here. It is an internal accounting boundary, not a
    thing the school wants students reasoning about — and hiding it in the UI alone would
    not hide it, since anything in this dict is served to the browser and readable by
    anyone who opens devtools. It has to leave the payload, not just the screen.
    """
    season = current_season()
    rate = _rate(season)
    wallet = wallet_for(student)
    points = int(balance(student, season=season))
    convertible = max(0, points // rate)
    return {
        "coins": int(wallet.coins_balance),
        "points": points,
        "xp": xp_balance(student),
        "points_per_coin": rate,
        # How many more points until the next coin — the number a student actually wants.
        "points_to_next_coin": rate - (points % rate) if rate else 0,
        # What pressing Convert would give them. Zero means the button is honest but idle.
        "convertible_coins": convertible,
        # What Max would spend. Not the same as `points`: the remainder that does not add up
        # to a whole coin is left behind, and the button has to be able to say so.
        "max_convertible_points": convertible * rate,
    }
