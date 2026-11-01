"""``forecast.need_next_24h`` and the overview's ``forecast`` / ``month`` blocks."""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest import mock

from django.core.cache import cache
from django.utils import timezone

from lcup.models import LcupStudentLink
from sms import campaigns, debt_warnings, forecast, views
from sms import templates as T
from sms.models import SmsCampaign, SmsMessage
from sms.tests_api import ORIGINAL_64942, ApiFixture

PRICE = 170


def at(day, hour):
    return timezone.make_aware(datetime(2026, 11, day, hour, 0))


def cost_of(texts):
    return sum(T.parts(text) for text in texts) * PRICE


class NeedTests(ApiFixture):
    def fresh_balances(self, now):
        LcupStudentLink.objects.update(balance_seen_at=now)

    def campaign(self, when):
        return SmsCampaign.objects.create(
            template_eskiz_id=64942, pattern=T.DEBT_WARNING.text, original=ORIGINAL_64942, slot_roles=["student"],
            slot_texts=[""], audience=SmsCampaign.AUDIENCE_STUDENT, audience_ids=[self.malika.pk], scheduled_at=when,
        )

    def test_a_campaign_in_3h_counts_and_one_in_30h_does_not(self):
        now = at(10, 12)
        self.fresh_balances(now)
        soon = self.campaign(now + timedelta(hours=3))
        self.campaign(now + timedelta(hours=30))
        expected = cost_of(r.text for r in campaigns.resolve(soon, now=now)[0])
        self.assertGreater(expected, 0)
        self.assertEqual(forecast.need_next_24h(now)["campaigns"], expected)

    def test_tomorrows_debt_run_counts_after_todays_hour(self):
        now = at(3, 12)  # day 3, after the 10:00 run: tomorrow (day 4) is a warning day
        self.fresh_balances(now)
        expected = cost_of(w.text for w in debt_warnings.plan(now, today=at(4, 12).date()).warnings)
        self.assertGreater(expected, 0)
        self.assertEqual(forecast.need_next_24h(now)["debt"], expected)

    def test_no_debt_run_the_day_before_the_freeze(self):
        now = at(5, 12)  # tomorrow is day 6, the freeze: no warning
        self.fresh_balances(now)
        self.assertEqual(forecast.need_next_24h(now)["debt"], 0)

    def test_before_the_hour_only_todays_people_left_count(self):
        now = at(3, 9)
        self.fresh_balances(now)
        planned = debt_warnings.plan(now, today=now.date())
        full = cost_of(w.text for w in planned.warnings)
        self.assertEqual(forecast.need_next_24h(now)["debt"], full)
        SmsMessage.objects.create(
            kind=SmsMessage.KIND_DEBT_WARNING, run_on=now.date(), dedupe_key=planned.warnings[0].dedupe_key,
            phone="998901234567", text="x", status=SmsMessage.STATUS_SENT,
        )
        self.assertEqual(forecast.need_next_24h(now)["debt"], full - cost_of([planned.warnings[0].text]))

    def test_the_total_adds_the_parts(self):
        now = at(3, 12)
        self.fresh_balances(now)
        self.campaign(now + timedelta(hours=1))
        need = forecast.need_next_24h(now)
        self.assertEqual(need["total"], need["debt"] + need["campaigns"] + need["automations"])
        self.assertEqual(need["automations"], 0)


class OverviewForecastTests(ApiFixture):
    def overview(self):
        with mock.patch("sms.views._today", return_value=timezone.localdate()):
            return self.get("overview/").json()

    def test_short_only_when_the_balance_is_known_and_below_the_need(self):
        need = {"debt": 300, "campaigns": 40, "automations": 0, "total": 340}
        with mock.patch("sms.forecast.need_next_24h", return_value=need):
            cache.set(views.BALANCE_KEY, {"balance": None}, 60)
            self.assertEqual(self.overview()["forecast"]["short"], False)
            cache.set(views.BALANCE_KEY, {"balance": 50}, 60)
            self.assertEqual(self.overview()["forecast"], {**need, "balance": 50, "short": True})
            cache.set(views.BALANCE_KEY, {"balance": 1000}, 60)
            self.assertEqual(self.overview()["forecast"]["short"], False)

    def test_the_month_block(self):
        SmsMessage.objects.create(
            kind="test", run_on=timezone.localdate(), dedupe_key="t", phone="998901234567", text="x",
            status=SmsMessage.STATUS_DELIVERED, parts=1, unit_price=PRICE,
        )
        self.assertEqual(self.overview()["month"], {"sent": 1, "rate": 1.0, "cost": PRICE})
