"""Money as the ledger keeps it, in the shapes lc-up's reads gave (``lcup.finance``), for once the ledger is the master
(``conf.ledger_is_ours``; owner, 2026-11-22: "Leave lc-up" on 1 Dec). The student's own page and the ticker under the
header, /ops/finance's Summary, Debtors and Payments, the Students list's Owes, the archive and the person's history
read these then; until then they keep reading lc-up's tables, which stay the master.

lc-up's shapes are kept key for key so no screen changes but its words: ``rule`` says whether the student pays per
lesson, and ``link_id`` is null for someone lc-up never knew (their freeze exemption cannot be set there).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from django.db.models import Max, OuterRef, Q, Subquery, Sum
from django.utils import timezone

from access import constants as C
from users import audience as A

from . import conf, ledger
from .models import Account, Entry, EntryKind, PastPayment, SeatState

MONEY_KINDS = (EntryKind.PAYMENT, EntryKind.REFUND)


def _live():
    return Entry.objects.filter(voided_at__isnull=True)


def balances() -> dict[int, int]:
    """account id → balance, for every account with a row."""
    return dict(_live().values_list("account_id").annotate(total=Sum("amount")))


def balances_by_user(user_ids) -> dict[int, int]:
    """user id → balance, for each of these users who has an account (0 when it has no rows yet)."""
    ids = [i for i in user_ids if i is not None]
    accounts = dict(Account.objects.filter(user_id__in=ids).values_list("user_id", "pk"))
    totals = dict(_live().filter(account_id__in=accounts.values()).values_list("account_id").annotate(t=Sum("amount")))
    return {user_id: totals.get(account_id, 0) for user_id, account_id in accounts.items()}


def _seat_name(seat) -> str:
    return seat.classroom.name if seat.classroom_id else seat.group_name


def _live_seats(account) -> list:
    seats = account.seats.select_related("classroom__teacher").order_by("id")
    return [seat for seat in seats if seat.state != SeatState.LEFT]


def _teacher(seat) -> str:
    teacher = seat.classroom.teacher if seat.classroom_id and seat.classroom.teacher_id else None
    return f"{teacher.first_name} {teacher.last_name}".strip() or teacher.username if teacher else ""


def _debt_frozen(user) -> bool:
    return bool(user and user.is_frozen and user.frozen_reason == A.FROZEN_LCUP_DEBT)


def _section(user) -> str:
    role = str(user.role or "").strip().lower()
    return "students" if role == C.ROLE_STUDENT else "public" if role == C.ROLE_PUBLIC_STUDENT else "staff"


def payment_row(entry) -> dict:
    """A payment or a refund, as ``lcup.finance._payment_row`` gave it: a refund's amount is below zero."""
    return {
        "id": entry.pk,
        "date": entry.day.isoformat(),
        "amount": entry.amount,
        "kind": entry.kind,
        "method": entry.method,
        "month": entry.month or ledger.month_of(entry.day),
        "group": _seat_name(entry.seat) if entry.seat_id else "",
    }


def past_row(past) -> dict:
    """A payment lc-up took before the ledger opened (``billing.history``), in ``payment_row``'s shape. Its id is
    lc-up's, as the page had it before the cutover."""
    return {
        "id": past.lcup_payment_id,
        "date": past.day.isoformat(),
        "amount": past.amount,
        "kind": past.kind,
        "method": past.method,
        "month": past.month or ledger.month_of(past.day),
        "group": past.group_name,
    }


def _past_of(user, account=None):
    """The person's payments from before the ledger opened: by their account, or by their user for a payer lc-up
    linked whose account came later."""
    match = Q(user=user) | Q(account__user=user)
    return PastPayment.objects.filter(match | Q(account=account) if account else match)


def _newest_first(rows: list[dict], limit: int) -> list[dict]:
    # Stable: on the opening day the ledger's own rows (listed first) stay above lc-up's.
    return sorted(rows, key=lambda row: row["date"], reverse=True)[:limit]


