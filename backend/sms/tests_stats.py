"""``sms.stats`` and ``GET /api/sms/admin/stats/``: delivery, cost and the debt warning's effect."""

from __future__ import annotations

from datetime import date, datetime
from datetime import timezone as dt_timezone

from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.models import LcupPayment
from sms import stats
from sms.models import SmsMessage
from sms.tests_api import ApiFixture

NOV1 = date(2026, 11, 1)
S = SmsMessage


def tashkent(y, mo, d, h=12, mi=0):
    return timezone.make_aware(datetime(y, mo, d, h, mi))


_n = 0


def sms(status, *, at=None, phone="998901234567", kind=S.KIND_DEBT_WARNING, parts=1, unit_price=None,
        lcup_student_id=None, run_on=NOV1):
    global _n
    _n += 1
    row = S.objects.create(
        kind=kind, run_on=run_on, dedupe_key=f"k{_n}", phone=phone, text="x", status=status, parts=parts,
        unit_price=unit_price, lcup_student_id=lcup_student_id,
    )
    S.objects.filter(pk=row.pk).update(created_at=at or tashkent(2026, 11, 1))
    return row


@override_settings(SMS_PRICE_PER_PART=170)
class SummaryTests(TestCase):
    def test_by_day_counts_and_rate_leave_unfinished_out(self):
        for status in (S.STATUS_DELIVERED, S.STATUS_DELIVERED, S.STATUS_UNDELIVERED, S.STATUS_SENT):
            sms(status)
        day = stats.summary(NOV1, NOV1)["by_day"][0]
        self.assertEqual(
            {k: day[k] for k in ("day", "delivered", "undelivered", "rejected", "pending")},
            {"day": "2026-11-01", "delivered": 2, "undelivered": 1, "rejected": 0, "pending": 1},
        )
        self.assertAlmostEqual(day["rate"], 2 / 3)

    def test_rate_is_none_without_finished_rows(self):
        sms(S.STATUS_SENT)
        result = stats.summary(NOV1, NOV1)
        self.assertIsNone(result["by_day"][0]["rate"])
        self.assertIsNone(result["totals"]["rate"])

    def test_cost_uses_the_rows_price_then_todays(self):
        sms(S.STATUS_DELIVERED, parts=2, unit_price=200)
        sms(S.STATUS_DELIVERED, parts=None, unit_price=None)
        self.assertEqual(stats.summary(NOV1, NOV1)["totals"]["cost"], 400 + 170)

    def test_failed_and_refused_cost_nothing(self):
        sms(S.STATUS_FAILED)
        sms(S.STATUS_REJECTED)
        self.assertEqual(stats.summary(NOV1, NOV1)["totals"]["cost"], 0)

    def test_totals(self):
        for status in (S.STATUS_DELIVERED, S.STATUS_UNDELIVERED, S.STATUS_REJECTED, S.STATUS_FAILED, S.STATUS_SENT):
            sms(status)
        totals = stats.summary(NOV1, NOV1)["totals"]
        self.assertEqual(
            {k: totals[k] for k in ("sent", "delivered", "undelivered", "rejected", "failed", "pending")},
            {"sent": 3, "delivered": 1, "undelivered": 1, "rejected": 1, "failed": 1, "pending": 1},
        )

    def test_operators_in_fixed_order_and_other_last(self):
        sms(S.STATUS_DELIVERED, phone="998201234567")
        sms(S.STATUS_UNDELIVERED, phone="998991234567")
        sms(S.STATUS_DELIVERED, phone="998991234567")
        sms(S.STATUS_DELIVERED, phone="998901234567")
        rows = stats.summary(NOV1, NOV1)["by_operator"]
        self.assertEqual([r["operator"] for r in rows], ["Beeline", "Uzmobile", "Other"])
        uz = rows[1]
        self.assertEqual((uz["total"], uz["delivered"], uz["rate"]), (2, 1, 0.5))

    def test_the_day_is_tashkents(self):
        sms(S.STATUS_DELIVERED, at=datetime(2026, 10, 31, 19, 30, tzinfo=dt_timezone.utc))  # 00:30 on 1 Nov there
        self.assertEqual(stats.summary(NOV1, NOV1)["by_day"][0]["day"], "2026-11-01")
        self.assertEqual(stats.summary(date(2026, 10, 31), date(2026, 10, 31))["by_day"], [])

    def test_cost_by_month_splits_the_kinds(self):
        sms(S.STATUS_DELIVERED, kind=S.KIND_DEBT_WARNING)
        sms(S.STATUS_DELIVERED, kind=S.KIND_CAMPAIGN, parts=2)
        sms(S.STATUS_DELIVERED, kind=S.KIND_TEST, at=tashkent(2026, 10, 20))
        rows = stats.summary(date(2026, 10, 1), NOV1)["cost_by_month"]
        self.assertEqual(
            rows,
            [
                {"month": "2026-10", "debt_warning": 0, "campaign": 0, "automation": 0, "test": 170, "total": 170},
                {"month": "2026-11", "debt_warning": 170, "campaign": 340, "automation": 0, "test": 0, "total": 510},
            ],
        )


class DebtEffectTests(TestCase):
    def pay(self, lcup_id, on, kind="payment"):
        LcupPayment.objects.create(
            lcup_payment_id=lcup_id * 100 + on.day, lcup_student_id=lcup_id, kind=kind, amount=100000, paid_on=on,
            synced_at=timezone.now(),
        )

    def test_paid_within_1_3_5_days_of_the_first_warning(self):
        for lcup_id in (1, 2, 3, 4):
            sms(S.STATUS_DELIVERED, lcup_student_id=lcup_id, run_on=NOV1)
            sms(S.STATUS_DELIVERED, lcup_student_id=lcup_id, run_on=date(2026, 11, 2))
        sms(S.STATUS_FAILED, lcup_student_id=5, run_on=NOV1)  # never reached eskiz: not warned
        self.pay(1, NOV1)
        self.pay(2, date(2026, 11, 3))
        self.pay(3, date(2026, 11, 5))
        self.pay(4, date(2026, 11, 2), kind="refund")
        self.pay(4, date(2026, 10, 30))  # before the warning
        self.assertEqual(
            stats.debt_effect(3, today=date(2026, 11, 8)),
            [{"month": "2026-11", "warned": 4, "paid_1": 1, "paid_3": 2, "paid_5": 3, "unpaid": 1}],
        )


class StatsApiTests(ApiFixture):
    def test_shape_and_default_range(self):
        sms(S.STATUS_DELIVERED, at=timezone.now())
        response = self.get("stats/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(set(body), {"from", "to", "totals", "by_day", "by_operator", "cost_by_month", "debt_effect"})
        today = timezone.localdate()
        self.assertEqual(body["to"], today.isoformat())
        self.assertEqual(date.fromisoformat(body["from"]), today.fromordinal(today.toordinal() - 29))

    def test_range_errors_are_400_range(self):
        for params in (
            {"from": "2026-11-05", "to": "2026-11-01"},
            {"from": "2025-01-01", "to": "2026-11-01"},
            {"from": "yesterday"},
        ):
            response = self.get("stats/", **params)
            self.assertEqual((response.status_code, response.json().get("code")), (400, "range"), params)

    def test_teachers_are_refused(self):
        self.assertEqual(self.get("stats/", user=self.teacher).status_code, 403)
