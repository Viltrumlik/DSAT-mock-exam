"""Money, as lc-up keeps it: balances, payments, and the freeze for an unpaid month (lc-up Part 3).

The owner (2026-10-14): balances and payments are seen by admins (everyone's) and by the student
(their own) — never by teachers, who see only that a student is frozen. "Har oyning 6-sanasigacha
qarz to'lanmasa muzlatilsin 6-kuni", starting the day it is switched on.

* **Payments** — ``sync_payments`` copies lc-up's payment ledger into ``LcupPayment``: the whole
  history on the first run, then the last ``PAYMENT_LOOKBACK_DAYS`` every run, so a payment lc-up
  corrects or deletes later is corrected or deleted here too.
* **The freeze** — from the ``debt_freeze_day()`` of each month, a linked learner whose lc-up
  balance is below zero is frozen (``users.audience.freeze_for_debt``); any day, a balance back at
  zero or above lifts it. An admin can exempt a student (``set_exempt``). An unknown balance is
  never debt, an administrator's own freeze is never touched, a run that hit errors freezes nobody,
  and more than ``MAX_FREEZES_PER_RUN`` at once wait for a person. With the switch off, every
  learning-center student this freeze froze is let go (a leaver's freeze is the audience stage's).
* **Reads** — ``student_finance`` for the student's own page; ``summary``, ``debtors`` and
  ``payments_in`` for /ops/finance.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from django.db.models import Max, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from access import constants as C
from users import audience as A

from .conf import debt_freeze_day, debt_freeze_enabled
from .models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupPayment, LcupState, LcupStudentLink

#: Each run re-reads this many days, so lc-up's later corrections and deletions arrive.
PAYMENT_LOOKBACK_DAYS = 7
#: lc-up takes at most 92 days per payments request.
PAYMENT_WINDOW_DAYS = 90
#: More new freezes than this in one run wait for a person (lc-up answering with wrong balances).
MAX_FREEZES_PER_RUN = 60
#: The ledger reason of a freeze for an unpaid month (``users.RoleChange.reason``).
REASON_DEBT_UNPAID = "lcup_debt_unpaid"

API = "/api/external/v1"
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _aware(value):
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return None
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


# ── payments ──────────────────────────────────────────────────────────────


def _first_course_day(today: date) -> date:
    days = []
    for snapshot in LcupGroupLink.objects.values_list("snapshot", flat=True):
        raw = str((snapshot or {}).get("course_start_date") or "")[:10]
        try:
            days.append(date.fromisoformat(raw))
        except ValueError:
            continue
    return min(days) if days else today - timedelta(days=PAYMENT_WINDOW_DAYS - 1)


def sync_payments(client, run) -> None:
    today = timezone.localdate(run.now)
    state = LcupState.get()
    first = today - timedelta(days=PAYMENT_LOOKBACK_DAYS)
    if state.payments_backfilled_at is None:
        first = min(first, _first_course_day(today))
    rows, lo = [], first
    while lo <= today:
        hi = min(lo + timedelta(days=PAYMENT_WINDOW_DAYS - 1), today)
        rows += client.fetch_all(f"{API}/payments", {"from": lo.isoformat(), "to": hi.isoformat()})
        lo = hi + timedelta(days=1)

    students = dict(LcupStudentLink.objects.values_list("lcup_student_id", "pk"))
    groups = dict(LcupGroupLink.objects.values_list("lcup_group_id", "pk"))
    seen = []
    for row in rows:
        paid_on = parse_date(str(row.get("date") or "")[:10])
        amount, student_id = _int(row.get("amount")), _int(row.get("student_id"))
        if row.get("id") is None or paid_on is None or amount is None or student_id is None:
            run.counts["payments_skipped"] += 1
            continue
        group_id = _int(row.get("group_id"))
        method = row.get("method") or {}
        LcupPayment.objects.update_or_create(
            lcup_payment_id=row["id"],
            defaults={
                "student_id": students.get(student_id),
                "lcup_student_id": student_id,
                "group_id": groups.get(group_id),
                "lcup_group_id": group_id,
                "kind": str(row.get("type") or "payment")[:16],
                "amount": amount,
                "method": str((method.get("name") if isinstance(method, dict) else method) or "")[:60],
                "paid_on": paid_on,
                "month": str(row.get("month") or "")[:7],
                "note": str(row.get("note") or "")[:300],
                "created_in_lcup": _aware(row.get("created_at")),
                "synced_at": run.now,
            },
        )
        seen.append(row["id"])
    # The read covered every day from ``first`` to today (fetch_all raises on a partial list): a
    # payment held for those days that lc-up no longer lists was deleted there.
    removed, _ = LcupPayment.objects.filter(paid_on__range=(first, today)).exclude(lcup_payment_id__in=seen).delete()
    run.counts["payments"] = len(seen)
    if removed:
        run.counts["payments_removed"] = removed
    if state.payments_backfilled_at is None:
        state.payments_backfilled_at = run.now
        state.save(update_fields=["payments_backfilled_at"])


# ── the freeze ────────────────────────────────────────────────────────────


@dataclass
class FreezePlan:
    to_freeze: list = field(default_factory=list)
    to_unfreeze: list = field(default_factory=list)


def _debt_frozen(user) -> bool:
    return bool(user.is_frozen and user.frozen_reason == A.FROZEN_LCUP_DEBT)


def owes(link) -> bool:
    return link.balance is not None and link.balance < 0


def freezable(link) -> bool:
    """Whether the freeze takes this linked learner on a freezing day: they owe, they are not frozen
    (for any reason), no admin exempted them, and lc-up still lists them. ``sms.debt_warnings`` warns
    exactly these people on the days before."""
    return (
        not link.user.is_frozen
        and link.debt_freeze_exempt_at is None
        and not link.deleted_in_lcup
        and owes(link)
    )


def freeze_plan(now, *, enabled: bool | None = None) -> FreezePlan:
    plan = FreezePlan()
    links = LcupStudentLink.objects.filter(user__isnull=False, user__role__in=C.LEARNER_ROLES).select_related("user")
    if not (debt_freeze_enabled() if enabled is None else enabled):
        # Switched off: let go every centre student this freeze holds. A leaver frozen for debt by
        # the audience stage is a public learner, and stays as that stage left them.
        plan.to_unfreeze = [l for l in links if _debt_frozen(l.user) and l.user.role == C.ROLE_STUDENT]
        return plan
    freezing_days = timezone.localdate(now).day >= debt_freeze_day()
    for link in links:
        user, exempt = link.user, link.debt_freeze_exempt_at is not None
        if _debt_frozen(user):
            if exempt or (link.balance is not None and link.balance >= 0):
                plan.to_unfreeze.append(link)
        elif freezing_days and freezable(link):
            plan.to_freeze.append(link)
    return plan


def apply_freeze(run) -> None:
    plan = freeze_plan(run.now)
    for link in plan.to_unfreeze:
        if A.clear_debt_freeze(link.user, source=A.SOURCE_SYNC):
            run.counts["debt_unfrozen"] += 1
    if not plan.to_freeze:
        return
    if run.errors:
        run.alerts.append("debt freezes held: this sync had errors")
        run.counts["debt_freezes_held"] += len(plan.to_freeze)
        return
    if len(plan.to_freeze) > MAX_FREEZES_PER_RUN:
        run.alerts.append(f"debt freezes held: {len(plan.to_freeze)} > {MAX_FREEZES_PER_RUN} in one run")
        run.counts["debt_freezes_held"] += len(plan.to_freeze)
        return
    for link in plan.to_freeze:
        if A.freeze_for_debt(link.user, reason=REASON_DEBT_UNPAID, source=A.SOURCE_SYNC):
            run.counts["debt_frozen"] += 1


def set_exempt(link, exempt: bool, *, by, now) -> None:
    """An admin's say: never freeze this student for debt (and let them go now), or freeze as usual."""
    link.debt_freeze_exempt_at = now if exempt else None
    link.debt_freeze_exempt_by = by if exempt else None
    link.save(update_fields=["debt_freeze_exempt_at", "debt_freeze_exempt_by"])
    if exempt and link.user_id and _debt_frozen(link.user):
        A.clear_debt_freeze(link.user, source="admin")


