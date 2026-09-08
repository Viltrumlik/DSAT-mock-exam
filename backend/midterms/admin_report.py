"""Admin-console midterm reports: who passed, who failed, who was rescued by the retake.

Three read-only surfaces under /api/midterms/admin/reports/ (classroom list → per-classroom
midterms → per-midterm student table), plus a PDF of the last one.

Two rules shape everything here:

* The **roster is the classroom**, not the attempt table. A report that only listed students
  who sat the paper would silently drop the absentees, who are the very people it exists to
  surface — so rows are enumerated from ``ClassroomMembership`` and the attempt is joined on.
* The verdict is read from the frozen ``MidtermOutcome``, never recomputed from the current
  pass mark, so raising a pass mark next term does not retroactively fail last term's class.
* **A retake overturns an absence as well as a fail.** ``access.retake_eligible_students``
  grants the second chance to everyone who did not pass, which is failers *and* absentees —
  so the retake is consulted for both, and a student the retake rescued is PASSED_ON_RETAKE
  whichever way they failed to pass the first time.

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


def midterm_ids_by_resource_id(resource_ids) -> dict[int, int]:
    """Grant ``resource_id`` → Midterm id, absorbing cutover leftovers that still carry a
    legacy ``MockExam.id`` (same normalization as midterms.access).

    A mapping rather than a set because a caller grouping grants BY CLASSROOM (the monthly
    statistics roll-up) needs to know which midterm each grant pointed at, not merely that
    some midterm did.
    """
    if not resource_ids:
        return {}
    out = {mid: mid for mid in Midterm.objects.filter(id__in=resource_ids).values_list("id", flat=True)}
    for legacy_id, mid in Midterm.objects.filter(
        legacy_mock_exam_id__in=resource_ids
    ).values_list("legacy_mock_exam_id", "id"):
        out.setdefault(legacy_id, mid)
    return out


def _midterm_ids_for_resource_ids(resource_ids) -> set[int]:
    return set(midterm_ids_by_resource_id(resource_ids).values())


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
def sitting_for(midterm, student_id, attempts_by_student, outcomes_by_student) -> dict:
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


def final_status_for(midterm_sitting, retake_sitting) -> str:
    """One student's final verdict on a paper, given their parent sitting and their retake.

    A retake pass overturns BOTH ways of not passing — a recorded fail and an absence. The
    absence case is not an edge: ``access.retake_eligible_students`` grants the retake to
    failers *and* absentees precisely because "a student who was ill that morning" has had
    no first chance at all. Consulting the retake only inside the ``passed is False`` branch
    left those students marked ABSENT no matter what the retake said, so the same payload
    reported a class as 80% while every one of its students held a pass.
    """
    if midterm_sitting["passed"] is True:
        return STATUS_PASSED
    # A student who has not yet sat the retake still stands where the parent left them —
    # the recorded verdict is a fail (or an absence) until a retake overturns it.
    rescued = bool(retake_sitting) and retake_sitting["passed"] is True
    if midterm_sitting["passed"] is False:
        return STATUS_PASSED_ON_RETAKE if rescued else STATUS_FAILED
    if midterm_sitting["state"] == STATE_ABSENT:
        return STATUS_PASSED_ON_RETAKE if rescued else STATE_ABSENT
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


def pick_sitting(previous, candidate):
    """Which of two attempts by one student at one midterm the reports read.

    A completed sitting always beats an abandoned/in-flight one; otherwise the later row
    wins. Stated once, here, because ``midterms.stats`` indexes a single school-wide attempt
    query rather than one query per midterm — and a bulk reader that picked a different
    attempt would put a student in a different column from the one the admin report shows.
    """
    if previous is None or candidate.is_completed or not previous.is_completed:
        return candidate
    return previous


def _attempts_by_student(midterm_id, student_ids) -> dict:
    out = {}
    for a in MidtermAttempt.objects.filter(midterm_id=midterm_id, student_id__in=student_ids).order_by(
        "created_at"
    ):
        out[a.student_id] = pick_sitting(out.get(a.student_id), a)
    return out


def _outcomes_by_student(midterm_id, student_ids) -> dict:
    return {
        o.student_id: o
        for o in MidtermOutcome.objects.filter(midterm_id=midterm_id, student_id__in=student_ids)
    }


def resolve_retake(retakes, student_id, attempts_by_midterm, outcomes_by_midterm):
    """``(sitting, took_one, passed_one)`` for one student across EVERY retake of a paper.

    The single rule for "which second chance decided this student's fate", stated once and
    read by both surfaces that need it: the pooled statistic in ``midterms.stats`` and the
    per-student evidence table below. They used to disagree — statistics unioned every
    retake while the table read only ``retake_for`` (the first) — so on a paper given two
    second chances the headline counted a student rescued by the second as a pass while the
    table underneath it printed them as a failure.

    The first PASS wins. Failing that, the first sitting that is not an absence, so the table
    shows a real attempt rather than an empty cell. Failing that, ``None``.

    ``attempts_by_midterm`` / ``outcomes_by_midterm`` are ``{midterm_id: {student_id: row}}``
    — the shape a bulk reader already has, so neither caller issues a query in here.
    """
    best = None
    took_one = False
    for retake in retakes:
        r_attempts = attempts_by_midterm.get(retake.id, {})
        r_outcomes = outcomes_by_midterm.get(retake.id, {})
        sitting = sitting_for(retake, student_id, r_attempts, r_outcomes)
        attempt = r_attempts.get(student_id)
        if attempt is not None and attempt.is_completed:
            took_one = True
        if sitting["passed"] is True:
            # A frozen verdict is proof of a sitting even where the attempt row has gone.
            return sitting, True, True
        if best is None and sitting["state"] != STATE_ABSENT:
            best = sitting
    return best, took_one, False


def _as_retakes(value) -> list:
    """``None`` / one ``Midterm`` / an iterable of them → a list, oldest first."""
    if value is None:
        return []
    if hasattr(value, "pk"):
        return [value]
    return list(value)


def build_midterm_rows(classroom, midterm, retakes) -> tuple[list[dict], dict]:
    """The per-student table for one midterm (+ its retakes), and the summary above it.

    ``retakes`` may be a single ``Midterm`` or every retake of the paper; pass them all, or a
    student rescued by the second one reads as a failure here while the statistics page
    counts them as a pass.
    """
    student_ids = classroom_student_ids(classroom.id)
    students = {u.id: u for u in User.objects.filter(id__in=student_ids)}
    retakes = _as_retakes(retakes)

    m_attempts = _attempts_by_student(midterm.id, student_ids)
    m_outcomes = _outcomes_by_student(midterm.id, student_ids)
    r_attempts = {r.id: _attempts_by_student(r.id, student_ids) for r in retakes}
    r_outcomes = {r.id: _outcomes_by_student(r.id, student_ids) for r in retakes}

    rows = []
    for sid in student_ids:
        student = students.get(sid)
        if student is None:  # membership pointing at a deleted user
            continue
        m = sitting_for(midterm, sid, m_attempts, m_outcomes)
        # Everyone who did not pass is offered a second chance, and only when one exists.
        # That is failers AND absentees — the same cohort ``access.retake_eligible_students``
        # hands the grant to. Gating on ``passed is False`` alone excluded every absentee, so
        # the retake column stayed blank for the students a retake most exists for and the
        # verdict below could never be overturned.
        eligible = bool(retakes) and (m["passed"] is False or m["state"] == STATE_ABSENT)
        r = resolve_retake(retakes, sid, r_attempts, r_outcomes)[0] if eligible else None
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
                "final_status": final_status_for(m, r),
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


def retakes_for(midterm):
    """EVERY retake of ``midterm``, oldest first.

    A paper can be given more than one second chance — nothing stops a second RETAKE row
    pointing at the same parent, and the retake-grant path is happy to issue one. **Every
    reader takes all of them**: a student rescued by the *second* retake passed just as much
    as one rescued by the first, and reading only the first reported them as a failure.

    The per-student table still shows ONE retake column, but which sitting fills it is
    :func:`resolve_retake`'s answer over the whole list rather than "whichever row has the
    lowest id".
    """
    return Midterm.objects.filter(retake_of_id=midterm.id).order_by("id")


def retake_for(midterm) -> "Midterm | None":
    """The oldest retake of ``midterm``, for a caller that can name only one of them.

    Naming a paper (a header, a PDF title) is what this is for. Deciding a student's verdict
    is not — use :func:`retakes_for` with :func:`resolve_retake`.
    """
    return retakes_for(midterm).first()


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
            retakes = list(retakes_for(m))
            _, summary = build_midterm_rows(classroom, m, retakes)
            sched = schedules.get(m.id)
            rows.append(
                {
                    **_midterm_brief(m),
                    "scheduled_at": sched.starts_at.isoformat() if (sched and sched.starts_at) else None,
                    "counts": {k: summary[k] for k in ("passed", "failed", "absent", "pending")},
                    # ``retake`` is the oldest, kept for the existing single-retake reader;
                    # ``retakes`` is all of them, because the counts beside it already are.
                    "retake": ({"id": retakes[0].id, "title": retakes[0].title} if retakes else None),
                    "retakes": [{"id": r.id, "title": r.title} for r in retakes],
                }
            )
        return Response({"classroom": _classroom_brief(classroom), "midterms": rows})


def _resolve_report(cid, mid) -> tuple:
    classroom = get_object_or_404(Classroom.objects.select_related("teacher"), pk=cid)
    midterm = get_object_or_404(Midterm, pk=mid)
    retakes = list(retakes_for(midterm))
    rows, summary = build_midterm_rows(classroom, midterm, retakes)
    return classroom, midterm, retakes, rows, summary


class ReportMidtermDetailView(APIView):
    """GET .../classrooms/<cid>/midterms/<mid>/ — the per-student results table."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request, cid=None, mid=None):
        classroom, midterm, retakes, rows, summary = _resolve_report(cid, mid)
        return Response(
            {
                "classroom": _classroom_brief(classroom),
                "midterm": _midterm_brief(midterm),
                # One retake column, so one named paper — but every retake is disclosed
                # beside it, because a row's retake cell may come from any of them.
                "retake": _midterm_brief(retakes[0]) if retakes else None,
                "retakes": [_midterm_brief(r) for r in retakes],
                "summary": summary,
                "rows": rows,
            }
        )


class ReportMidtermPdfView(APIView):
    """GET .../classrooms/<cid>/midterms/<mid>/pdf/ — the same table as an A4 PDF."""

    permission_classes = [IsGlobalScopeStaff]

    def get(self, request, cid=None, mid=None):
        classroom, midterm, retakes, rows, summary = _resolve_report(cid, mid)
        from .report_pdf import render_classroom_midterm_report_pdf

        sched = MidtermSchedule.objects.filter(classroom_id=classroom.id, midterm_id=midterm.id).first()
        pdf = render_classroom_midterm_report_pdf(
            classroom=_classroom_brief(classroom),
            midterm=_midterm_brief(midterm),
            # The sheet has one retake column and one header slot for it.
            retake=_midterm_brief(retakes[0]) if retakes else None,
            summary=summary,
            rows=rows,
            scheduled_at=sched.starts_at if sched else None,
            generated_at=timezone.now(),
        )
        filename = f"midterm-report-{classroom.id}-{midterm.id}.pdf"
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
