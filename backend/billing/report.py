"""Reports for a period (lc-up's "Hisobotlar"; owner 2026-11-22: reports leave lc-up too, design "Yes, approved").

Today, a week, a month or any stretch up to a year: what came in (payments by method, and refunds), what went out
(expenses by category), the net, what the lessons earned (charges written, less lessons given back), how many
students were in a paid seat each day (lc-up's "Aktiv talabalar hisoboti"), who started, left or froze, and the debt
as it stood at the end of the period.

Read-only. Money in is the ledger's own rows plus lc-up's payments from before the ledger opened
(``billing.PastPayment``); nothing here moves a balance.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Min, Q, Sum

from users import audience as A

from .models import EndReason, Entry, EntryKind, Expense, PastPayment, Span

#: The longest stretch one report covers.
MAX_DAYS = 366
_EARNED = (("lesson:", "lessons"), ("first:", "first_months"), ("charge:", "monthly"))


def _money_in(start: date, end: date) -> dict:
    ledger = Entry.objects.filter(voided_at__isnull=True, day__range=(start, end), kind__in=(EntryKind.PAYMENT, EntryKind.REFUND))
    past = PastPayment.objects.filter(day__range=(start, end))
    by_method, refunded, count = Counter(), 0, 0
    for rows in (ledger, past):
        for kind, method, total, n in rows.values_list("kind", "method").annotate(total=Sum("amount"), n=Count("id")):
            if kind == EntryKind.PAYMENT:
                by_method[method or "—"] += total
                count += n
            else:
                refunded += total  # below zero
    return {
        "paid": sum(by_method.values()),
        "refunded": refunded,
        "payments": count,
        "by_method": [{"method": m, "total": t} for m, t in sorted(by_method.items(), key=lambda kv: -kv[1])],
    }


def _money_out(start: date, end: date) -> dict:
    rows = Expense.objects.filter(voided_at__isnull=True, day__range=(start, end))
    by_category = [
        {"name": name, "total": total, "count": n}
        for name, total, n in rows.values_list("category__name").annotate(total=Sum("amount"), n=Count("id")).order_by("-total")
    ]
    return {"total": sum(c["total"] for c in by_category), "count": sum(c["count"] for c in by_category), "by_category": by_category}


def _earned(start: date, end: date) -> dict:
    """What the seats were charged in the period, as positive so'm: each lesson, each first month, each month's fee
    (the monthly rule), less the lessons given back. Adjustments are apart: they are corrections, not earnings."""
    rows = Entry.objects.filter(voided_at__isnull=True, day__range=(start, end))
    out = {"lessons": 0, "first_months": 0, "monthly": 0, "other": 0}
    for key, amount in rows.filter(kind=EntryKind.CHARGE).values_list("key", "amount").iterator():
        name = next((label for prefix, label in _EARNED if key.startswith(prefix)), "other")
        out[name] -= amount
    given_back = rows.filter(kind=EntryKind.CREDIT).aggregate(t=Sum("amount"))["t"] or 0
    out["given_back"] = given_back
    out["total"] = out["lessons"] + out["first_months"] + out["monthly"] + out["other"] - given_back
    out["adjustments"] = rows.filter(kind=EntryKind.ADJUST).aggregate(t=Sum("amount"))["t"] or 0
    return out


def _students(start: date, end: date, today: date) -> dict:
    """Paid seats: a span is a stretch a seat paid for, so a student is "active" on a day one of their spans covers
    it (a trial pays nothing and is not counted; a frozen seat has no span for those days). Days after today are not
    counted yet."""
    spans = list(
        Span.objects.filter(start__lte=end).filter(Q(end__isnull=True) | Q(end__gte=start - timedelta(days=1)))
        .values_list("seat__account_id", "start", "end", "ended_by")
    )
    by_account = defaultdict(list)
    for account_id, first, last, _ in spans:
        by_account[account_id].append((first, last))

    def covers(account_id, day):
        return any(first <= day and (last is None or last >= day) for first, last in by_account[account_id])

    per_day, day = [], start
    while day <= min(end, today):
        per_day.append({"day": day.isoformat(), "count": sum(1 for account_id in by_account if covers(account_id, day))})
        day += timedelta(days=1)

    started = Span.objects.values("seat__account_id").annotate(first=Min("start")).filter(first__range=(start, end)).count()
    left, froze = set(), set()
    for account_id, _, last, ended_by in spans:
        if last is None or not (start <= last <= end):
            continue
        if ended_by == EndReason.LEAVE and not covers(account_id, last + timedelta(days=1)):
            left.add(account_id)  # gone, not moved to another group the next day
        elif ended_by == EndReason.FREEZE:
            froze.add(account_id)
    return {
        "active_per_day": per_day,
        "active_at_end": per_day[-1]["count"] if per_day else 0,
        "new": started,
        "left": len(left),
        "froze": len(froze),
        "frozen_for_debt_now": get_user_model().objects.filter(is_frozen=True, frozen_reason=A.FROZEN_LCUP_DEBT).count(),
    }


def _debt(as_of: date) -> dict:
    """Everyone's balance as the period ended: the rows dated on or before that day."""
    totals = Entry.objects.filter(voided_at__isnull=True, day__lte=as_of).values("account_id").annotate(t=Sum("amount"))
    owing = [row["t"] for row in totals if row["t"] < 0]
    return {"as_of": as_of.isoformat(), "debtors": len(owing), "total": -sum(owing)}


def period_report(start: date, end: date, *, today: date) -> dict:
    money_in, money_out = _money_in(start, end), _money_out(start, end)
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "money_in": money_in,
        "money_out": money_out,
        # What stayed with the centre: payments, less refunds (already below zero), less expenses.
        "net": money_in["paid"] + money_in["refunded"] - money_out["total"],
        "earned": _earned(start, end),
        "students": _students(start, end, today),
        "debt": _debt(min(end, today)),
    }