# ── reads ─────────────────────────────────────────────────────────────────


def _money(value) -> int | None:
    return None if value is None else int(value)


def _live_groups(links) -> dict[int, list[LcupGroupLink]]:
    """lc-up student pk → the live lc-up groups they are a member of."""
    out: dict[int, list[LcupGroupLink]] = defaultdict(list)
    rows = LcupMembership.objects.filter(
        student__in=links, left_at__isnull=True, group__deleted_in_lcup_at__isnull=True
    ).select_related("group__classroom")
    for m in rows:
        out[m.student_id].append(m.group)
    return out


def _group_name(group) -> str:
    return group.classroom.name if group.classroom_id else group.name


def _group_cost(group) -> int:
    return _int((group.snapshot or {}).get("cost")) or 0


def _teacher_names(group) -> list[str]:
    names = [str(t.get("name") or "").strip() for t in (group.snapshot or {}).get("teachers") or [] if isinstance(t, dict)]
    return [n for n in names if n]


def _payment_row(p) -> dict:
    return {
        "id": p.lcup_payment_id,
        "date": p.paid_on.isoformat(),
        "amount": p.amount,
        "kind": p.kind,
        "method": p.method,
        "month": p.month,
        "group": _group_name(p.group) if p.group_id else "",
    }


def student_finance(user) -> dict:
    """A student's own money, for their Payments panel and the frozen screen."""
    link = LcupStudentLink.objects.filter(user=user).first()
    if link is None:
        return {"linked": False}
    groups = _live_groups([link]).get(link.pk, [])
    payments = LcupPayment.objects.filter(lcup_student_id=link.lcup_student_id).select_related("group__classroom")[:100]
    balance = _money(link.balance)
    return {
        "linked": True,
        "balance": balance,
        "debt": max(0, -balance) if balance is not None else None,
        "updated_at": link.balance_seen_at.isoformat() if link.balance_seen_at else None,
        "frozen_for_debt": _debt_frozen(user),
        "freeze_day": debt_freeze_day(),
        "monthly_cost": sum(_group_cost(g) for g in groups),
        "groups": [{"name": _group_name(g), "monthly_cost": _group_cost(g)} for g in groups],
        "payments": [_payment_row(p) for p in payments],
    }


