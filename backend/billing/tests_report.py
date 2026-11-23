"""Reports for a period (owner 2026-11-22: reports leave lc-up too; design "Yes, approved")."""

import uuid
from datetime import date, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing import ledger
from billing.models import Account, BillingState, EndReason, EntryKind, Expense, ExpenseCategory, PastPayment, Seat, SeatState, Span
from billing.report import period_report

User = get_user_model()
HOST = "admin.mastersat.uz"
TODAY = date(2026, 12, 10)
DEC = (date(2026, 12, 1), date(2026, 12, 31))


def account(name, *, spans=()):
    acc = Account.objects.create(name=name)
    seat = Seat.objects.create(account=acc, group_name="Junior G1", price=500_000, days=[1, 3, 5], state=SeatState.ACTIVE)
    for start, end, why in spans:
        Span.objects.create(seat=seat, start=start, end=end, ended_by=why)
    return acc


class Fixture(TestCase):
    def setUp(self):
        BillingState.objects.update_or_create(pk=1, defaults={"opened_at": timezone.make_aware(timezone.datetime(2026, 11, 4, 12))})
        self.ali = account("Ali", spans=[(date(2026, 12, 2), None, "")])  # new in December
        self.vali = account("Vali", spans=[(date(2026, 11, 2), date(2026, 12, 4), EndReason.LEAVE)])  # left
        self.sami = account("Sami", spans=[(date(2026, 11, 2), date(2026, 12, 3), EndReason.FREEZE)])  # froze
        self.mover = account(  # moved group on 5 Dec: not "left"
            "Mover", spans=[(date(2026, 11, 2), date(2026, 12, 4), EndReason.LEAVE), (date(2026, 12, 5), None, "")]
        )
        post = ledger.post
        post(self.ali, EntryKind.CHARGE, -500_000, date(2026, 12, 2), f"first:{self.ali.pk}")
        post(self.mover, EntryKind.CHARGE, -38_500, date(2026, 12, 7), "lesson:1:2026-12-07")
        post(self.vali, EntryKind.CHARGE, -500_000, date(2026, 12, 1), "charge:2:2026-12")
        post(self.vali, EntryKind.CREDIT, 115_500, date(2026, 12, 4), "credit:2:2026-12")
        post(self.vali, EntryKind.OPENING, -200_000, date(2026, 11, 4), "opening:9")
        post(self.ali, EntryKind.PAYMENT, 500_000, date(2026, 12, 2), "p1", method="Naqd pul")
        post(self.mover, EntryKind.PAYMENT, 160_000, date(2026, 12, 8), "p2", method="Plastik karta")
        post(self.mover, EntryKind.REFUND, -50_000, date(2026, 12, 9), "r1", method="Plastik karta")
        post(self.sami, EntryKind.ADJUST, 10_000, date(2026, 12, 9), "a1", note="rounding")
        voided = post(self.mover, EntryKind.PAYMENT, 999_000, date(2026, 12, 9), "p3", method="Naqd pul")
        ledger.void(voided, "typed twice")
        PastPayment.objects.create(
            lcup_payment_id=1, lcup_student_id=1, name="Old", kind=EntryKind.PAYMENT, amount=400_000, day=date(2026, 11, 2),
            method="Naqd pul",
        )
        rent = ExpenseCategory.objects.create(name="Rent")
        for amount, voided_at in ((4_000_000, None), (1_000, timezone.now())):
            Expense.objects.create(
                day=date(2026, 12, 5), amount=amount, category=rent, method="Bank hisobi", reason="rent", request_id=uuid.uuid4(),
                voided_at=voided_at,
            )


class ReportTests(Fixture):
    def test_money_in_out_and_the_net(self):
        r = period_report(*DEC, today=TODAY)
        self.assertEqual(r["money_in"]["paid"], 660_000)  # the voided 999,000 is not money
        self.assertEqual(
            r["money_in"]["by_method"], [{"method": "Naqd pul", "total": 500_000}, {"method": "Plastik karta", "total": 160_000}]
        )
        self.assertEqual((r["money_in"]["refunded"], r["money_in"]["payments"]), (-50_000, 2))
        self.assertEqual(r["money_out"], {"total": 4_000_000, "count": 1, "by_category": [{"name": "Rent", "total": 4_000_000, "count": 1}]})
        self.assertEqual(r["net"], 660_000 - 50_000 - 4_000_000)

    def test_lc_ups_past_payments_count_in_their_month(self):
        r = period_report(date(2026, 11, 1), date(2026, 11, 30), today=TODAY)
        self.assertEqual(r["money_in"]["by_method"], [{"method": "Naqd pul", "total": 400_000}])

    def test_what_the_seats_earned(self):
        earned = period_report(*DEC, today=TODAY)["earned"]
        self.assertEqual(
            (earned["first_months"], earned["lessons"], earned["monthly"], earned["given_back"], earned["total"], earned["adjustments"]),
            (500_000, 38_500, 500_000, 115_500, 923_000, 10_000),
        )

    def test_students_active_each_day_new_left_and_frozen(self):
        s = period_report(*DEC, today=TODAY)["students"]
        days = {row["day"]: row["count"] for row in s["active_per_day"]}
        self.assertEqual(len(days), 10)  # up to today, not the rest of the month
        self.assertEqual((days["2026-12-01"], days["2026-12-02"], days["2026-12-04"], days["2026-12-05"]), (3, 4, 3, 2))
        self.assertEqual((s["active_at_end"], s["new"], s["left"], s["froze"]), (2, 1, 1, 1))

    def test_the_debt_as_the_period_ended(self):
        debt = period_report(date(2026, 11, 1), date(2026, 11, 30), today=TODAY)["debt"]
        self.assertEqual(debt, {"as_of": "2026-11-30", "debtors": 1, "total": 200_000})
        self.assertEqual(period_report(*DEC, today=TODAY)["debt"]["as_of"], "2026-12-10")

    def test_before_the_ledger_opened_there_is_no_debt_figure(self):
        r = period_report(date(2026, 10, 1), date(2026, 10, 31), today=TODAY)
        self.assertEqual((r["ledger_opened"], r["debt"]["total"], r["debt"]["debtors"]), ("2026-11-04", None, None))


@override_settings(ALLOWED_HOSTS=[HOST, "testserver"])
class ApiTests(Fixture):
    def get(self, user, **params):
        api = APIClient()
        api.force_authenticate(user)
        with mock.patch("billing.views_report.timezone.localdate", return_value=TODAY):
            return api.get("/api/billing/report/", params, HTTP_HOST=HOST)

    def test_who_may_read_it(self):
        for role, code in (("super_admin", 200), ("admin", 200), ("accountant", 200), ("teacher", 403), ("student", 403)):
            extra = {"subject": "math"} if role == "teacher" else {}
            user = User.objects.create_user(None, password=None, username=f"u_{role}", role=role, **extra)
            self.assertEqual(self.get(user).status_code, code, role)

    def test_this_month_by_default_and_a_year_at_most(self):
        boss = User.objects.create_user(None, password=None, username="boss", role="admin")
        body = self.get(boss).json()
        self.assertEqual((body["from"], body["to"]), ("2026-12-01", "2026-12-31"))
        start = date(2026, 1, 1)
        self.assertEqual(self.get(boss, **{"from": start.isoformat(), "to": (start + timedelta(days=366)).isoformat()}).status_code, 400)
        self.assertEqual(self.get(boss, **{"from": "2026-12-05", "to": "2026-12-01"}).status_code, 400)
