"""Ops: the support desk's history and its month.

    GET /api/classes/support/report/sessions/?teacher=&from=&to=&status=&student=&limit=&offset=
    GET /api/classes/support/report/monthly/?month=YYYY-MM&teacher=

Read-only, and an **administrator's** report. Gated on ``IsGlobalScopeStaff`` — the same class
``midterms.admin_report`` uses, which is ``access.services.is_global_scope_staff``: superuser,
admin, super_admin, test_admin, test_auditor.

Deliberately **not** the guard every other endpoint in ``views_support`` uses. That one is
``_is_support_teacher(user) or _is_admin(user)``, and it is right for those: a support teacher
reading their own diary is reading their own work. This report is not scoped to the reader —
``?teacher=`` names anybody — so the same guard here would let one support teacher pull
another's roster of students, their topics and their ratings. ``IsGlobalScopeStaff`` also
excludes classroom teachers for the reason ``midterms/admin_report`` records: a permission that
returns True for teachers is not an admin gate.

The aggregation is in ``support_report`` and this file holds none of it. That split is what
lets the tests pin the arithmetic — the backlog especially — without a client and a login.
"""

from __future__ import annotations

from django.utils.dateparse import parse_date
from rest_framework.response import Response
from rest_framework.views import APIView

from midterms.admin_report import IsGlobalScopeStaff

from . import support_report


def _int_or_none(raw):
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _date_or_error(raw, field: str):
    """``(value, error)``. A date we cannot read is REFUSED, never ignored.

    Silently dropping an unparseable ``from=`` would answer a request for one week with the
    whole history and look like a correct — and much worse — answer.
    """
    if raw in (None, ""):
        return None, None
    value = parse_date(str(raw))
    if value is None:
        return None, Response({"detail": f"{field} should look like 2026-09-01."}, status=400)
    return value, None


class SupportReportSessionsView(APIView):
    """Every support session, newest first — who, when, what about, and how it ended."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        params = request.query_params
        date_from, err = _date_or_error(params.get("from"), "from")
        if err:
            return err
        date_to, err = _date_or_error(params.get("to"), "to")
        if err:
            return err
        if date_from and date_to and date_to < date_from:
            return Response({"detail": "The end date is before the start date."}, status=400)

        try:
            page = support_report.session_history(
                teacher_id=_int_or_none(params.get("teacher")),
                student_id=_int_or_none(params.get("student")),
                date_from=date_from,
                date_to=date_to,
                status=params.get("status") or None,
                offset=_int_or_none(params.get("offset")) or 0,
                limit=_int_or_none(params.get("limit")) or support_report.DEFAULT_PAGE_SIZE,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        return Response({
            **page,
            # Sent with the page so the filter bar can be built from the server's own
            # vocabulary. A status list hand-written in React is a status list that drifts.
            "statuses": [
                {"value": value, "label": support_report.STATUS_LABELS.get(value, value)}
                for value in support_report.SESSION_STATUSES
            ] + [{"value": support_report.STATUS_UNSETTLED, "label": "Not settled yet"}],
        })


class SupportReportMonthlyView(APIView):
    """One month of the support desk, per teacher, with the unsettled backlog on top."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        try:
            data = support_report.monthly_summary(
                month=request.query_params.get("month"),
                teacher_id=_int_or_none(request.query_params.get("teacher")),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(data)
