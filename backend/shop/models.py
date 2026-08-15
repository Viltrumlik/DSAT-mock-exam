"""The shop: what the school stocks, and what students have ordered from it.

**Two currencies, two shelves.** An item is priced in coins or in strikes, never both, and the
storefront shows them as two sections. That is the school's decision and it happens also to be
the only honest one: coins and strikes are not exchangeable, so a price of "5 coins and 3
strikes" would need a rule for what happens when a student has one and not the other, and
there is no such rule.

They behave differently, which is why the split matters more than it looks. Coins accumulate
and keep. Strikes are an attendance streak — earned by turning up, wiped by one missed lesson
— so the strike shelf is where a student spends something that will otherwise expire. Pricing
one item in both would let a shrinking streak strand a coin balance mid-purchase.

**An order is a promise, not a delivery.** Buying takes the currency immediately and creates a
PENDING order; an administrator hands the thing over and marks it FULFILLED. Stock is
decremented at purchase, not at fulfilment, because the alternative oversells: ten students
buying the last notebook would all succeed and nine would be told later.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


class ShopItem(models.Model):
    CURRENCY_COIN = "COIN"
    CURRENCY_STRIKE = "STRIKE"
    CURRENCY_CHOICES = [
        (CURRENCY_COIN, "Coins"),
        (CURRENCY_STRIKE, "Strikes"),
    ]

    name = models.CharField(max_length=140)
    description = models.TextField(blank=True, default="")
    # Plain ImageField, not the presigned upload path: that exists for 2 GB lesson videos
    # (classes/media_uploads.py), and streaming a product photo through a worker is fine —
    # nginx already allows 60M on /api/.
    image = models.ImageField(upload_to="shop_items/", null=True, blank=True)

    currency = models.CharField(
        max_length=8, choices=CURRENCY_CHOICES, default=CURRENCY_COIN, db_index=True
    )
    price = models.PositiveIntegerField(help_text="Cost in the item's own currency.")
    # "Ombor" — how many are physically on the shelf. Signed on purpose: a stock correction
    # after an oversell should be recordable as the negative it is, rather than clamped to
    # zero and quietly forgotten.
    stock = models.IntegerField(default=0)

    is_active = models.BooleanField(
        default=True, db_index=True,
        help_text="Unticked hides it from students without deleting anything they have ordered.",
    )
    sort_order = models.IntegerField(default=0, help_text="Lower shows first.")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "shop_items"
        ordering = ["sort_order", "name"]
        indexes = [models.Index(fields=["currency", "is_active", "sort_order"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.price} {self.get_currency_display().lower()})"

    @property
    def in_stock(self) -> bool:
        return self.stock > 0


class ShopOrder(models.Model):
    """One purchase. The currency has already left the student's balance when this row exists."""

    STATUS_PENDING = "PENDING"
    STATUS_FULFILLED = "FULFILLED"
    STATUS_CANCELLED = "CANCELLED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Waiting to be handed over"),
        (STATUS_FULFILLED, "Handed over"),
        (STATUS_CANCELLED, "Cancelled and refunded"),
    ]

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shop_orders"
    )
    # PROTECT: an order must outlive a delisted item. Deleting a product should not erase the
    # record that a student paid for one — same reasoning as PointAward.season.
    item = models.ForeignKey(ShopItem, on_delete=models.PROTECT, related_name="orders")

    # Frozen at purchase. Re-reading the item's price later would restate what a student paid
    # every time the school retunes the shop.
    currency = models.CharField(max_length=8, choices=ShopItem.CURRENCY_CHOICES)
    price = models.PositiveIntegerField()
    item_name = models.CharField(
        max_length=140, help_text="Frozen too — a renamed item must not rewrite old orders.",
    )

    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    # The coin movement this order caused, so a wallet row and an order can be tied together.
    # Null for strike purchases, which have their own ledger.
    coin_transaction = models.ForeignKey(
        "rewards.CoinTransaction", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="shop_orders",
    )

    note = models.CharField(max_length=240, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    settled_at = models.DateTimeField(
        null=True, blank=True, help_text="When it was fulfilled or cancelled."
    )
    settled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
    )

    class Meta:
        db_table = "shop_orders"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["student", "-created_at"]),
            models.Index(fields=["status", "-created_at"]),   # the admin's fulfilment queue
        ]

    def __str__(self) -> str:
        return f"{self.student_id} × {self.item_name} [{self.status}]"
