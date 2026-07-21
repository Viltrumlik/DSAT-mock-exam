"""Per-student midterm error report.

Answers one question for a student who has just sat a midterm: *which skills cost me the
paper?* — built entirely from the ``MidtermQuestionResult`` rows frozen at scoring time.
Nothing here re-grades a live ``exams.Question``: midterm content is live-synced from the
builder, so a report rebuilt later would otherwise silently disagree with the score the
student was given (see MidtermQuestionResult's docstring).

Mounted at /api/midterms/attempts/<pk>/error-report/.
"""

from __future__ import annotations

import re

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access.constants import ROLE_ADMIN, ROLE_SUPER_ADMIN, ROLE_TEACHER, ROLE_TEST_ADMIN
from access.services import normalized_role

from .access import midterm_results_state
from .models import MidtermAttempt, MidtermOutcome

User = get_user_model()

# Roles allowed to read somebody else's report (a student only ever sees their own).
_VIEWER_ROLES = {ROLE_TEACHER, ROLE_ADMIN, ROLE_TEST_ADMIN, ROLE_SUPER_ADMIN}

SUBJECT_LABELS = {
    "MATH": "Mathematics",
    "READING_WRITING": "Reading & Writing",
}


def _can_view_others(user) -> bool:
    return bool(normalized_role(user) in _VIEWER_ROLES or user.is_staff or user.is_superuser)


def _safe_filename(text: str, fallback: str = "error-report") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (text or "").strip()).strip("_")
    return cleaned or fallback


def display_name(user) -> str:
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    return full or getattr(user, "username", None) or getattr(user, "email", "") or f"User {user.pk}"


def report_date(attempt) -> str:
    """"21 July 2026" — no leading zero, and platform-independent (``%-d`` is glibc-only)."""
    dt = attempt.completed_at or attempt.submitted_at or attempt.created_at
    if dt is None:
        return ""
    return f"{dt.day} {dt.strftime('%B %Y')}"


def build_error_report(attempt) -> dict:
    """The full error-report payload for one COMPLETED attempt."""
    midterm = attempt.midterm
    rows = list(attempt.question_results.all())

    # Skills are keyed on the FK, but fall back to the frozen name so a retired taxonomy row
    # still groups (skill_name/domain_name are denormalized copies for exactly this reason).
    buckets: dict[object, dict] = {}
    unclassified_total = 0
    unclassified_wrong = 0
    for r in rows:
        if not (r.skill_id or r.skill_name):
            unclassified_total += 1
            if not r.is_correct:
                unclassified_wrong += 1
            continue
        key = r.skill_id or f"name:{r.skill_name}"
        bucket = buckets.setdefault(
            key,
            {
                "skill_id": r.skill_id,
                "skill": r.skill_name,
                "domain": r.domain_name,
                "total": 0,
                "wrong": 0,
            },
        )
        bucket["total"] += 1
        if not r.is_correct:
            bucket["wrong"] += 1

    # Only skills the student actually lost marks on — a fully-correct skill is not an error.
    skills = [b for b in buckets.values() if b["wrong"] > 0]
    skills.sort(key=lambda b: (-b["wrong"], b["skill"]))

    correct_count = sum(1 for r in rows if r.is_correct)

    # Prefer the pass mark FROZEN on the verdict: changing a midterm's pass mark later must
    # not re-judge a student who already sat it.
    outcome = MidtermOutcome.objects.filter(midterm_id=midterm.pk, student_id=attempt.student_id).first()
    if not midterm.is_graded:
        pass_mark, passed = None, None
    elif outcome is not None:
        pass_mark, passed = int(outcome.pass_mark), bool(outcome.passed)
    else:
        pass_mark = midterm.effective_pass_mark
        passed = midterm.is_passing_score(attempt.score)

    return {
        "attempt_id": attempt.id,
        "student_name": display_name(attempt.student),
        "date": report_date(attempt),
        "midterm": {
            "id": midterm.id,
            "title": midterm.title,
            "subject": midterm.subject,
            "subject_label": SUBJECT_LABELS.get(midterm.subject, midterm.subject),
            "scoring_scale": midterm.scoring_scale,
            "score_ceiling": midterm.score_ceiling,
            "level": midterm.level or "",
            "midterm_type": midterm.midterm_type,
        },
        "score": attempt.score,
        "correct_count": correct_count,
        "total_count": len(rows),
        "pass_mark": pass_mark,
        "passed": passed,
        "is_graded": midterm.is_graded,
        # Questions with no taxonomy tag are NOT folded into a skill row — the UI discloses
        # the gap instead of quietly under-reporting a skill's question count.
        "unclassified_total": unclassified_total,
        "unclassified_wrong": unclassified_wrong,
        "skills": skills,
    }