def student_finance(user) -> dict:
    """``lcup.finance.student_finance`` from the ledger. A seat paying per lesson says so (``rule``) and what one lesson
    costs, so the page says "each lesson" and not "by the 6th of each month"."""
    account = Account.objects.filter(user=user).first()
    if account is None:
        return {"linked": False}
    balance = ledger.balance(account)
    seats = _live_seats(account)
    payments = (
        account.entries.filter(voided_at__isnull=True, kind__in=MONEY_KINDS)
        .select_related("seat__classroom")
        .order_by("-day", "-id")[:100]
    )
    from lcup.conf import debt_freeze_day

    return {
        "linked": True,
        "balance": balance,
        "debt": max(0, -balance),
        "updated_at": timezone.now().isoformat(),  # the ledger is never behind
        "frozen_for_debt": _debt_frozen(user),
        # Between a lesson's charge and the next tick's freeze; an exempt student who owes keeps seeing it.
        "debt_notice": balance < 0 and not user.is_frozen,
        "freeze_day": debt_freeze_day(),
        "rule": conf.default_rule(),
        "lesson_price": ledger.lesson_price(seats[0]) if seats else None,
        "min_topup": conf.min_topup(),
        "monthly_cost": sum(seat.charge_price for seat in seats),
        "groups": [
            {"name": _seat_name(seat), "monthly_cost": seat.charge_price, "lesson_price": ledger.lesson_price(seat)}
            for seat in seats
        ],
        "payments": _newest_first(
            [payment_row(entry) for entry in payments] + [past_row(past) for past in _past_of(user, account)[:100]], 100
        ),
    }


def _links_by_user(user_ids) -> dict:
    from lcup.models import LcupStudentLink

    return {link.user_id: link for link in LcupStudentLink.objects.filter(user_id__in=[i for i in user_ids if i])}


def debtors(*, with_parents: bool = False) -> list[dict]:
    """``lcup.finance.debtors`` from the ledger: everyone whose balance is below zero, the biggest debt first."""
    totals = balances()
    owing = list(Account.objects.filter(pk__in=[pk for pk, total in totals.items() if total < 0]).select_related("user"))
    owing.sort(key=lambda account: (totals[account.pk], account.name))
    links = _links_by_user(account.user_id for account in owing)
    seats = defaultdict(list)
    for account in owing:
        seats[account.pk] = _live_seats(account)
    last_paid = dict(
        PastPayment.objects.filter(kind=EntryKind.PAYMENT, account__in=owing)
        .values_list("account_id").annotate(last=Max("day"))
    )
    last_paid.update(
        _live().filter(kind=EntryKind.PAYMENT, account__in=owing).values_list("account_id").annotate(last=Max("day"))
    )
    rows = []
    for account in owing:
        user, link, mine = account.user, links.get(account.user_id), seats[account.pk]
        rows.append({
            "link_id": link.pk if link else None,
            "lcup_student_id": account.lcup_student_id,
            "name": account.name,
            "user": {
                "id": user.pk, "name": f"{user.first_name} {user.last_name}".strip(), "username": user.username,
                "section": _section(user),
            } if user else None,
            "phone": account.phone or (user.phone_number if user else "") or "",
            "parent_phone": (user.parent_phone or "") if (with_parents and user) else "",
            "groups": [_seat_name(seat) for seat in mine],
            "group_rows": [
                {
                    "name": _seat_name(seat),
                    "level": (seat.classroom.level or "") if seat.classroom_id else "",
                    "classroom_id": seat.classroom_id,
                }
                for seat in mine
            ],
            "teachers": sorted({name for name in (_teacher(seat) for seat in mine) if name}),
            "in_group": bool(mine),
            "debt": -totals[account.pk],
            "last_payment_on": last_paid[account.pk].isoformat() if account.pk in last_paid else None,
            "frozen": _debt_frozen(user),
            "exempt": bool(link and link.debt_freeze_exempt_at),
        })
    return rows


def _month_range(month: str) -> tuple[date, date]:
    year, number = int(month[:4]), int(month[5:7])
    first = date(year, number, 1)
    return first, date(year + (number == 12), number % 12 + 1, 1) - timedelta(days=1)


def payments_in(month: str) -> list[dict]:
    first, last = _month_range(month)
    entries = (
        _live().filter(kind__in=MONEY_KINDS, day__range=(first, last))
        .select_related("account", "seat__classroom")
        .order_by("day", "id")
    )
    rows = []
    for entry in entries:
        row = payment_row(entry)
        row["student"] = entry.account.name
        row["user_id"] = entry.account.user_id
        rows.append(row)
    past = PastPayment.objects.filter(day__range=(first, last)).select_related("account").order_by("day", "lcup_payment_id")
    for payment in past:
        row = past_row(payment)
        row["student"] = payment.name or (payment.account.name if payment.account_id else "")
        row["user_id"] = payment.user_id or (payment.account.user_id if payment.account_id else None)
        rows.append(row)
    rows.sort(key=lambda row: row["date"])  # stable: within a day lc-up's past ones follow the ledger's
    return rows


