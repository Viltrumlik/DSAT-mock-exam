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

Beside it every payload also carries what it is NOT showing, for the same reason:

* ``this_month`` / ``future_months`` / ``is_future`` — a month scheduled ahead is offered by
  the picker but is never the default, and when one IS selected the page has to label it as
  scheduled rather than render its all-absent roster as a pass rate of zero.
* ``orphan_retakes`` — retake papers with no parent midterm, excluded from every number
  because they cannot be counted or folded, and named so the page can say "1 retake paper has
  no parent midterm and was left out" instead of just quietly having fewer papers.
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
    current_month_key,
    default_month,
    future_months,
    is_future_month,
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
    """The requested month, or the newest month the caller's own scope has already reached.

    ``fallback`` is the descending month list THIS view can offer — which for a filtered
    request is that filter's months, not the school's — so an omitted ``month`` opens on a
    month the page actually has data for rather than on today's, which is empty for most of
    every month.

    The default goes through :func:`~midterms.stats.default_month` rather than taking
    ``fallback[0]``: the newest month a school has is routinely one it has not reached, since
    every teacher assign path writes a ``starts_at`` and a paper booked for next month dates
    into next month. Opening there reported a full roster of absentees as a 0.0% pass rate.
    """
    raw = (request.query_params.get("month") or "").strip()
    if not raw:
        return default_month(fallback)
    if not is_month_key(raw):
        raise InvalidFilter(f"'{raw}' is not a month. Expected YYYY-MM, e.g. 2026-09.")
    return raw


def _month_context(months, month) -> dict:
    """What every payload says about time, so no reader has to do date maths of its own.

    ``this_month`` is the school's month in ``TIME_ZONE`` (a reader's device may be on any
    other date), ``future_months`` are the offered months nobody has sat yet, and
    ``is_future`` marks the selected one — a month that is SCHEDULED, and must be labelled
    that way rather than presented as a score of zero.
    """
    return {
        "this_month": current_month_key(),
        "future_months": future_months(months),
        "is_future": is_future_month(month),
    }


class StatsMonthsView(APIView):
    """GET /api/midterms/admin/stats/months/ — the months the picker may offer."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        months = available_months()
        return Response(
            {
                "months": months,
                # The month to OPEN on — never merely the newest, which is routinely a month
                # scheduled ahead. ``None`` when every month the school has is still ahead of
                # it: no results yet, which ``future_months`` then explains.
                "current": default_month(months),
                "this_month": current_month_key(),
                "future_months": future_months(months),
            }
        )


class StatsMonthlyView(APIView):
    """GET .../stats/monthly/?month=&branch=&subject=&teacher= — the whole school, pooled."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        try:
            # Filters first: the month list and the default both belong to the FILTERED
            # scope. Built from the school's months, the picker offered a branch months that
            # branch has no data for, and an omitted month then opened the page on one of
            # them — an empty table under a month the picker had just offered.
            branch_id = _int_param(request, "branch")
            teacher_id = _int_param(request, "teacher")
            subject = _subject_param(request)
            months = available_months(
                branch_id=branch_id, subject=subject, teacher_id=teacher_id
            )
            month = _month_param(request, months)
        except InvalidFilter as exc:
            return Response({"detail": str(exc)}, status=400)

        payload = school_month_stats(
            month, branch_id=branch_id, subject=subject, teacher_id=teacher_id
        )
        # The month list travels with the data so the page can render its picker from one
        # response — and so an empty month is visibly an empty month rather than a failure.
        payload["months"] = months
        payload.update(_month_context(months, month))
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

        rows, summary, orphan_retakes = classroom_month(classroom, month)
        return Response(
            {
                "classroom": classroom_brief(classroom),
                "month": month,
                "months": months,
                "definition": dict(DEFINITION),
                "summary": summary,
                "rows": rows,
                # Papers deliberately left out of ``rows``, named so their absence can be
                # accounted for rather than looking like a paper that went missing.
                "orphan_retakes": orphan_retakes,
                **_month_context(months, month),
            }
        )
