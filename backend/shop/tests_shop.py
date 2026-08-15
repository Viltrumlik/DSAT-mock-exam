"""The shop: two currencies, two shelves, and an order that outlives the item.

The interesting cases are all about money and stock disagreeing — a purchase that takes the
currency but not the stock, a cancellation that restocks but does not refund, a refund of a
streak that no longer exists.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from rewards import coins as coins_service
from rewards import strikes as strikes_service
from rewards.models import CoinTransaction
from rewards.services import award
from shop import services
from shop.models import ShopItem, ShopOrder

User = get_user_model()


def _u(email, **kw):
    return User.objects.create_user(email, "secret123", **kw)


class ShopFixture(TestCase):
    def setUp(self):
        self.staff = _u("sh_admin@t.com", role=C.ROLE_ADMIN)
        self.teacher = _u("sh_teacher@t.com")
        self.student = _u("sh_student@t.com")

        self.coin_item = ShopItem.objects.create(
            name="Notebook", currency=ShopItem.CURRENCY_COIN, price=3, stock=2,
        )
        self.strike_item = ShopItem.objects.create(
            name="Free lesson pass", currency=ShopItem.CURRENCY_STRIKE, price=2, stock=1,
        )

        self.classroom = Classroom.objects.create(
            name="Shop class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )

    def _give_coins(self, n):
        award(self.student, "MANUAL", idempotency_key=f"coins-{n}", points=n * 10)
        coins_service.convert(self.student)

    def _give_strikes(self, n, start=0):
        for offset in range(n):
            session = AttendanceSession.objects.create(
                classroom=self.classroom, date=date(2026, 8, 1) + timedelta(days=start + offset),
                status=AttendanceSession.STATUS_FINALIZED, created_by=self.teacher,
            )
            AttendanceRecord.objects.create(
                session=session, student=self.student, status="PRESENT", marked_by=self.teacher
            )

    def _break_streak(self, at=50):
        session = AttendanceSession.objects.create(
            classroom=self.classroom, date=date(2026, 8, 1) + timedelta(days=at),
            status=AttendanceSession.STATUS_FINALIZED, created_by=self.teacher,
        )
        AttendanceRecord.objects.create(
            session=session, student=self.student, status="ABSENT", marked_by=self.teacher
        )


class PurchaseTests(ShopFixture):
    def test_a_coin_purchase_takes_coins_and_stock(self):
        self._give_coins(1)     # 10 points → 1 coin... not enough
        self._give_coins(5)     # plenty

        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)

        self.coin_item.refresh_from_db()
        self.assertEqual(self.coin_item.stock, 1)
        self.assertEqual(order.status, ShopOrder.STATUS_PENDING)
        self.assertEqual(order.price, 3)
        self.assertIsNotNone(order.coin_transaction)

    def test_a_strike_purchase_takes_strikes_and_leaves_coins_alone(self):
        self._give_coins(5)
        self._give_strikes(4)

        services.purchase(self.student, self.strike_item.pk, actor=self.student)

        self.assertEqual(strikes_service.state(self.student)["strikes"], 2)
        self.assertEqual(strikes_service.state(self.student)["current_streak"], 4)
        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)

    def test_the_order_freezes_the_name_and_price(self):
        """A renamed or repriced item must not rewrite what a student already paid."""
        self._give_coins(5)
        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)

        self.coin_item.name = "Premium notebook"
        self.coin_item.price = 99
        self.coin_item.save()
        order.refresh_from_db()

        self.assertEqual(order.item_name, "Notebook")
        self.assertEqual(order.price, 3)

    def test_not_enough_currency_is_refused_and_takes_no_stock(self):
        with self.assertRaises(ValidationError):
            services.purchase(self.student, self.coin_item.pk, actor=self.student)

        self.coin_item.refresh_from_db()
        self.assertEqual(self.coin_item.stock, 2)
        self.assertEqual(ShopOrder.objects.count(), 0)

    def test_unconverted_points_do_not_buy_anything(self):
        """Conversion is manual, and a purchase is not a request to convert."""
        award(self.student, "MANUAL", idempotency_key="unconverted", points=500)

        with self.assertRaises(ValidationError):
            services.purchase(self.student, self.coin_item.pk, actor=self.student)

    def test_an_out_of_stock_item_is_refused_and_costs_nothing(self):
        self._give_coins(5)
        self.coin_item.stock = 0
        self.coin_item.save()

        with self.assertRaises(ValidationError):
            services.purchase(self.student, self.coin_item.pk, actor=self.student)

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)

    def test_an_inactive_item_cannot_be_bought(self):
        self._give_coins(5)
        self.coin_item.is_active = False
        self.coin_item.save()

        with self.assertRaises(ValidationError):
            services.purchase(self.student, self.coin_item.pk, actor=self.student)

    def test_stock_runs_out_after_the_last_one(self):
        self._give_coins(20)     # enough for three, so only stock can refuse the third
        services.purchase(self.student, self.coin_item.pk, actor=self.student)
        services.purchase(self.student, self.coin_item.pk, actor=self.student)

        with self.assertRaises(ValidationError):
            services.purchase(self.student, self.coin_item.pk, actor=self.student)


class SettlementTests(ShopFixture):
    def test_fulfilling_marks_it_handed_over(self):
        self._give_coins(5)
        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)

        settled = services.fulfil(order.pk, actor=self.staff)

        self.assertEqual(settled.status, ShopOrder.STATUS_FULFILLED)
        self.assertIsNotNone(settled.settled_at)
        self.assertEqual(settled.settled_by, self.staff)

    def test_an_order_cannot_be_settled_twice(self):
        self._give_coins(5)
        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)
        services.fulfil(order.pk, actor=self.staff)

        with self.assertRaises(ValidationError):
            services.fulfil(order.pk, actor=self.staff)
        with self.assertRaises(ValidationError):
            services.cancel(order.pk, actor=self.staff)

    def test_cancelling_a_coin_order_refunds_in_full_and_restocks(self):
        self._give_coins(5)
        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)

        services.cancel(order.pk, actor=self.staff)

        self.assertEqual(coins_service.wallet_for(self.student).coins_balance, 5)
        self.coin_item.refresh_from_db()
        self.assertEqual(self.coin_item.stock, 2)
        self.assertTrue(
            CoinTransaction.objects.filter(kind=CoinTransaction.KIND_ADMIN_GRANT).exists()
        )

    def test_cancelling_a_strike_order_refunds_when_the_streak_survived(self):
        self._give_strikes(4)
        order = services.purchase(self.student, self.strike_item.pk, actor=self.student)

        services.cancel(order.pk, actor=self.staff)

        self.assertEqual(strikes_service.state(self.student)["strikes"], 4)

    def test_cancelling_a_strike_order_after_a_reset_restocks_but_cannot_refund(self):
        """The documented asymmetry: coins keep, strikes do not. Inventing strikes the
        student's attendance no longer supports would make the streak a lie."""
        self._give_strikes(4)
        order = services.purchase(self.student, self.strike_item.pk, actor=self.student)
        self._break_streak()

        settled = services.cancel(order.pk, actor=self.staff)

        self.assertEqual(strikes_service.state(self.student)["strikes"], 0)
        self.strike_item.refresh_from_db()
        self.assertEqual(self.strike_item.stock, 1)         # stock always comes back
        self.assertIn("could not be refunded", settled.note)


