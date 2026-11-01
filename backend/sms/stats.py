"""What /ops/sms charts: delivery by day and by operator, the cost by month and kind, and whether
the debt warning gets people to pay (plan 2026-11-01-sms-v2, Task 2).

**Delivery rate** is delivered ÷ (delivered + undelivered + rejected): what reached its end. A SENT,
PENDING or UNCERTAIN SMS has not, so it is counted as pending and left out of the rate.

**Cost** is parts × the row's price per part (today's price for rows from before prices were kept),
for every SMS eskiz took or may have taken. FAILED (eskiz never reached) and REJECTED (eskiz refused
it at send) cost nothing: eskiz sends neither. It is an estimate — the panel says so.

Days and months are Tashkent's, from ``created_at``.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from django.db.models import Case, Count, IntegerField, Min, Q, Sum, Value, When
from django.db.models.functions import Coalesce, Substr, TruncDate, TruncMonth
from django.utils import timezone

from lcup.models import LcupPayment

from . import switchboard
from .models import SmsMessage
from .operators import NAMES, OPERATORS, OTHER

S = SmsMessage
#: eskiz took it: it left for the operator.
ACCEPTED_STATUSES = (S.STATUS_SENT, S.STATUS_DELIVERED, S.STATUS_UNDELIVERED)
#: It reached its end: the rate's denominator.
FINISHED = (S.STATUS_DELIVERED, S.STATUS_UNDELIVERED, S.STATUS_REJECTED)
UNFINISHED = (S.STATUS_SENT, S.STATUS_PENDING, S.STATUS_UNCERTAIN)
#: What eskiz charges for: everything that left, or may have.
CHARGED = (S.STATUS_PENDING, S.STATUS_SENT, S.STATUS_DELIVERED, S.STATUS_UNDELIVERED, S.STATUS_UNCERTAIN)
#: The cost chart's series, in order (``automation`` arrives with the builder).
KINDS = ("debt_warning", "campaign", "automation", "test")
DEFAULT_DAYS = 30
MAX_DAYS = 366
#: The debt effect's windows, in days from the first warning (that day counts as day 1).
PAID_WITHIN = (1, 3, 5)
_CODE_TO_NAME = {code: name for name, codes in OPERATORS.items() for code in codes}


def rate(delivered: int, finished: int) -> float | None:
    return delivered / finished if finished else None


def cost_expr():
    price = switchboard.price_per_part()
    return Case(
        When(status__in=CHARGED, then=Coalesce("parts", Value(1)) * Coalesce("unit_price", Value(price))),
        default=Value(0),
        output_field=IntegerField(),
    )


def parse_range(raw_from, raw_to, *, today: date) -> tuple[date, date]:
    """(from, to), inclusive. No ``to`` is today; no ``from`` is DEFAULT_DAYS ending at ``to``.
    Raises ValueError (the API's ``range``) for a date it cannot read, ``to`` before ``from``, or more
    than MAX_DAYS."""
    try:
        end = date.fromisoformat(raw_to) if raw_to else today
        start = date.fromisoformat(raw_from) if raw_from else end - timedelta(days=DEFAULT_DAYS - 1)
    except (TypeError, ValueError):
        raise ValueError("Dates are YYYY-MM-DD.") from None
    if end < start:
        raise ValueError("The range ends before it starts.")
    if (end - start).days + 1 > MAX_DAYS:
        raise ValueError(f"At most {MAX_DAYS} days at a time.")
    return start, end


def window(start: date, end: date) -> Q:
    """The rows created on Tashkent days ``start``..``end``."""
    lo = timezone.make_aware(datetime.combine(start, time.min))
    hi = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min))
    return Q(created_at__gte=lo, created_at__lt=hi)


def _counts() -> dict:
    return {
        "sent": Count("id", filter=Q(status__in=ACCEPTED_STATUSES)),
        "delivered": Count("id", filter=Q(status=S.STATUS_DELIVERED)),
        "undelivered": Count("id", filter=Q(status=S.STATUS_UNDELIVERED)),
        "rejected": Count("id", filter=Q(status=S.STATUS_REJECTED)),
        "failed": Count("id", filter=Q(status=S.STATUS_FAILED)),
        "pending": Count("id", filter=Q(status__in=UNFINISHED)),
        "cost": Sum(cost_expr()),
    }


def _with_rate(row: dict) -> dict:
    row["cost"] = row["cost"] or 0
    row["rate"] = rate(row["delivered"], row["delivered"] + row["undelivered"] + row["rejected"])
    return row


def summary(start: date, end: date, *, qs=None) -> dict:
    """Totals, ``by_day``, ``by_operator`` and ``cost_by_month`` for the rows created ``start``..``end``
    (of ``qs`` when given: a campaign's, an automation's)."""
    qs = (SmsMessage.objects.all() if qs is None else qs).filter(window(start, end)).order_by()
    tz = timezone.get_current_timezone()
    totals = _with_rate(qs.aggregate(**_counts()))
    by_day = [
        _with_rate({**row, "day": row["day"].isoformat()})
        for row in qs.annotate(day=TruncDate("created_at", tzinfo=tz)).values("day").annotate(**_counts()).order_by("day")
    ]
    return {
        "totals": totals,
        "by_day": by_day,
        "by_operator": _by_operator(qs),
        "cost_by_month": _cost_by_month(qs, tz),
    }


def _by_operator(qs) -> list[dict]:
    tally = defaultdict(lambda: {"total": 0, "delivered": 0, "finished": 0})
    rows = (
        qs.annotate(code=Substr("phone", 4, 2))
        .values("code")
        .annotate(
            total=Count("id"),
            delivered=Count("id", filter=Q(status=S.STATUS_DELIVERED)),
            finished=Count("id", filter=Q(status__in=FINISHED)),
        )
    )
    for row in rows:
        into = tally[_CODE_TO_NAME.get(row["code"], OTHER)]
        for key in ("total", "delivered", "finished"):
            into[key] += row[key]
    return [
        {"operator": name, "total": t["total"], "delivered": t["delivered"], "rate": rate(t["delivered"], t["finished"])}
        for name in (*NAMES, OTHER)
        if (t := tally.get(name)) and t["total"]
    ]


def _cost_by_month(qs, tz) -> list[dict]:
    months: dict[str, dict] = {}
    rows = (
        qs.annotate(month=TruncMonth("created_at", tzinfo=tz))
        .values("month", "kind")
        .annotate(cost=Sum(cost_expr()))
        .order_by("month")
    )
    for row in rows:
        key = row["month"].strftime("%Y-%m")
        into = months.setdefault(key, {"month": key, **{kind: 0 for kind in KINDS}, "total": 0})
        if row["kind"] in KINDS:
            into[row["kind"]] += row["cost"] or 0
        into["total"] += row["cost"] or 0
    return list(months.values())


def _month_start(day: date, back: int) -> date:
    month = day.year * 12 + day.month - 1 - back
    return date(month // 12, month % 12 + 1, 1)


def debt_effect(months: int = 3, *, today: date) -> list[dict]:
    """Per month (oldest first, only months with warnings, the last ``months`` up to ``today``): how
    many students the debt warning reached (eskiz took it), and how many of them paid within 1, 3 and
    5 days of their first warning that month. Refunds and extras are not payments. ``open`` counts
    those not paid yet whose 5 days are not over on ``today`` (the 2026-11-02 review): they are not
    in ``unpaid``, which is only those whose days ran out."""
    firsts = list(
        SmsMessage.objects.filter(
            kind=S.KIND_DEBT_WARNING, status__in=ACCEPTED_STATUSES, lcup_student_id__isnull=False,
            run_on__gte=_month_start(today, months - 1), run_on__lte=today,
        )
        .annotate(month=TruncMonth("run_on"))
        .values("lcup_student_id", "month")
        .annotate(first=Min("run_on"))
        .order_by()
    )
    if not firsts:
        return []
    longest = max(PAID_WITHIN)
    paid_on = defaultdict(list)
    for student, day in LcupPayment.objects.filter(
        kind="payment",
        lcup_student_id__in={f["lcup_student_id"] for f in firsts},
        paid_on__gte=min(f["first"] for f in firsts),
        paid_on__lte=max(f["first"] for f in firsts) + timedelta(days=longest - 1),
    ).values_list("lcup_student_id", "paid_on"):
        paid_on[student].append(day)
    out: dict[str, dict] = {}
    for f in firsts:
        key = f["month"].strftime("%Y-%m")
        row = out.setdefault(key, {"month": key, "warned": 0, **{f"paid_{d}": 0 for d in PAID_WITHIN}, "open": 0})
        row["warned"] += 1
        days = [p for p in paid_on.get(f["lcup_student_id"], ()) if p >= f["first"]]
        waited = (min(days) - f["first"]).days + 1 if days else None
        for d in PAID_WITHIN:
            if waited is not None and waited <= d:
                row[f"paid_{d}"] += 1
        if (waited is None or waited > longest) and f["first"] + timedelta(days=longest - 1) >= today:
            row["open"] += 1  # not paid yet, but their days are not over: not "did not pay"
    for row in out.values():
        row["unpaid"] = row["warned"] - row[f"paid_{longest}"] - row["open"]
    return [out[key] for key in sorted(out)]
