"""The centre's expenses (lc-up's "Xarajatlar"), kept here once the centre leaves lc-up (owner, 2026-11-22: "No, move
them too"; design approved the same day: "Yes, approved").

A row is a day, an amount, a category (a list kept on the same tab), a method (cash, card, bank, as for payments),
who spent it and what for. Never edited and never deleted: a wrong row is voided with a reason and stays in the
archive. Expenses never touch a student's balance; they are the money-out side of the reports.

Entering and voiding wait for the cutover, as entering payments does, so nothing is kept twice while lc-up still
keeps the expenses. The category list may be prepared before.
"""

from __future__ import annotations

import uuid
from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Sum
from django.utils import timezone

from access import constants as C

from .ledger import MAX_AMOUNT
from .models import Expense, ExpenseCategory, PaymentMethod

User = get_user_model()
#: Rows one answer lists; the totals always cover everything the filter matches.
MAX_ROWS = 1000


class ExpenseRefused(ValueError):
    """Why this expense cannot be written, in words for the person entering it."""


def _name(user) -> str:
    if user is None:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.username or ""


def staff():
    """Who may have spent the centre's money: every active staff account (never a learner)."""
    return User.objects.filter(is_active=True).exclude(role__in=C.LEARNER_ROLES).order_by("first_name", "last_name", "username")


def staff_choices() -> list[dict]:
    return [{"id": user.pk, "name": _name(user)} for user in staff()]


def add_expense(*, day, amount, category_id, method, spent_by_id, reason, request_id, by, today) -> tuple[Expense, bool]:
    """One expense; ``(row, created)``. The same form sent twice is the same row."""
    try:
        request_id = uuid.UUID(str(request_id))
    except ValueError:
        raise ExpenseRefused("This form is out of date. Reload the page.") from None
    existing = Expense.objects.filter(request_id=request_id).first()
    if existing:
        return existing, False
    if not isinstance(day, date):
        raise ExpenseRefused("That is not a date.")
    if day > today:
        raise ExpenseRefused("That day is in the future.")
    if type(amount) is not int or amount <= 0:
        raise ExpenseRefused("The amount must be a whole number of so'm above zero.")
    if amount > MAX_AMOUNT:
        raise ExpenseRefused(f"That amount is too large: the most is {MAX_AMOUNT:,} so'm at a time.")
    category = ExpenseCategory.objects.filter(pk=category_id).first() if str(category_id or "").isdigit() else None
    if category is None:
        raise ExpenseRefused("Choose a category.")
    if category.retired_at:
        raise ExpenseRefused(f"{category.name} is no longer used. Choose another category.")
    if method not in PaymentMethod.values:
        raise ExpenseRefused("Choose how it was paid.")
    spender = staff().filter(pk=spent_by_id).first() if str(spent_by_id or "").isdigit() else None
    if spender is None:
        raise ExpenseRefused("Choose who spent it.")
    reason = " ".join(str(reason or "").split())[:300]
    if not reason:
        raise ExpenseRefused("Say what it was for.")
    try:
        with transaction.atomic():
            row = Expense.objects.create(
                day=day, amount=amount, category=category, method=method, spent_by=spender,
                spent_by_name=_name(spender)[:200], reason=reason, request_id=request_id, created_by=by,
            )
    except IntegrityError:  # the same form, a moment earlier, from another tab
        return Expense.objects.get(request_id=request_id), False
    return row, True


def void_expense(expense: Expense, reason: str, *, by) -> Expense:
    reason = " ".join(str(reason or "").split())[:300]
    if not reason:
        raise ExpenseRefused("Say why this expense is being voided.")
    with transaction.atomic():
        row = Expense.objects.select_for_update().get(pk=expense.pk)
        if row.voided_at:
            raise ExpenseRefused("This expense was already voided.")
        row.voided_at, row.voided_by, row.void_reason = timezone.now(), by, reason
        row.save(update_fields=["voided_at", "voided_by", "void_reason"])
    return row


def matching(*, start: date, end: date, category_id=None, spent_by_id=None, archived: bool = False):
    """The rows a filter picks: live ones, or the voided ones of the archive, by the day they were spent."""
    rows = Expense.objects.filter(day__range=(start, end), voided_at__isnull=not archived)
    if category_id:
        rows = rows.filter(category_id=category_id)
    if spent_by_id:
        rows = rows.filter(spent_by_id=spent_by_id)
    return rows


def row(expense: Expense) -> dict:
    return {
        "id": expense.pk,
        "day": expense.day.isoformat(),
        "amount": expense.amount,
        "category": {"id": expense.category_id, "name": expense.category.name},
        "method": expense.method,
        "spent_by": {"id": expense.spent_by_id, "name": expense.spent_by_name or _name(expense.spent_by)},
        "reason": expense.reason,
        "created_by": _name(expense.created_by),
        "created_at": expense.created_at.isoformat(),
        "voided_at": expense.voided_at.isoformat() if expense.voided_at else None,
        "voided_by": _name(expense.voided_by),
        "void_reason": expense.void_reason,
    }


def listing(rows) -> dict:
    """The rows, newest first, and what they add up to: the total and each category's share."""
    total = rows.aggregate(total=Sum("amount"))["total"] or 0
    by_category = [
        {"id": pk, "name": name, "total": amount, "count": count}
        for pk, name, amount, count in rows.values_list("category_id", "category__name")
        .annotate(total=Sum("amount"), count=Count("id")).order_by("-total", "category__name")
    ]
    picked = list(rows.select_related("category", "spent_by", "created_by", "voided_by").order_by("-day", "-id")[: MAX_ROWS + 1])
    return {
        "rows": [row(expense) for expense in picked[:MAX_ROWS]],
        "count": rows.count(),
        "truncated": len(picked) > MAX_ROWS,
        "total": total,
        "by_category": by_category,
    }


# ── categories ────────────────────────────────────────────────────────────────────────────────────────────────


def _clean_name(name) -> str:
    name = " ".join(str(name or "").split())
    if not name:
        raise ExpenseRefused("Give the category a name.")
    if len(name) > 80:
        raise ExpenseRefused("Keep the name under 80 characters.")
    return name


def _taken(name: str, *, other_than=None) -> bool:
    taken = ExpenseCategory.objects.filter(name__iexact=name)
    return taken.exclude(pk=other_than).exists() if other_than else taken.exists()


def add_category(name, *, by) -> ExpenseCategory:
    name = _clean_name(name)
    if _taken(name):
        raise ExpenseRefused(f"There is already a category called {name}.")
    return ExpenseCategory.objects.create(name=name, created_by=by)


def change_category(category: ExpenseCategory, *, name=None, retired=None) -> ExpenseCategory:
    """A new name (every row under it reads the new one), or retired / back in use. Never deleted."""
    fields = []
    if name is not None:
        name = _clean_name(name)
        if _taken(name, other_than=category.pk):
            raise ExpenseRefused(f"There is already a category called {name}.")
        category.name = name
        fields.append("name")
    if retired is not None:
        category.retired_at = (category.retired_at or timezone.now()) if retired else None
        fields.append("retired_at")
    if fields:
        category.save(update_fields=fields)
    return category


def categories() -> list[dict]:
    """Every category, those in use first, with how many rows each holds (a retired one keeps its rows)."""
    used = dict(Expense.objects.values_list("category_id").annotate(n=Count("id")))
    return [
        {"id": c.pk, "name": c.name, "retired": c.retired_at is not None, "used": used.get(c.pk, 0)}
        for c in sorted(ExpenseCategory.objects.all(), key=lambda c: (c.retired_at is not None, c.name.lower()))
    ]
