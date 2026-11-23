"""/ops/finance's Expenses tab (``billing.expenses``). Reading needs ``view_money``; entering, voiding and keeping the
category list need ``manage_expenses`` (owner, 2026-11-22: the owner's and the accountant's). Entering and voiding
wait for the cutover, as payments do."""

from __future__ import annotations

import calendar
from datetime import date

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import Requires, require
from access.services import authorize

from . import conf
from . import expenses as X
from .models import Expense, ExpenseCategory, PaymentMethod

CLOSED = "Expenses are kept in lc-up until the cutover."


def _bad(detail: str) -> Response:
    return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)


def _month(today: date) -> tuple[date, date]:
    return today.replace(day=1), today.replace(day=calendar.monthrange(today.year, today.month)[1])


def _day(raw, fallback: date) -> date | None:
    if raw in (None, ""):
        return fallback
    try:
        return parse_date(str(raw))
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        return None


def _id(raw) -> int | None:
    text = str(raw or "").strip()
    return int(text) if text.isdigit() else None


class ExpenseListView(APIView):
    """``GET …/expenses/?from=&to=&category=&spent_by=&archived=1`` — this month by default; ``POST`` one expense."""

    permission_classes = [Requires(C.PERM_VIEW_MONEY, C.PERM_MANAGE_EXPENSES)]

    def get(self, request):
        require(request.user, C.PERM_VIEW_MONEY)
        first, last = _month(timezone.localdate())
        start, end = _day(request.query_params.get("from"), first), _day(request.query_params.get("to"), last)
        if start is None or end is None:
            return _bad("That is not a date.")
        if end < start:
            return _bad("The end comes before the start.")
        archived = str(request.query_params.get("archived", "")).strip().lower() in {"1", "true", "yes"}
        rows = X.matching(
            start=start, end=end, category_id=_id(request.query_params.get("category")),
            spent_by_id=_id(request.query_params.get("spent_by")), archived=archived,
        )
        return Response({"from": start.isoformat(), "to": end.isoformat(), "archived": archived, **X.listing(rows)})

    def post(self, request):
        require(request.user, C.PERM_MANAGE_EXPENSES)
        if not conf.payments_open():
            return Response({"detail": CLOSED}, status=status.HTTP_403_FORBIDDEN)
        data, today = request.data, timezone.localdate()
        try:
            expense, created = X.add_expense(
                day=_day(data.get("day"), today), amount=data.get("amount"), category_id=data.get("category"),
                method=str(data.get("method") or ""), spent_by_id=data.get("spent_by"), reason=data.get("reason"),
                request_id=data.get("request_id"), by=request.user, today=today,
            )
        except X.ExpenseRefused as refused:
            return _bad(str(refused))
        return Response(X.row(expense), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class ExpenseVoidView(APIView):
    """``POST …/expenses/<id>/void/ {reason}``: the row stays, in the archive, with who voided it and why."""

    permission_classes = [Requires(C.PERM_MANAGE_EXPENSES)]

    def post(self, request, pk: int):
        if not conf.payments_open():
            return Response({"detail": CLOSED}, status=status.HTTP_403_FORBIDDEN)
        expense = get_object_or_404(Expense, pk=pk)
        try:
            expense = X.void_expense(expense, request.data.get("reason"), by=request.user)
        except X.ExpenseRefused as refused:
            return _bad(str(refused))
        return Response(X.row(expense))


class ExpenseMetaView(APIView):
    """What the tab's form and filters offer: the categories, the staff, the methods, and what this person may do."""

    permission_classes = [Requires(C.PERM_VIEW_MONEY, C.PERM_MANAGE_EXPENSES)]

    def get(self, request):
        return Response({
            "categories": X.categories(),
            "staff": X.staff_choices(),
            "methods": [{"value": value, "label": label} for value, label in PaymentMethod.choices],
            "can_manage": authorize(request.user, C.PERM_MANAGE_EXPENSES),
            "open": conf.payments_open(),
            "me": request.user.pk,
        })


class ExpenseCategoryListView(APIView):
    """``POST …/expense-categories/ {name}``."""

    permission_classes = [Requires(C.PERM_MANAGE_EXPENSES)]

    def post(self, request):
        try:
            category = X.add_category(request.data.get("name"), by=request.user)
        except X.ExpenseRefused as refused:
            return _bad(str(refused))
        return Response({"id": category.pk, "name": category.name, "retired": False, "used": 0}, status=status.HTTP_201_CREATED)


class ExpenseCategoryDetailView(APIView):
    """``PATCH …/expense-categories/<id>/ {name?, retired?}``: renamed, retired or back in use; never deleted."""

    permission_classes = [Requires(C.PERM_MANAGE_EXPENSES)]

    def patch(self, request, pk: int):
        category = get_object_or_404(ExpenseCategory, pk=pk)
        retired = request.data.get("retired")
        if retired is not None and not isinstance(retired, bool):
            return _bad("Retired is true or false.")
        try:
            category = X.change_category(category, name=request.data.get("name"), retired=retired)
        except X.ExpenseRefused as refused:
            return _bad(str(refused))
        return Response({
            "id": category.pk, "name": category.name, "retired": category.retired_at is not None,
            "used": category.expenses.count(),
        })
