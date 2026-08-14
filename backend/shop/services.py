"""Buying, fulfilling and cancelling — the only supported ways an order moves.

Every currency movement goes through the existing ledgers: ``rewards.coins.spend`` and
``rewards.strikes.spend``. Nothing here writes a ``CoinTransaction`` or a ``StrikeTransaction``
by hand. Those functions own the locking, the insufficient-funds rule and the audit row, and a
second implementation of any of the three would drift from the first within a term.

**Lock order is stock, then wallet.** Always, in every function here. Two students buying the
last two of an item take the item row first and the wallet second; if one path ever took them
the other way round, two concurrent purchases would deadlock on Postgres. There is no reason
to vary it, so the rule is simply: item first.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from rewards import coins as coins_service
from rewards import strikes as strikes_service

from .models import ShopItem, ShopOrder


def _reference(item) -> str:
    """What the wallet history will say. The ledger is the only record of what was bought."""
    return f"Shop: {item.name}"


@transaction.atomic
def purchase(student, item_id: int, *, actor=None) -> ShopOrder:
    """Buy one item. Takes the currency, decrements stock, and returns a PENDING order.

    Stock comes off now rather than at fulfilment. Deferring it oversells: ten students
    buying the last notebook would all be told yes, and nine would find out days later when
    an administrator got to the queue.
    """
    item = ShopItem.objects.select_for_update().filter(pk=item_id).first()
    if item is None:
        raise ValidationError("That item is not in the shop.")
    if not item.is_active:
        raise ValidationError("That item is not on sale right now.")
    if item.stock <= 0:
        raise ValidationError("That one is out of stock.")

    if item.currency == ShopItem.CURRENCY_COIN:
        # Raises ValidationError when short, with the number they have — which is the message
        # the student should see, so it is deliberately not caught and reworded here.
        coin_tx = coins_service.spend(
            student, item.price, reference=_reference(item), actor=actor
        )
    else:
        strikes_service.spend(student, item.price, reference=_reference(item), actor=actor)
        coin_tx = None

    item.stock = int(item.stock) - 1
    item.save(update_fields=["stock", "updated_at"])

    return ShopOrder.objects.create(
        student=student,
        item=item,
        currency=item.currency,
        price=item.price,
        item_name=item.name,
        coin_transaction=coin_tx,
    )


@transaction.atomic
def fulfil(order_id: int, *, actor, note: str = "") -> ShopOrder:
    """An administrator handed the thing over."""
    order = ShopOrder.objects.select_for_update().filter(pk=order_id).first()
    if order is None:
        raise ValidationError("No such order.")
    if order.status != ShopOrder.STATUS_PENDING:
        raise ValidationError(f"That order is already {order.get_status_display().lower()}.")

    order.status = ShopOrder.STATUS_FULFILLED
    order.settled_at = timezone.now()
    order.settled_by = actor
    if note:
        order.note = note
    order.save(update_fields=["status", "settled_at", "settled_by", "note"])
    return order


@transaction.atomic
def cancel(order_id: int, *, actor, note: str = "") -> ShopOrder:
    """Cancel a pending order, refund what can be refunded, and put the stock back.

    The two currencies refund differently, and the difference is not a bug.

    Coins keep, so a coin refund always lands in full.

    Strikes do not. They are an attendance streak, and if it broke between the purchase and
    the cancellation there is nothing left to refund into — ``strikes.refund`` returns None and
    the student gets their stock back but not their strikes. Inventing strikes their attendance
    no longer supports would make the streak a lie, which is the one thing it cannot be. The
    note records what happened so an administrator can see it rather than guess.
    """
    order = ShopOrder.objects.select_for_update().filter(pk=order_id).first()
    if order is None:
        raise ValidationError("No such order.")
    if order.status != ShopOrder.STATUS_PENDING:
        raise ValidationError(f"That order is already {order.get_status_display().lower()}.")

    reason = f"Refund: {order.item_name}"
    refunded = True
    if order.currency == ShopItem.CURRENCY_COIN:
        coins_service.adjust(order.student, order.price, reason=reason, actor=actor)
    else:
        refunded = strikes_service.refund(
            order.student, order.price, reference=reason, actor=actor
        ) is not None

    item = ShopItem.objects.select_for_update().get(pk=order.item_id)
    item.stock = int(item.stock) + 1
    item.save(update_fields=["stock", "updated_at"])

    order.status = ShopOrder.STATUS_CANCELLED
    order.settled_at = timezone.now()
    order.settled_by = actor
    order.note = note or (
        "" if refunded else "Strikes could not be refunded — the streak had already reset."
    )
    order.save(update_fields=["status", "settled_at", "settled_by", "note"])
    return order


def affordability(student, items):
    """``{item_id: {"affordable": bool, "short_by": int}}`` for a list of items.

    Computed server-side so the storefront never has to do currency arithmetic, and phrased as
    *how much more is needed* rather than as a refusal — the student-facing copy rule is that
    the shop says what is still missing, never "you can't afford this".
    """
    wallet = coins_service.wallet_state(student)
    strike_state = strikes_service.state(student)
    have = {
        ShopItem.CURRENCY_COIN: wallet["coins"],
        ShopItem.CURRENCY_STRIKE: strike_state["strikes"],
    }
    return {
        item.pk: {
            "affordable": have.get(item.currency, 0) >= item.price and item.in_stock,
            "short_by": max(0, item.price - have.get(item.currency, 0)),
        }
        for item in items
    }
