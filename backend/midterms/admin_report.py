"""Admin-console midterm reports: who passed, who failed, who was rescued by the retake.

Three read-only surfaces under /api/midterms/admin/reports/ (classroom list → per-classroom
midterms → per-midterm student table), plus a PDF of the last one.

Two rules shape everything here:

* The **roster is the classroom**, not the attempt table. A report that only listed students
  who sat the paper would silently drop the absentees, who are the very people it exists to
  surface — so rows are enumerated from ``ClassroomMembership`` and the attempt is joined on.
* The verdict is read from the frozen ``MidtermOutcome``, never recomputed from the current
  pass mark, so raising a pass mark next term does not retroactively fail last term's class.

Gated on ``is_global_scope_staff`` (admin / test_admin / super_admin), deliberately NOT
``CanManageQuestions`` — that returns True for teachers, and a teacher must not see another
teacher's classroom results.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from access.services import is_global_scope_staff
from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule

from .models import Midterm, MidtermAttempt, MidtermOutcome
from .views_report import SUBJECT_LABELS, display_name

User = get_user_model()

# Per-student verdict on a single midterm.
STATE_ABSENT = "ABSENT"
STATE_PENDING = "PENDING"
STATUS_PASSED = "PASSED"
STATUS_PASSED_ON_RETAKE = "PASSED_ON_RETAKE"
STATUS_FAILED = "FAILED"
# A finished PRE_MIDTERM: scored, but a diagnostic is never judged. Distinct from PENDING,
# which means "a verdict is still coming" — for a pre-midterm one never is.
STATUS_NOT_GRADED = "NOT_GRADED"


class IsGlobalScopeStaff(BasePermission):
    message = "Only administrators may read midterm reports."

    def has_permission(self, request, view):
        return is_global_scope_staff(getattr(request, "user", None))


# ── roster + classroom↔midterm resolution ────────────────────────────────────
def classroom_student_ids(classroom_id: int) -> list[int]:
    """Student user ids on a classroom's roster, ordered by name.

    Uses ``NON_REMOVED_STATUSES`` rather than a bare ``ACTIVE`` compare because removal is a
    soft delete and INVITED is still a member — the one rule the codebase keeps in one place.
    """
    return list(
        ClassroomMembership.objects.filter(
            classroom_id=classroom_id,
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ).values_list("user_id", flat=True)
    )


def _midterm_ids_for_resource_ids(resource_ids) -> set[int]:
    """Grant ``resource_id``s → Midterm ids, absorbing cutover leftovers that still carry a
    legacy ``MockExam.id`` (same normalization as midterms.access)."""
    if not resource_ids:
        return set()
    ids = set(Midterm.objects.filter(id__in=resource_ids).values_list("id", flat=True))
    ids |= set(Midterm.objects.filter(legacy_mock_exam_id__in=resource_ids).values_list("id", flat=True))
    return ids


def classroom_midterm_ids(classroom_id: int) -> set[int]:
    """Midterms that exist for a classroom: scheduled there, or granted classroom-scoped.

    The grant leg matters twice over: a midterm assigned through the journal/homework path
    creates the access grant before any schedule row exists, and a grant revoked *after* the
    sitting is what a class whose attempts outlived its access looks like. Grant status is
    therefore deliberately not filtered — a report is history, not an access check.
    """
    ids = set(
        MidtermSchedule.objects.filter(classroom_id=classroom_id, midterm__isnull=False).values_list(
            "midterm_id", flat=True
        )
    )
    grant_ids = set(
        ResourceAccessGrant.objects.filter(
            classroom_id=classroom_id,
            scope=ResourceAccessGrant.SCOPE_RESOURCE,
            resource_type=RT_MIDTERM_V2,
        ).values_list("resource_id", flat=True)
    )
    return ids | _midterm_ids_for_resource_ids(grant_ids)


def _classroom_brief(c: Classroom) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "subject": c.subject,
        "level": c.level or "",
        "teacher_name": display_name(c.teacher) if c.teacher_id else "",
    }


def _midterm_brief(m: Midterm) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "subject": m.subject,
        "subject_label": SUBJECT_LABELS.get(m.subject, m.subject),
        "midterm_type": m.midterm_type,
        "pass_mark": m.effective_pass_mark if m.is_graded else None,
        "score_ceiling": m.score_ceiling,
        "scoring_scale": m.scoring_scale,
    }


# ── verdict resolution ───────────────────────────────────────────────────────
def _sitting(midterm, student_id, attempts_by_student, outcomes_by_student) -> dict:
    """One student's (score, state, passed) on one midterm.

    ``passed`` is None whenever there is no verdict to give: absent, still sitting, or a
    PRE_MIDTERM (a diagnostic is scored but never judged).
    """
    attempt = attempts_by_student.get(student_id)
    if attempt is None:
        return {"score": None, "state": STATE_ABSENT, "passed": None}
    if not attempt.is_completed:
        return {"score": None, "state": attempt.current_state, "passed": None}
    outcome = outcomes_by_student.get(student_id)
    if outcome is not None:
        passed = bool(outcome.passed)
    elif midterm.is_graded and attempt.score is not None:
        # No frozen verdict — an attempt completed before verdicts were recorded. Judging it
        # against TODAY's pass mark is exactly the retroactive re-judging MidtermOutcome
        # exists to prevent, so this is a stopgap: run `backfill_midterm_outcomes` to give
        # these sittings a real frozen verdict.
        passed = midterm.is_passing_score(attempt.score)
    else:
        passed = None
    return {
        "score": attempt.score,
        "state": attempt.current_state,
        "passed": passed,
        # Distinguishes "no verdict because it is a diagnostic" from "no verdict yet".
        "graded": bool(midterm.is_graded),
    }


def _final_status(midterm_sitting, retake_sitting) -> str:
    if midterm_sitting["passed"] is True:
        return STATUS_PASSED
    if midterm_sitting["passed"] is False:
        # A failer who has not yet sat the retake still stands failed — the recorded verdict
        # is a fail until a retake overturns it.
        if retake_sitting and retake_sitting["passed"] is True:
            return STATUS_PASSED_ON_RETAKE
        return STATUS_FAILED
    if midterm_sitting["state"] == STATE_ABSENT:
        return STATE_ABSENT
    # A finished PRE_MIDTERM has no verdict and never will. Without this it falls through to
    # PENDING and sits in the admin report as "awaiting result" forever.
    if midterm_sitting.get("graded") is False and midterm_sitting["score"] is not None:
        return STATUS_NOT_GRADED
    return STATE_PENDING


def _tally(statuses) -> dict:
    return {
        "passed": sum(1 for s in statuses if s in (STATUS_PASSED, STATUS_PASSED_ON_RETAKE)),
        "failed": sum(1 for s in statuses if s == STATUS_FAILED),
        "absent": sum(1 for s in statuses if s == STATE_ABSENT),
        "pending": sum(1 for s in statuses if s == STATE_PENDING),
    }


def _attempts_by_student(midterm_id, student_ids) -> dict:
    out = {}
    for a in MidtermAttempt.objects.filter(midterm_id=midterm_id, student_id__in=student_ids).order_by(
        "created_at"
    ):
        prev = out.get(a.student_id)
        # A completed sitting always beats an abandoned/in-flight one; otherwise latest wins.
        if prev is None or a.is_completed or not prev.is_completed:
            out[a.student_id] = a
    return out


def _outcomes_by_student(midterm_id, student_ids) -> dict:
    return {
        o.student_id: o
        for o in MidtermOutcome.objects.filter(midterm_id=midterm_id, student_id__in=student_ids)
    }


def build_midterm_rows(classroom, midterm, retake) -> tuple[list[dict], dict]:
    """The per-student table for one midterm (+ its retake), and the summary above it."""
    student_ids = classroom_student_ids(classroom.id)
    students = {u.id: u for u in User.objects.filter(id__in=student_ids)}

    m_attempts = _attempts_by_student(midterm.id, student_ids)
    m_outcomes = _outcomes_by_student(midterm.id, student_ids)
    r_attempts = _attempts_by_student(retake.id, student_ids) if retake else {}
    r_outcomes = _outcomes_by_student(retake.id, student_ids) if retake else {}

    rows = []
    for sid in student_ids:
        student = students.get(sid)
        if student is None:  # membership pointing at a deleted user
            continue
        m = _sitting(midterm, sid, m_attempts, m_outcomes)
        # Only a failer is offered a second chance, and only when a retake actually exists.
        eligible = bool(retake) and m["passed"] is False
        r = _sitting(retake, sid, r_attempts, r_outcomes) if eligible else None
        rows.append(
            {
                "student_id": sid,
                "student_name": display_name(student),
                "midterm_score": m["score"],
                "midterm_state": m["state"],
                "midterm_passed": m["passed"],
                "retake_score": r["score"] if r else None,
                "retake_state": r["state"] if r else None,
                "retake_passed": r["passed"] if r else None,
                "retake_eligible": eligible,
                "final_status": _final_status(m, r),
            }
        )
    rows.sort(key=lambda r: r["student_name"].lower())

    scored = [r["midterm_score"] for r in rows if r["midterm_score"] is not None]
    summary = {
        "students": len(rows),
        **_tally([r["final_status"] for r in rows]),
        "pass_mark": midterm.effective_pass_mark if midterm.is_graded else None,
        "average_score": int(round(sum(scored) / len(scored))) if scored else None,
    }
    return rows, summary


def retake_for(midterm) -> "Midterm | None":
    return Midterm.objects.filter(retake_of_id=midterm.id).order_by("id").first()


# ── views ────────────────────────────────────────────────────────────────────
class ReportClassroomListView(APIView):
    """GET /api/midterms/admin/reports/classrooms/ — classrooms that have midterm activity."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request):
        # Built from three aggregate queries rather than a per-classroom loop — the console
        # lists every classroom on the platform, so a query per row does not scale.
        by_classroom: dict[int, set[int]] = {}
        for cid, mid in MidtermSchedule.objects.filter(midterm__isnull=False).values_list(
            "classroom_id", "midterm_id"
        ):
            by_classroom.setdefault(cid, set()).add(mid)

        grant_pairs = list(
            ResourceAccessGrant.objects.filter(
                classroom__isnull=False,
                scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM_V2,
            ).values_list("classroom_id", "resource_id")
        )
        resource_ids = {rid for _, rid in grant_pairs}
        direct = set(Midterm.objects.filter(id__in=resource_ids).values_list("id", flat=True))
        legacy = dict(
            Midterm.objects.filter(legacy_mock_exam_id__in=resource_ids).values_list(
                "legacy_mock_exam_id", "id"
            )
        )
        for cid, rid in grant_pairs:
            mid = rid if rid in direct else legacy.get(rid)
            if mid is not None:
                by_classroom.setdefault(cid, set()).add(mid)

        counts: dict[int, int] = {}
        for cid in ClassroomMembership.objects.filter(
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ).values_list("classroom_id", flat=True):
            counts[cid] = counts.get(cid, 0) + 1

        rows = [
            {
                **_classroom_brief(c),
                "student_count": counts.get(c.id, 0),
                "midterm_count": len(by_classroom.get(c.id, ())),
            }
            for c in Classroom.objects.select_related("teacher")
            .filter(id__in=list(by_classroom))
            .order_by("name")
        ]
        return Response({"results": rows})