class MidtermErrorReportView(APIView):
    """GET /api/midterms/attempts/<pk>/error-report/ — per-skill breakdown of one attempt.

    A student may only read their own attempt. Staff may read anyone's, and may pass
    ``?student=<id>`` to pivot to that student's attempt at the SAME midterm — which is how
    the admin report flips through a classroom without knowing each attempt id.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk=None):
        attempt = get_object_or_404(
            MidtermAttempt.objects.select_related("midterm", "student"), pk=pk
        )
        staff = _can_view_others(request.user)
        if not staff and attempt.student_id != request.user.id:
            return Response({"detail": "This is not your attempt."}, status=403)

        try:
            student_id = int(request.query_params["student"])
        except (KeyError, TypeError, ValueError):
            student_id = None
        if staff and student_id and attempt.student_id != student_id:
            # Latest completed sitting wins — a student can hold an abandoned attempt too.
            pivot = (
                MidtermAttempt.objects.select_related("midterm", "student")
                .filter(midterm_id=attempt.midterm_id, student_id=student_id, is_completed=True)
                .order_by("-created_at")
                .first()
            )
            if pivot is None:
                return Response({"detail": "No completed attempt for that student."}, status=404)
            attempt = pivot

        if not attempt.is_completed:
            return Response({"detail": "This attempt is not finished yet."}, status=403)

        # The report carries the score, the pass/fail verdict and the full per-skill
        # correctness breakdown — strictly MORE than the score endpoint. So it must sit
        # behind the SAME release gate: on a classroom midterm the teacher decides when
        # results are published, and hiding this client-side is defeated by one curl.
        # Staff are exempt (the admin report reads through this view before publication).
        if not staff and not midterm_results_state(attempt).get("results_visible"):
            return Response(
                {"detail": "Your teacher has not published these results yet.", "released": False},
                status=403,
            )

        if not attempt.question_results.exists():
            # Pre-dating the freeze, or a swallowed freeze error. Reporting zeros here would
            # print "a clean paper — you did not miss a single question" over a failing score,
            # which is worse than admitting the breakdown is unavailable. Run
            # `backfill_midterm_outcomes` to give historical attempts their breakdown.
            return Response(
                {
                    "detail": "A skill breakdown is not available for this attempt.",
                    "reason": "not_analysed",
                },
                status=409,
            )
        return Response(build_error_report(attempt))


class MidtermErrorReportPdfView(MidtermErrorReportView):
    """GET /api/midterms/attempts/<pk>/error-report/pdf/ — the same report, as a PDF.

    Subclasses the JSON view so ownership, the results-release gate and the pivot rules
    cannot drift between the two: a student must not be able to download a sheet the JSON
    endpoint would refuse them.
    """

    def get(self, request, pk=None):
        json_response = super().get(request, pk=pk)
        if json_response.status_code != 200:
            return json_response

        from django.http import HttpResponse
        from django.utils import timezone

        from .report_pdf import render_student_error_report_pdf

        report = json_response.data
        pdf = render_student_error_report_pdf(report, generated_at=timezone.now())
        filename = _safe_filename(f"error-report-{report['midterm']['title']}-{report['student_name']}")
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
        return response


