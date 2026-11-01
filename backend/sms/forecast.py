"""What the next 24 hours will spend, so /ops/sms can say before 10:00 that the balance will not do
(plan 2026-11-01-sms-v2, Task 3; 2026-11-01's run met an empty balance with no warning).

* **debt**: today's warnings still to go while today's runs are not over (the run at the hour and
  the catch-ups after it), and tomorrow's whole list once today's run hour has passed — the next run
  is then inside the 24 hours. A list the run itself would hold back (over the cap) counts 0. The
  1st's run is reckoned at least as big as this month's first one: lc-up charges the month on the
  1st, so the day before, the balances do not show the new debts yet.
* **campaigns**: every SCHEDULED campaign due within 24 hours (or overdue), resolved as it would be now.
* **automations**: 0 until the automatic SMS builder (plan Task 19).

Each SMS costs its parts × today's price per part.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

from . import campaigns, switchboard
from . import debt_warnings as warnings
from . import templates as T
from .models import SmsCampaign, SmsMessage

logger = logging.getLogger("sms.forecast")

HORIZON = timedelta(hours=24)
#: The debt run's ticks: at the hour, then retry or catch-up at hour+1 and hour+2 (sms.tasks).
CATCH_UP_HOURS = 2


def _cost(texts) -> int:
    return sum(T.parts(text) for text in texts) * switchboard.price_per_part()


def _warning_texts(now, day, *, skip=frozenset()) -> list[str]:
    planned = warnings.plan(now, today=day)
    if planned.blocked:
        return []
    return [w.text for w in planned.warnings if w.dedupe_key not in skip]


def _debt(now) -> int:
    if not warnings.switched_on():
        return 0
    local = timezone.localtime(now)
    today, hour = local.date(), switchboard.current().debt_hour
    texts = []
    if warnings.is_warning_day(today) and local.hour < hour + CATCH_UP_HOURS:
        done = set(
            SmsMessage.objects.filter(kind=SmsMessage.KIND_DEBT_WARNING, run_on=today)
            .exclude(status=SmsMessage.STATUS_FAILED)
            .values_list("dedupe_key", flat=True)
        )
        texts += _warning_texts(now, today, skip=done)
    tomorrow = today + timedelta(days=1)
    cost = _cost(texts)
    if local.hour >= hour and warnings.is_warning_day(tomorrow):
        tomorrows = _cost(_warning_texts(now, tomorrow))
        if tomorrow.day == 1:
            # lc-up charges the month on the 1st, so today's balances show only those already owing:
            # reckon the 1st's run at least as big as this month's first one (195 on 2026-11-01).
            tomorrows = max(tomorrows, _first_run_cost(today.replace(day=1)))
        cost += tomorrows
    return cost


def _first_run_cost(day) -> int:
    """What the debt warnings that went out on ``day`` cost (FAILED ones never left)."""
    rows = (
        SmsMessage.objects.filter(kind=SmsMessage.KIND_DEBT_WARNING, run_on=day)
        .exclude(status=SmsMessage.STATUS_FAILED)
        .values_list("parts", "text")
    )
    return sum(parts or T.parts(text) for parts, text in rows) * switchboard.price_per_part()


def _campaigns(now) -> int:
    texts = []
    for campaign in SmsCampaign.objects.filter(status=SmsCampaign.STATUS_SCHEDULED, scheduled_at__lte=now + HORIZON):
        try:
            recipients, _ = campaigns.resolve(campaign, now=now)
        except Exception as exc:  # one broken campaign must not take the whole overview down
            logger.warning("forecast: campaign %s could not be resolved: %s", campaign.pk, type(exc).__name__)
            continue
        texts += [r.text for r in recipients]
    return _cost(texts)


def need_next_24h(now) -> dict:
    """{debt, campaigns, automations, total}, in so'm."""
    need = {"debt": _debt(now), "campaigns": _campaigns(now), "automations": 0}
    need["total"] = sum(need.values())
    return need