def summary(month: str) -> dict:
    """``lcup.finance.summary`` from the ledger: the month's money in, everyone's debt, and each live class."""
    from classes.models import Classroom
    from lcup.conf import debt_freeze_day
    from lcup.models import LcupStudentLink

    first, last = _month_range(month)
    in_month = _live().filter(day__range=(first, last))
    by_kind = dict(in_month.values_list("kind").annotate(t=Sum("amount")))
    by_method = {
        method or "—": total
        for method, total in in_month.filter(kind=EntryKind.PAYMENT).values_list("method").annotate(t=Sum("amount"))
    }
    totals = balances()
    owing = {pk: total for pk, total in totals.items() if total < 0}
    # lc-up's payments from before the ledger opened belong to their month as much as the ledger's own.
    past = PastPayment.objects.filter(day__range=(first, last))
    for kind, total in past.values_list("kind").annotate(t=Sum("amount")):
        by_kind[kind] = by_kind.get(kind, 0) + total
    for method, total in past.filter(kind=EntryKind.PAYMENT).values_list("method").annotate(t=Sum("amount")):
        by_method[method or "—"] = by_method.get(method or "—", 0) + total
    income: dict[int, int] = defaultdict(int)
    for classroom_id, total in (
        in_month.filter(kind__in=MONEY_KINDS, seat__classroom__isnull=False)
        .values_list("seat__classroom_id").annotate(t=Sum("amount"))
    ):
        income[classroom_id] += total
    for classroom_id, total in past.filter(classroom__isnull=False).values_list("classroom_id").annotate(t=Sum("amount")):
        income[classroom_id] += total
    by_group = []
    # Each live class, and any class money came in for that month — one since closed still shows a past month's income.
    rooms = Classroom.objects.filter(
        Q(is_active=True, billing_seats__isnull=False) | Q(pk__in=[pk for pk, total in income.items() if total])
    ).distinct().select_related("teacher")
    for room in rooms.order_by("name"):
        seats = [seat for seat in room.billing_seats.all() if seat.state != SeatState.LEFT]
        in_debt = [seat for seat in seats if owing.get(seat.account_id, 0) < 0]
        teacher = room.teacher
        by_group.append({
            "group": room.name,
            "teachers": [f"{teacher.first_name} {teacher.last_name}".strip() or teacher.username] if teacher else [],
            "monthly_cost": room.monthly_price or 0,
            "students": len(seats),
            "debtors": len(in_debt),
            "debt": -sum(owing[seat.account_id] for seat in in_debt),
            "income": income.get(room.pk, 0),
        })
    accounts_with_users = Account.objects.filter(user__isnull=False)
    lesson = conf.lesson_billing()
    return {
        "month": month,
        "total_debt": -sum(owing.values()),
        "debtors": len(owing),
        "frozen": accounts_with_users.filter(user__is_frozen=True, user__frozen_reason=A.FROZEN_LCUP_DEBT).count(),
        "exempt": LcupStudentLink.objects.filter(
            debt_freeze_exempt_at__isnull=False, user__billing_account__isnull=False
        ).count(),
        "paid": by_kind.get(EntryKind.PAYMENT, 0),
        "refunded": by_kind.get(EntryKind.REFUND, 0),
        "other": by_kind.get(EntryKind.ADJUST, 0),
        "by_method": by_method,
        "by_group": by_group,
        # Paying per lesson, the freeze comes the moment the balance drops below zero, any day of the month.
        "freeze": {"enabled": lesson, "day": 1 if lesson else debt_freeze_day(), "rule": conf.default_rule()},
    }


def person_payments(user, limit: int) -> list:
    """The person's payments and refunds, newest first, for their History (``users.people_parts.history_part``): the
    ledger's ``Entry`` rows and lc-up's from before it opened (``PastPayment``, which has no ``created_by``)."""
    ours = list(
        _live().filter(account__user=user, kind__in=MONEY_KINDS).select_related("created_by").order_by("-day", "-id")[:limit]
    )
    return sorted(ours + list(_past_of(user)[:limit]), key=lambda row: row.day, reverse=True)[:limit]


def owing_user_ids():
    """The users whose ledger balance is below zero, as a subquery for a list's "owes" filter."""
    return (
        Account.objects.filter(user__isnull=False)
        .annotate(total=Sum("entries__amount", filter=Q(entries__voided_at__isnull=True)))
        .filter(total__lt=0)
        .values("user_id")
    )


def user_balance(outer: str = "pk"):
    """A user's ledger balance as a subquery expression on ``outer`` (a user's pk), for sorting a list by debt."""
    return Subquery(
        _live().filter(account__user_id=OuterRef(outer)).values("account__user_id").annotate(t=Sum("amount")).values("t")[:1]
    )
