"""Admin-console midterm statistics: pass rates by month, branch, department and teacher.

Three read-only surfaces under /api/midterms/admin/stats/ (which months have data → the
whole school for one month → one classroom's month). Every number is computed in
``midterms.stats``; nothing is derived here, so the console and any other reader of that
module cannot come to different conclusions about the same class.

Gated on ``IsGlobalScopeStaff`` — the same permission the admin reports use, and
deliberately NOT ``CanManageQuestions``, which returns True for teachers. These pages rank
teachers against each other; a teacher must not be able to open one.

Every payload carries the ``definition`` block from ``midterms.stats``. The school reads
these figures to evaluate its staff, so the page has to be able to state the rule it is
applying — "passed / all roster students, absent counts as failed, roll-ups pooled" — rather
than leave a reader to assume whichever definition they already had in mind.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from classes.models import Classroom

from .admin_report import IsGlobalScopeStaff
from .stats import (
    DEFINITION,
    SUBJECT_ALIASES,
    available_months,
    classroom_brief,
    classroom_month,
    classroom_months,
    is_month_key,
    school_month_stats,
)


class InvalidFilter(Exception):
    """A query parameter the caller has to fix. Carries the sentence they will be shown."""


def _int_param(request, name):
    """An optional integer query parameter. Absent → ``None``; garbage → a 400, never a 500.

    An unparseable id is a caller mistake worth naming: silently ignoring it would answer
    with the whole school under a heading that says it is filtered to one branch.
    """
    raw = (request.query_params.get(name) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise InvalidFilter(f"'{name}' must be a numeric id.")


def _subject_param(request):
    """The optional subject filter, normalised to a ``Classroom.subject``.

    Accepts either vocabulary — a caller holding a ``Midterm.subject`` of READING_WRITING
    means the English department — because the two disagree on exactly one of their two
    values, which is the kind of mismatch that returns an empty page instead of an error.
    """
    raw = (request.query_params.get("subject") or "").strip().upper()
    if not raw:
        return None
    subject = SUBJECT_ALIASES.get(raw)
    if subject is None:
        options = ", ".join(sorted({v for v in SUBJECT_ALIASES.values()}))
        raise InvalidFilter(f"Unknown subject '{raw}'. Expected one of: {options}.")
    return subject


def _month_param(request, fallback):
    """The requested month, or the most recent one with data.

    ``fallback`` is the descending month list this view can offer, so an omitted ``month``
    opens on the newest month that actually has midterms in it rather than on today's, which
    is empty for most of every month.
    """
    raw = (request.query_params.get("month") or "").strip()
    if not raw:
        return fallback[0] if fallback else None
    if not is_month_key(raw):
        raise InvalidFilter(f"'{raw}' is not a month. Expected YYYY-MM, e.g. 2026-09.")
    return raw


class StatsMonthsView(APIView):
    """GET /api/midterms/admin/stats/months/ — the months the picker may offer."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        months = available_months()
        return Response({"months": months, "current": months[0] if months else None})


class StatsMonthlyView(APIView):
    """GET .../stats/monthly/?month=&branch=&subject=&teacher= — the whole school, pooled."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        months = available_months()
        try:
            month = _month_param(request, months)
            branch_id = _int_param(request, "branch")
            teacher_id = _int_param(request, "teacher")
            subject = _subject_param(request)
        except InvalidFilter as exc:
            return Response({"detail": str(exc)}, status=400)

        payload = school_month_stats(
            month, branch_id=branch_id, subject=subject, teacher_id=teacher_id
        )
        # The month list travels with the data so the page can render its picker from one
        # response — and so an empty month is visibly an empty month rather than a failure.
        payload["months"] = months
        payload["filters"] = {"branch": branch_id, "subject": subject, "teacher": teacher_id}
        return Response(payload)


class StatsClassroomView(APIView):
    """GET .../stats/classrooms/<cid>/?month= — one classroom's month, midterm by midterm."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request, cid=None):
        classroom = get_object_or_404(
            Classroom.objects.select_related("teacher", "branch", "branch__region"), pk=cid
        )
        # This classroom's own months, not the school's: opening a class on a month it never
        # sat a midterm in would show an empty table under a month the picker offered.
        months = classroom_months(classroom.id)
        try:
            month = _month_param(request, months)
        except InvalidFilter as exc:
            return Response({"detail": str(exc)}, status=400)

        rows, summary = classroom_month(classroom, month)
        return Response(
            {
                "classroom": classroom_brief(classroom),
                "month": month,
                "months": months,
                "definition": dict(DEFINITION),
                "summary": summary,
                "rows": rows,
            }
        )