def parse_month(raw, *, now) -> str:
    raw = str(raw or "").strip()
    return raw if _MONTH.match(raw) else timezone.localdate(now).strftime("%Y-%m")


def _month_range(month: str) -> tuple[date, date]:
    year, mon = int(month[:4]), int(month[5:7])
    first = date(year, mon, 1)
    nxt = date(year + (mon == 12), mon % 12 + 1, 1)
    return first, nxt - timedelta(days=1)


def debtors() -> list[dict]:
    links = list(
        LcupStudentLink.objects.filter(deleted_in_lcup=False, balance__lt=0).select_related("user").order_by("balance")
    )
    groups = _live_groups(links)
    last_paid = dict(
        LcupPayment.objects.filter(kind="payment", lcup_student_id__in=[l.lcup_student_id for l in links])
        .values_list("lcup_student_id")
        .annotate(last=Max("paid_on"))
    )
    rows = []
    for link in links:
        mine = groups.get(link.pk, [])
        user = link.user
        rows.append({
            "link_id": link.pk,
            "lcup_student_id": link.lcup_student_id,
            "name": link.name,
            "user": {"id": user.pk, "name": f"{user.first_name} {user.last_name}".strip(), "username": user.username} if user else None,
            "groups": [_group_name(g) for g in mine],
            "teachers": sorted({n for g in mine for n in _teacher_names(g)}),
            "in_group": bool(mine),
            "debt": -_money(link.balance),
            "last_payment_on": last_paid[link.lcup_student_id].isoformat() if link.lcup_student_id in last_paid else None,
            "frozen": bool(user and _debt_frozen(user)),
            "exempt": link.debt_freeze_exempt_at is not None,
        })
    return rows


