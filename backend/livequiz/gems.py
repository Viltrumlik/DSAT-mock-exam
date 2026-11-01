"""Gems: what a finished game pays, and what the avatar shop takes.

A game pays every student who played it, once, when it finishes:

    10 for each right answer
    10 for playing to the end
    50 / 30 / 20 for first / second / third — only when at least three played,
       so a game of one cannot be replayed for a free first place

and no student can earn more than ``DAILY_CAP`` in one Tashkent day, however many games their
teacher runs. A game that was stopped (TERMINATED) pays nothing; nor does a student the host
removed.

Every movement is a ledger row with the balance after it, and the wallet row is locked for
each one, so two purchases at once cannot spend the same gems twice.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from core.errors.api import Conflict, NotFound

from . import avatars, paced
from . import constants as const
from .models import AvatarLook, GemTransaction, GemWallet, OwnedAvatarItem

PER_CORRECT = 10
FINISH_BONUS = 10
PODIUM = {1: 50, 2: 30, 3: 20}
PODIUM_MIN_PLAYERS = 3
DAILY_CAP = 300


# ─── Earning ──────────────────────────────────────────────────────────────────


def earnings_for(*, correct: int, played_to_end: bool, rank: int | None, player_count: int) -> dict:
    """What one student's game is worth, before the daily cap. Pure arithmetic."""
    parts = {
        "correct": max(0, int(correct)) * PER_CORRECT,
        "finish": FINISH_BONUS if played_to_end else 0,
        "podium": PODIUM.get(int(rank or 0), 0) if player_count >= PODIUM_MIN_PLAYERS else 0,
    }
    parts["total"] = sum(parts.values())
    return parts


def played_to_end(session, participant) -> bool:
    """Student-paced: they answered their last question. Teacher-paced: still in the room at
    the finish, having answered at least once."""
    if participant.status != const.PARTICIPANT_JOINED:
        return False
    if paced.is_student_paced(session):
        return participant.finished_at is not None
    return participant.answered_count >= 1


def _wallet(user, *, lock: bool = False) -> GemWallet:
    wallet, _ = GemWallet.objects.get_or_create(user=user)
    if lock:
        wallet = GemWallet.objects.select_for_update().get(pk=wallet.pk)
    return wallet


def _record(wallet: GemWallet, *, kind: str, amount: int, **fields) -> GemTransaction:
    """Move the balance and write the row. The caller holds the wallet lock."""
    wallet.balance += int(amount)
    wallet.save(update_fields=["balance", "updated_at"])
    return GemTransaction.objects.create(
        wallet=wallet, kind=kind, amount=int(amount), balance_after=wallet.balance, **fields
    )


def earned_today(wallet: GemWallet, day=None) -> int:
    day = day or timezone.localdate()
    total = (
        GemTransaction.objects.filter(wallet=wallet, kind=GemTransaction.KIND_EARN, day=day)
        .aggregate(total=Sum("amount"))
        .get("total")
    )
    return int(total or 0)


def award_for_game(session) -> dict[int, dict]:
    """Pay everybody who played a finished game. Safe to call again: a game pays once.

    Returns ``{participant_id: {"earned", "balance", "capped", "breakdown"}}`` for every
    student who played, including the ones whose share came to nothing.
    """
    if session.status != const.STATUS_FINISHED:
        return {}

    players = list(
        session.participants.exclude(status=const.PARTICIPANT_KICKED).select_related("user")
    )
    player_count = sum(1 for p in players if p.answered_count >= 1)
    today = timezone.localdate()
    paid: dict[int, dict] = {}

    for participant in players:
        breakdown = earnings_for(
            correct=participant.correct_count,
            played_to_end=played_to_end(session, participant),
            rank=participant.rank,
            player_count=player_count,
        )
        with transaction.atomic():
            wallet = _wallet(participant.user, lock=True)
            already = GemTransaction.objects.filter(
                wallet=wallet, session=session, kind=GemTransaction.KIND_EARN
            ).first()
            if already is not None:
                paid[participant.id] = _payout(already.amount, wallet.balance, already.detail)
                continue

            room = max(0, DAILY_CAP - earned_today(wallet, today))
            amount = min(breakdown["total"], room)
            detail = {**breakdown, "capped": amount < breakdown["total"]}
            # Written even when it comes to nothing. The row IS the record that this game has
            # paid this student; without it a later call — tomorrow, under a fresh cap — would
            # find nothing and pay the same game again.
            try:
                with transaction.atomic():
                    _record(
                        wallet,
                        kind=GemTransaction.KIND_EARN,
                        amount=amount,
                        session=session,
                        day=today,
                        detail=detail,
                    )
            except IntegrityError:
                # Another payout for this game landed first; theirs stands.
                wallet.refresh_from_db()
            paid[participant.id] = _payout(amount, wallet.balance, detail)
    return paid


