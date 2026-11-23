"""/ops/finance's Reports tab (``billing.report``): ``GET /api/billing/report/?from=&to=``, this month by default, at
most a year at a time. Money totals, so ``view_reports`` (plan 2026-11-12-crm-roles)."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import Requires

from .report import MAX_DAYS, period_report
from .views_expenses import _bad, _day, _month


class ReportView(APIView):
    permission_classes = [Requires(C.PERM_VIEW_REPORTS)]

    def get(self, request):
        today = timezone.localdate()
        first, last = _month(today)
        start, end = _day(request.query_params.get("from"), first), _day(request.query_params.get("to"), last)
        if start is None or end is None:
            return _bad("That is not a date.")
        if end < start:
            return _bad("The end comes before the start.")
        if (end - start).days + 1 > MAX_DAYS:
            return Response({"detail": "A report covers a year at most."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(period_report(start, end, today=today))
