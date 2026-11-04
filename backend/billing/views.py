"""The ledger on /ops/finance, for admins only. Read-only: lc-up stays the master until the cutover."""

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from classes.capabilities import is_global_admin

from . import conf
from .models import Account, BillingRun, BillingState, Entry, SeatState

#: How many runs with something wrong the summary shows.
PROBLEMS_SHOWN = 5


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
        for entry in account.entries.select_related("created_by"):
            if entry.voided_at is None:
                running += entry.amount
            rows.append({
                "id": entry.pk, "day": _iso(entry.day), "kind": entry.kind, "label": entry.get_kind_display(),
                "amount": entry.amount, "running": running, "month": entry.month, "method": entry.method,
                "note": entry.note, "by": entry.created_by.username if entry.created_by else "",
                "voided_at": _iso(entry.voided_at), "void_reason": entry.void_reason,
            })
        seats = [
            {"id": seat.pk, "group_name": seat.group_name, "state": seat.state, "price": seat.price}
            for seat in account.seats.order_by("id")
        ]
        return Response({
            "id": account.pk, "name": account.name, "phone": account.phone, "balance": running,
            "seats": seats, "rows": rows,
        })