class ReportClassroomDetailView(APIView):
    """GET .../classrooms/<cid>/ — every midterm in a classroom with its pass/fail tally."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request, cid=None):
        classroom = get_object_or_404(Classroom.objects.select_related("teacher"), pk=cid)
        midterm_ids = classroom_midterm_ids(classroom.id)
        schedules = {
            s.midterm_id: s
            for s in MidtermSchedule.objects.filter(classroom_id=classroom.id, midterm_id__in=midterm_ids)
        }
        rows = []
        for m in Midterm.objects.filter(id__in=midterm_ids).order_by("title"):
            retake = retake_for(m)
            _, summary = build_midterm_rows(classroom, m, retake)
            sched = schedules.get(m.id)
            rows.append(
                {
                    **_midterm_brief(m),
                    "scheduled_at": sched.starts_at.isoformat() if (sched and sched.starts_at) else None,
                    "counts": {k: summary[k] for k in ("passed", "failed", "absent", "pending")},
                    "retake": {"id": retake.id, "title": retake.title} if retake else None,
                }
            )
        return Response({"classroom": _classroom_brief(classroom), "midterms": rows})


def _resolve_report(cid, mid) -> tuple:
    classroom = get_object_or_404(Classroom.objects.select_related("teacher"), pk=cid)
    midterm = get_object_or_404(Midterm, pk=mid)
    retake = retake_for(midterm)
    rows, summary = build_midterm_rows(classroom, midterm, retake)
    return classroom, midterm, retake, rows, summary


class ReportMidtermDetailView(APIView):
    """GET .../classrooms/<cid>/midterms/<mid>/ — the per-student results table."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request, cid=None, mid=None):
        classroom, midterm, retake, rows, summary = _resolve_report(cid, mid)
        return Response(
            {
                "classroom": _classroom_brief(classroom),
                "midterm": _midterm_brief(midterm),
                "retake": _midterm_brief(retake) if retake else None,
                "summary": summary,
                "rows": rows,
            }
        )


class ReportMidtermPdfView(APIView):
    """GET .../classrooms/<cid>/midterms/<mid>/pdf/ — the same table as an A4 PDF."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request, cid=None, mid=None):
        classroom, midterm, retake, rows, summary = _resolve_report(cid, mid)
        from .report_pdf import render_classroom_midterm_report_pdf

        sched = MidtermSchedule.objects.filter(classroom_id=classroom.id, midterm_id=midterm.id).first()
        pdf = render_classroom_midterm_report_pdf(
            classroom=_classroom_brief(classroom),
            midterm=_midterm_brief(midterm),
            retake=_midterm_brief(retake) if retake else None,
            summary=summary,
            rows=rows,
            scheduled_at=sched.starts_at if sched else None,
            generated_at=timezone.now(),
        )
        filename = f"midterm-report-{classroom.id}-{midterm.id}.pdf"
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