def payments_in(month: str) -> list[dict]:
    first, last = _month_range(month)
    rows = []
    qs = LcupPayment.objects.filter(paid_on__range=(first, last)).select_related("student", "group__classroom")
    for p in qs:
        row = _payment_row(p)
        row["student"] = p.student.name if p.student_id else ""
        row["user_id"] = p.student.user_id if p.student_id else None
        rows.append(row)
    return rows


def summary(month: str) -> dict:
    first, last = _month_range(month)
    in_month = LcupPayment.objects.filter(paid_on__range=(first, last))
    by_kind = dict(in_month.values_list("kind").annotate(t=Sum("amount")))
    by_method = {m or "—": v for m, v in in_month.filter(kind="payment").values_list("method").annotate(t=Sum("amount"))}
    live = LcupStudentLink.objects.filter(deleted_in_lcup=False)
    owing = live.filter(balance__lt=0)

    income: dict[int, int] = defaultdict(int)
    for gid, kind, total in in_month.filter(group__isnull=False).values_list("group_id", "kind").annotate(t=Sum("amount")):
        income[gid] += total if kind == "payment" else -total if kind == "refund" else 0
    by_group = []
    groups = LcupGroupLink.objects.filter(status=GroupLinkStatus.CONFIRMED, deleted_in_lcup_at__isnull=True)
    for g in groups.select_related("classroom").order_by("name"):
        members = LcupStudentLink.objects.filter(memberships__group=g, memberships__left_at__isnull=True)
        member_debt = members.filter(balance__lt=0)
        by_group.append({
            "group": _group_name(g),
            "teachers": _teacher_names(g),
            "monthly_cost": _group_cost(g),
            "students": members.count(),
            "debtors": member_debt.count(),
            "debt": -int(member_debt.aggregate(t=Sum("balance"))["t"] or 0),
            "income": income.get(g.pk, 0),
        })
    return {
        "month": month,
        "total_debt": -int(owing.aggregate(t=Sum("balance"))["t"] or 0),
        "debtors": owing.count(),
        "frozen": live.filter(user__is_frozen=True, user__frozen_reason=A.FROZEN_LCUP_DEBT).count(),
        "exempt": live.filter(debt_freeze_exempt_at__isnull=False).count(),
        "paid": by_kind.get("payment", 0),
        "refunded": by_kind.get("refund", 0),
        "other": sum(v for k, v in by_kind.items() if k not in ("payment", "refund")),
        "by_method": by_method,
        "by_group": by_group,
        "freeze": {"enabled": debt_freeze_enabled(), "day": debt_freeze_day()},
    }


def freeze_report(now) -> dict:
    """What switching the freeze on would do right now — the owner sees this first."""
    plan = freeze_plan(now, enabled=True)
    groups = _live_groups([l for l in plan.to_freeze + plan.to_unfreeze])

    def row(link):
        u = link.user
        return {
            "name": f"{u.first_name} {u.last_name}".strip() or link.name,
            "username": u.username,
            "debt": -_money(link.balance) if owes(link) else 0,
            "groups": [_group_name(g) for g in groups.get(link.pk, [])],
        }

    return {
        "today": timezone.localdate(now).isoformat(),
        "freeze_day": debt_freeze_day(),
        "enabled": debt_freeze_enabled(),
        "would_freeze": sorted((row(l) for l in plan.to_freeze), key=lambda r: -r["debt"]),
        "would_unfreeze": [row(l) for l in plan.to_unfreeze],
    }
