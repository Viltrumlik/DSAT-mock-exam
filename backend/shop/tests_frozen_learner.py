"""A frozen learner signs in, but cannot buy anything.

``PurchaseView`` names its own ``permission_classes``, which REPLACES the project default
(``IsAuthenticatedAndNotFrozen``). It once listed a bare ``IsAuthenticated``, and
``services.purchase`` never looks at ``is_frozen`` — so a debt-frozen student could still spend
coins and take stock off the shelf.
"""

from __future__ import annotations

from rest_framework.test import APIClient

from rewards import coins as coins_service
from rewards.models import CoinTransaction
from shop.models import ShopItem, ShopOrder
from shop.tests_shop import ShopFixture
from users.audience import FROZEN_LCUP_DEBT
from users.permissions import IsAuthenticatedAndNotFrozen


class FrozenLearnerPurchaseTests(ShopFixture):
    def setUp(self):
        super().setUp()
        self._give_coins(3)
        self.api = APIClient()
        self.api.force_authenticate(self.student)

    def _set_frozen(self, frozen: bool) -> None:
        # A queryset update, as the lc-up debt sweep does (no User post_save side effects).
        type(self.student).objects.filter(pk=self.student.pk).update(
            is_frozen=frozen, frozen_reason=FROZEN_LCUP_DEBT if frozen else ""
        )
        self.student.refresh_from_db()
        self.api.force_authenticate(self.student)

    def _buy(self, item):
        return self.api.post(f"/api/shop/items/{item.pk}/purchase/", {}, format="json")

    def assertFrozenRefusal(self, response) -> None:
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.data.get("detail"), IsAuthenticatedAndNotFrozen.message)

    def test_a_frozen_student_cannot_buy_with_coins(self):
        spent_before = CoinTransaction.objects.filter(wallet__student=self.student).count()
        self._set_frozen(True)

        self.assertFrozenRefusal(self._buy(self.coin_item))

        self.assertFalse(ShopOrder.objects.filter(student=self.student).exists())
        self.assertEqual(ShopItem.objects.get(pk=self.coin_item.pk).stock, 2)
        self.assertEqual(coins_service.wallet_state(self.student)["coins"], 3)
        self.assertEqual(
            CoinTransaction.objects.filter(wallet__student=self.student).count(), spent_before
        )

    def test_a_frozen_student_cannot_buy_with_strikes(self):
        self._give_strikes(3)
        self._set_frozen(True)

        self.assertFrozenRefusal(self._buy(self.strike_item))

        self.assertFalse(ShopOrder.objects.filter(student=self.student).exists())
        self.assertEqual(ShopItem.objects.get(pk=self.strike_item.pk).stock, 1)

    def test_an_unfrozen_student_is_unaffected(self):
        r = self._buy(self.coin_item)

        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(ShopOrder.objects.filter(student=self.student).count(), 1)
        self.assertEqual(coins_service.wallet_state(self.student)["coins"], 0)

    def test_lifting_the_freeze_restores_the_shop(self):
        self._set_frozen(True)
        self.assertFrozenRefusal(self._buy(self.coin_item))

        self._set_frozen(False)

        self.assertEqual(self._buy(self.coin_item).status_code, 201)