class AffordabilityTests(ShopFixture):
    def test_it_says_how_much_more_is_needed(self):
        """The copy rule: the shop never says "you can't afford this", it says what is short."""
        self._give_coins(2)      # 2 coins, notebook costs 3

        result = services.affordability(self.student, [self.coin_item, self.strike_item])

        self.assertFalse(result[self.coin_item.pk]["affordable"])
        self.assertEqual(result[self.coin_item.pk]["short_by"], 1)
        self.assertEqual(result[self.strike_item.pk]["short_by"], 2)

    def test_an_out_of_stock_item_is_not_affordable_even_when_paid_for(self):
        self._give_coins(9)
        self.coin_item.stock = 0
        self.coin_item.save()

        result = services.affordability(self.student, [self.coin_item])

        self.assertFalse(result[self.coin_item.pk]["affordable"])
        self.assertEqual(result[self.coin_item.pk]["short_by"], 0)   # not short — just gone


class ShopApiTests(ShopFixture):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def test_the_storefront_returns_both_shelves_and_both_balances(self):
        self._give_coins(5)
        self._give_strikes(3)
        self.client.force_authenticate(self.student)

        body = self.client.get("/api/shop/").json()

        self.assertEqual(body["coins"], 5)
        self.assertEqual(body["strikes"], 3)
        self.assertEqual([i["name"] for i in body["coin_items"]], ["Notebook"])
        self.assertEqual([i["name"] for i in body["strike_items"]], ["Free lesson pass"])

    def test_a_hidden_item_is_not_on_the_storefront(self):
        self.coin_item.is_active = False
        self.coin_item.save()
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get("/api/shop/").json()["coin_items"], [])

    def test_a_student_can_buy(self):
        self._give_coins(5)
        self.client.force_authenticate(self.student)

        response = self.client.post(f"/api/shop/items/{self.coin_item.pk}/purchase/")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["order"]["item_name"], "Notebook")

    def test_a_refused_purchase_says_what_is_missing(self):
        self.client.force_authenticate(self.student)

        response = self.client.post(f"/api/shop/items/{self.coin_item.pk}/purchase/")

        self.assertEqual(response.status_code, 400)
        self.assertIn("Not enough coins", response.json()["detail"])

    def test_a_student_only_sees_their_own_orders(self):
        self._give_coins(5)
        services.purchase(self.student, self.coin_item.pk, actor=self.student)
        other = _u("sh_other@t.com")
        self.client.force_authenticate(other)

        self.assertEqual(self.client.get("/api/shop/orders/").json()["orders"], [])

    def test_a_student_cannot_reach_the_inventory(self):
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get("/api/shop/admin/items/").status_code, 403)
        self.assertEqual(self.client.get("/api/shop/admin/orders/").status_code, 403)

    def test_a_teacher_cannot_reach_the_inventory_either(self):
        teacher = _u("sh_t2@t.com", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.client.force_authenticate(teacher)

        self.assertEqual(self.client.get("/api/shop/admin/items/").status_code, 403)

    def test_staff_can_add_an_item(self):
        self.client.force_authenticate(self.staff)

        response = self.client.post("/api/shop/admin/items/", {
            "name": "Sticker", "description": "A shiny one",
            "currency": "COIN", "price": 1, "stock": 10,
        }, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Sticker")

    def test_a_free_item_is_refused(self):
        """Price zero would let a student take unlimited stock with no balance at all."""
        self.client.force_authenticate(self.staff)

        response = self.client.post("/api/shop/admin/items/", {
            "name": "Nothing", "currency": "COIN", "price": 0, "stock": 5,
        }, format="json")

        self.assertEqual(response.status_code, 400)

    def test_the_fulfilment_queue_defaults_to_pending(self):
        self._give_coins(20)
        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)
        services.fulfil(order.pk, actor=self.staff)
        second = services.purchase(self.student, self.coin_item.pk, actor=self.student)
        self.client.force_authenticate(self.staff)

        body = self.client.get("/api/shop/admin/orders/").json()

        self.assertEqual([o["id"] for o in body["orders"]], [second.pk])

    def test_staff_settle_an_order_over_http(self):
        self._give_coins(5)
        order = services.purchase(self.student, self.coin_item.pk, actor=self.student)
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            f"/api/shop/admin/orders/{order.pk}/settle/", {"action": "fulfil"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], ShopOrder.STATUS_FULFILLED)

    def test_deleting_an_ordered_item_hides_it_instead(self):
        """PROTECT would raise; this turns a 500 into an answer, and keeps the order readable."""
        self._give_coins(5)
        services.purchase(self.student, self.coin_item.pk, actor=self.student)
        self.client.force_authenticate(self.staff)

        response = self.client.delete(f"/api/shop/admin/items/{self.coin_item.pk}/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["deleted"])
        self.coin_item.refresh_from_db()
        self.assertFalse(self.coin_item.is_active)

    def test_an_unordered_item_deletes_properly(self):
        self.client.force_authenticate(self.staff)

        response = self.client.delete(f"/api/shop/admin/items/{self.strike_item.pk}/")

        self.assertTrue(response.json()["deleted"])
        self.assertFalse(ShopItem.objects.filter(pk=self.strike_item.pk).exists())
