"""The ledger on /ops/finance, for admins only. Read-only until the cutover: lc-up stays the master."""

import uuid

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from classes.capabilities import is_global_admin

from . import conf, ledger
from .models import Account, BillingRun, BillingState, Entry, EntryKind, SeatState

#: How many runs with something wrong the summary shows.
PROBLEMS_SHOWN = 5
ENTERABLE_KINDS = {EntryKind.PAYMENT.value, EntryKind.REFUND.value, EntryKind.ADJUST.value}


class IsGlobalAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and is_global_admin(user))


class _AdminView(APIView):
    permission_classes = [IsGlobalAdmin]


def _iso(value):
    return value.isoformat() if value else None


def _current_account_ids() -> set[int]:
    return set(Account.objects.filter(seats__isnull=False).exclude(seats__state=SeatState.LEFT).values_list("pk", flat=True))


class SummaryView(_AdminView):
    def get(self, request):
        state = BillingState.get()
        accounts = Account.objects.count()
        latest = BillingRun.objects.filter(kind=BillingRun.Kind.COMPARE).first()
        problems = BillingRun.objects.exclude(errors=[], alerts=[])[:PROBLEMS_SHOWN]
        return Response({
            "enabled": conf.shadow_enabled(),
            "opened_at": _iso(state.opened_at),
            "last_tick_at": _iso(state.last_tick_at),
            "accounts": accounts,
            "former": accounts - len(_current_account_ids()),
            "comparison": latest and {
                "day": _iso(latest.day),
                "ok": latest.ok,
                "counts": latest.counts,
                "rows": latest.rows,
                "alerts": latest.alerts,
            },
            "problems": [
                {"at": _iso(run.started_at), "kind": run.kind, "errors": run.errors, "alerts": run.alerts}
                for run in problems
            ],
        })


class AccountListView(_AdminView):
    def get(self, request):
        scope = request.query_params.get("scope")
        balances = dict(Entry.objects.filter(voided_at__isnull=True).values_list("account_id").annotate(total=Sum("amount")))
        current = _current_account_ids()
        rows = []
        for account in Account.objects.all():
            former = account.pk not in current
            if (scope == "former" and not former) or (scope == "current" and former):
                continue
            rows.append({
                "id": account.pk, "name": account.name, "phone": account.phone,
                "balance": balances.get(account.pk, 0), "former": former,
            })
        rows.sort(key=lambda row: (row["balance"], row["name"]))
        return Response({"accounts": rows})


class AccountDetailView(_AdminView):
    def get(self, request, pk):
        account = get_object_or_404(Account, pk=pk)
        running, rows = 0, []
        for entry in account.entries.select_related("created_by", "voided_by"):
            if entry.voided_at is None:
                running += entry.amount
            rows.append({
                "id": entry.pk, "day": _iso(entry.day), "kind": entry.kind, "label": entry.get_kind_display(),
                "amount": entry.amount, "running": running, "month": entry.month, "method": entry.method,
                "note": entry.note, "by": entry.created_by.username if entry.created_by else "",
                "voided_at": _iso(entry.voided_at), "void_reason": entry.void_reason,
                "voided_by": entry.voided_by.username if entry.voided_by else "",
                "can_void": ledger.was_entered_by_hand(entry) and entry.voided_at is None,
            })
        seats = [
            {"id": seat.pk, "group_name": seat.group_name, "state": seat.state, "price": seat.price}
            for seat in account.seats.order_by("id")
        ]
        return Response({
            "id": account.pk, "name": account.name, "phone": account.phone, "balance": running,
            "seats": seats, "rows": rows, "payments_open": conf.payments_open(),
        })


def _closed() -> Response:
    return Response({"detail": "Money is entered in lc-up until the cutover."}, status=status.HTTP_403_FORBIDDEN)


def _bad(detail: str) -> Response:
    return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)


class EntryCreateView(_AdminView):
    """Money an admin enters. Refused until the cutover, while it is still entered in lc-up."""

    def post(self, request, pk):
        if not conf.payments_open():
            return _closed()
        account = get_object_or_404(Account, pk=pk)
        data = request.data
        kind = data.get("kind")
        if kind not in ENTERABLE_KINDS:
            return _bad("Only a payment, a refund or an adjustment can be entered.")
        try:
            request_id = uuid.UUID(str(data.get("request_id")))
        except ValueError:
            return _bad("This form is out of date. Reload the page.")
        today = timezone.localdate()
        try:
            day = parse_date(str(data["day"])) if data.get("day") else today
        except ValueError:
            day = None
        if day is None:
            return _bad("That is not a date.")
        try:
            ledger.enter_money(
                account, kind, data.get("amount"), day, request_id=request_id, today=today,
                method=str(data.get("method") or ""), note=str(data.get("note") or ""), by=request.user,
            )
        except ledger.EntryRefused as exc:
            return _bad(str(exc))
        return Response({"balance": ledger.balance(account)}, status=status.HTTP_201_CREATED)


class EntryVoidView(_AdminView):
    """Any admin may void what any admin entered (owner, 2026-11-04); the reason and the name stay on the row."""

    def post(self, request, pk):
        if not conf.payments_open():
            return _closed()
        entry = get_object_or_404(Entry.objects.select_related("account"), pk=pk)
        try:
            ledger.void_entered(entry, str(request.data.get("reason") or ""), by=request.user)
        except ledger.EntryRefused as exc:
            return _bad(str(exc))
        return Response({"balance": ledger.balance(entry.account)})
