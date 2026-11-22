"""The student profile's additions for the lc-up structure (22 Nov 2026): the group card's fields, the ledger account
Take payment writes to, the seat actions' switch, the coin balance, and the Purchases part."""

from datetime import date

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from access.models import Permission, UserPermission
from billing.models import Account
from classes.models import Classroom, ClassroomMembership
from users.models import User

HOST = "admin.mastersat.uz"


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST], LCUP_ENABLED=True)
class ProfileAdditionsTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math", first_name="Bekzod", last_name="Toshmatov")
        self.room = Classroom.objects.create(
            name="Foundation G13 Math", subject="MATH", level="foundation", lesson_days="ODD", lesson_time="16:00-18:00",
            monthly_price=500000, start_date=date(2026, 10, 23), created_by=self.teacher, teacher=self.teacher,
        )
        self.aziz = make("aziz", first_name="Aziz", last_name="Karimov")
        ClassroomMembership.objects.create(
            classroom=self.room, user=self.aziz, role="STUDENT", seat_status="trial", seat_start_date=date(2026, 10, 25)
        )

    def get(self, pk, user=None, part=""):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api.get(f"/api/users/admin/people/{pk}/{part}", HTTP_HOST=HOST)

    def test_a_group_carries_its_card_fields_and_the_seat(self):
        group = self.get(self.aziz.pk).json()["groups"][0]
        self.assertEqual(
            {k: group[k] for k in ("level", "lesson_days", "lesson_time", "monthly_price", "start_date", "seat_status", "seat_start_date")},
            {
                "level": "foundation", "lesson_days": "ODD", "lesson_time": "16:00-18:00", "monthly_price": 500000,
                "start_date": "2026-10-23", "seat_status": "trial", "seat_start_date": "2026-10-25",
            },
        )

    def test_seat_actions_stay_shut_while_lcup_runs(self):
        self.assertFalse(self.get(self.aziz.pk).json()["seats_open"])
        with self.settings(LCUP_ENABLED=False):
            self.assertTrue(self.get(self.aziz.pk).json()["seats_open"])

    def test_the_ledger_account_is_given_with_view_money_only(self):
        self.assertIsNone(self.get(self.aziz.pk).json()["ledger"])  # no account in the ledger yet
        account = Account.objects.create(user=self.aziz, name="Karimov Aziz")
        with self.settings(BILLING_PAYMENTS_OPEN=False):
            self.assertEqual(self.get(self.aziz.pk).json()["ledger"], {"account_id": account.pk, "payments_open": False})
        # An admin with view_money taken away sees no ledger, as they see no lc-up balance.
        permission, _ = Permission.objects.get_or_create(codename=C.PERM_VIEW_MONEY, defaults={"name": "x"})
        UserPermission.objects.create(user=self.admin, permission=permission, granted=False)
        body = self.get(self.aziz.pk).json()
        self.assertIsNone(body["ledger"])
        self.assertIsNone(body["lcup"])

    def test_coins_are_none_without_a_wallet_and_the_balance_with_one(self):
        from rewards.models import StudentWallet

        self.assertIsNone(self.get(self.aziz.pk).json()["coins"])
        StudentWallet.objects.create(student=self.aziz, coins_balance=120)
        self.assertEqual(self.get(self.aziz.pk).json()["coins"], 120)
        self.assertIsNone(self.get(self.teacher.pk).json()["coins"])

    def test_the_purchases_part_lists_shop_orders_newest_first(self):
        from shop.models import ShopItem, ShopOrder

        item = ShopItem.objects.create(name="Notebook", currency=ShopItem.CURRENCY_COIN, price=3, stock=5)
        first = ShopOrder.objects.create(student=self.aziz, item=item, currency="COIN", price=3, item_name="Notebook")
        second = ShopOrder.objects.create(
            student=self.aziz, item=item, currency="COIN", price=3, item_name="Notebook (blue)", status="FULFILLED"
        )
        body = self.get(self.aziz.pk, part="purchases/").json()
        self.assertEqual([o["id"] for o in body["orders"]], [second.pk, first.pk])
        self.assertEqual(
            {k: body["orders"][0][k] for k in ("item", "currency", "price", "status", "status_label")},
            {"item": "Notebook (blue)", "currency": "COIN", "price": 3, "status": "FULFILLED", "status_label": "Handed over"},
        )
        self.assertFalse(body["truncated"])