def _payout(amount: int, balance: int, detail: dict) -> dict:
    return {
        "earned": int(amount),
        "balance": int(balance),
        "capped": bool((detail or {}).get("capped")),
        "breakdown": {k: (detail or {}).get(k, 0) for k in ("correct", "finish", "podium", "total")},
    }


def earned_in(session) -> dict[int, int]:
    """``{user_id: gems earned}`` for one game, for the report."""
    rows = GemTransaction.objects.filter(session=session, kind=GemTransaction.KIND_EARN).values_list(
        "wallet__user_id", "amount"
    )
    return {int(user_id): int(amount) for user_id, amount in rows}


def balance(user) -> int:
    wallet = GemWallet.objects.filter(user=user).only("balance").first()
    return int(wallet.balance) if wallet else 0


def grant(user, amount: int, *, kind: str = GemTransaction.KIND_ADJUST, note: str = "") -> GemTransaction:
    """Staff correction (and test set-up): a signed amount, written as its own row."""
    with transaction.atomic():
        return _record(_wallet(user, lock=True), kind=kind, amount=amount, note=note)


# ─── The shop ─────────────────────────────────────────────────────────────────


def _owned(user) -> set[str]:
    return set(OwnedAvatarItem.objects.filter(user=user).values_list("item_key", flat=True))


def _own(user, item_key: str) -> None:
    OwnedAvatarItem.objects.create(user=user, item_key=item_key)


def _wear_if_bare(user, character: str) -> None:
    """A student's first character goes on at once — nobody buys an avatar to keep it in a box."""
    AvatarLook.objects.get_or_create(user=user, defaults={"character": character, "skin": ""})


def buy(user, item_key: str) -> None:
    parsed = avatars.parse(item_key)
    if parsed is None:
        raise NotFound("There is no such item in the shop.", code="no_such_item")
    kind, character, _tier = parsed
    price = avatars.price_of(item_key)

    with transaction.atomic():
        wallet = _wallet(user, lock=True)
        owned = _owned(user)
        if item_key in owned:
            raise Conflict("You already have this one.", code="already_owned")
        if kind == "skin" and avatars.character_key(character) not in owned:
            raise Conflict("Get the character first, then its skins.", code="needs_character")
        if wallet.balance < price:
            raise Conflict(
                f"You need {price - wallet.balance} more gems for this.", code="not_enough_gems"
            )
        _record(wallet, kind=GemTransaction.KIND_SPEND, amount=-price, item_key=item_key)
        _own(user, item_key)
        if kind == "character":
            _wear_if_bare(user, character)


def claim_starter(user, character: str) -> None:
    """One free starter character, for a student who has no character yet."""
    if character not in avatars.STARTERS:
        raise Conflict("Only a starter character can be picked for free.", code="not_a_starter")
    with transaction.atomic():
        _wallet(user, lock=True)  # serialises against a purchase landing at the same moment
        owned = _owned(user)
        if any(avatars.parse(key) and avatars.parse(key)[0] == "character" for key in owned):
            raise Conflict("You have already picked your free character.", code="starter_used")
        _own(user, avatars.character_key(character))
        _wear_if_bare(user, character)


def equip(user, character: str, skin: str | None = None) -> None:
    owned = _owned(user)
    if character not in avatars.CHARACTERS or avatars.character_key(character) not in owned:
        raise Conflict("You do not have that character yet.", code="not_owned")
    if skin:
        if skin not in avatars.SKIN_TIERS or avatars.skin_key(character, skin) not in owned:
            raise Conflict("You do not have that skin yet.", code="not_owned")
    AvatarLook.objects.update_or_create(
        user=user, defaults={"character": character, "skin": skin or ""}
    )


def look_of(user) -> dict | None:
    look = AvatarLook.objects.filter(user=user).first()
    return look.as_wire() if look else None


def shop_state(user) -> dict:
    """Everything the shop page draws, in one read."""
    wallet = _wallet(user)
    owned = _owned(user)
    has_character = any(avatars.parse(key) and avatars.parse(key)[0] == "character" for key in owned)
    return {
        "balance": wallet.balance,
        "today_earned": earned_today(wallet),
        "daily_cap": DAILY_CAP,
        "can_claim_starter": not has_character,
        "starters": list(avatars.STARTERS),
        "look": look_of(user),
        "items": [{**item, "owned": item["key"] in owned} for item in avatars.all_items()],
    }
