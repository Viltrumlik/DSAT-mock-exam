"""Classroom teacher endpoints for the NEW separated midterm (midterms.Midterm).

Parallel to the legacy MockExam-based midterm views (views_assign / views_midterm_panel /
views_certificates) but targeting the new Midterm model + midterm_v2 grants:

  POST  /api/classes/<pk>/midterms-v2/assign/                         assign to whole class
  GET   /api/classes/<pk>/midterms-v2/<midterm_id>/panel/             roster + schedule + stats
  PATCH /api/classes/<pk>/midterms-v2/<midterm_id>/panel/             edit schedule window
  POST  /api/classes/<pk>/midterms-v2/<midterm_id>/certificates/issue/  publish → class-ranked certs
"""

from __future__ import annotations

import io
import zipfile

from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import HttpResponse
from rest_framework import status as http
from rest_framework.response import Response

from access.engine.assignment_service import AssignmentService
from access.engine.classroom_service import ClassroomAccessService
from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from midterms.certificate_service import (
    _classroom_cohort_ids,
    _competition_ranks,
    _display_name,
    _latest_completed_attempts,
    issue_classroom_certificates,
)
from midterms.models import Midterm, MidtermAttempt, MidtermResit, MidtermVersion, MidtermVersionAssignment
from midterms.seating import (
    DEFAULT_COLUMNS,
    SEATS_PER_DESK,
    DeskSlot,
    SeatingPlan,
    SeatSlot,
    build_seating_plan,
    clamp_columns,
    columns_from_seat_cols,
    validate_plan,
)

from users.photos import profile_image_url

from .capabilities import classroom_capabilities
from .mail_midterm import notify_class_midterm_scheduled
from .models_certificates import MidtermCertificate
from .models_schedule import MidtermSchedule
from .views_assign import (
    _CLASSROOM_TO_MIDTERM_SUBJECT,
    _parse_schedule_dt,
    missing_starts_at_response,
)
from .views_certificates import serialize_certificate
from .views_rankings import _ClassroomScopedView

User = get_user_model()


def _serialize_schedule(sched):
    if sched is None:
        # No schedule row → open now, results visible (legacy/unscheduled semantics).
        return {
            "midterm_id": None,
            "starts_at": None,
            "deadline": None,
            "ignore_start": False,
            "results_released": False,
            "available_at": None,
            "is_before_start": False,
            "is_open": True,
            "access_code": None,
            "requires_code": False,
            "notified_at": None,
        }
    return {
        "midterm_id": sched.midterm_id,
        "starts_at": sched.starts_at.isoformat() if sched.starts_at else None,
        "deadline": sched.deadline.isoformat() if sched.deadline else None,
        "ignore_start": sched.ignore_start,
        "results_released": sched.results_released,
        "available_at": sched.available_at.isoformat() if sched.available_at else None,
        "is_before_start": sched.is_before_start(),
        "is_open": sched.is_open(),
        # Teacher-only panel — safe to surface the code so it can be shared with the room.
        "access_code": sched.access_code or None,
        "requires_code": sched.requires_code(),
        # When the class was emailed. Drives the panel's wording: the second press of
        # "Start midterm" mails nobody.
        "notified_at": sched.notified_at.isoformat() if sched.notified_at else None,
    }


def _midterm_brief(m: Midterm) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "subject": m.subject,
        "scoring_scale": m.scoring_scale,
        "score_ceiling": m.score_ceiling,
        "duration_minutes": m.duration_minutes,
    }


def _version_brief(v: MidtermVersion) -> dict:
    return {"id": v.id, "version_number": v.version_number, "label": v.label or f"Version {v.version_number}"}


def _assignment_map(midterm, classroom):
    """student_id -> MidtermVersion for this classroom+midterm (current saved assignments)."""
    return {a.student_id: a.version for a in _assignment_rows(midterm, classroom)}


def _assignment_rows(midterm, classroom):
    """The saved MidtermVersionAssignment rows, version preloaded."""
    return list(
        MidtermVersionAssignment.objects.filter(midterm=midterm, classroom=classroom).select_related("version")
    )


class ClassroomMidtermsV2ListView(_ClassroomScopedView):
    """GET /classes/<pk>/midterms-v2/ — midterms already assigned to this classroom."""

    def get(self, request, classroom_pk):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        mids = list(
            ResourceAccessGrant.objects.filter(
                scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM_V2,
                classroom=classroom,
                status=ResourceAccessGrant.STATUS_ACTIVE,
            )
            .values_list("resource_id", flat=True)
            .distinct()
        )
        out = []
        for midterm in Midterm.objects.filter(pk__in=mids):
            cohort = _classroom_cohort_ids(midterm, classroom)
            out.append({
                "midterm_id": midterm.id,
                "title": midterm.title,
                "subject": midterm.subject,
                "assigned": len(cohort),
                "completed": len(_latest_completed_attempts(midterm, cohort)),
            })
        out.sort(key=lambda r: r["title"])
        return Response({"midterms": out})


class MidtermV2CertificatesDownloadAllView(_ClassroomScopedView):
    """GET /classes/<pk>/midterms-v2/<midterm_id>/certificates/download-all/ — ZIP of classroom certs."""

    def get(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        from .certificate_pdf import render_midterm_certificate_pdf
        from .views_certificates import _safe_filename

        certs = list(
            MidtermCertificate.objects.filter(
                classroom=classroom, midterm_id=midterm_id, flavor=MidtermCertificate.FLAVOR_CLASSROOM
            ).order_by("rank")
        )
        if not certs:
            return Response({"detail": "No certificates issued yet."}, status=http.HTTP_404_NOT_FOUND)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for cert in certs:
                idx = f"{cert.rank:02d}" if cert.rank is not None else "00"
                zf.writestr(
                    f"{idx}_{_safe_filename(cert.student_name, 'student')}.pdf",
                    render_midterm_certificate_pdf(cert),
                )
        resp = HttpResponse(buf.getvalue(), content_type="application/zip")
        resp["Content-Disposition"] = (
            f'attachment; filename="certificates-{_safe_filename(certs[0].midterm_title, "midterm")}.zip"'
        )
        return resp


def _classroom_student_ids(classroom) -> list[int]:
    """The roster the access engine grants to (every student membership of the classroom)."""
    from .models import ClassroomMembership

    return list(
        classroom.memberships.filter(role=ClassroomMembership.ROLE_STUDENT).values_list("user_id", flat=True)
    )


def _grant_to_classroom(classroom, midterm, actor):
    """Grant ``midterm`` to the classroom. Returns ``(engine_result, retake_summary|None)``.

    A retake is a SECOND CHANCE, not a second sitting — the builder promises "students who
    passed are never granted it" — so a retake goes to the roster members who did not clear
    its parent, never to the whole room. That is failers AND ABSENTEES: missing the sitting
    is the strongest possible reason to be owed a second chance, and the only students left
    out are the ones who already passed and the ones who were never in the parent's cohort.
    Everything else (an ordinary midterm, a pre-midterm, a retake with no parent recorded)
    is the unchanged whole-class assignment.
    """
    from midterms.access import retake_eligible_students

    if midterm.midterm_type != Midterm.TYPE_RETAKE or not midterm.retake_of_id:
        return (
            ClassroomAccessService.assign_resource_to_classroom(
                classroom, RT_MIDTERM_V2, midterm.id, actor=actor, note="teacher midterm assignment (v2)",
            ),
            None,
        )

    from midterms.models import MidtermOutcome

    roster = set(_classroom_student_ids(classroom))
    eligible = roster & set(retake_eligible_students(midterm).values_list("pk", flat=True))
    # The two reasons a roster member is skipped read very differently to a teacher: one
    # cleared the parent, the other was never in the parent's cohort (joined the class after
    # it, so there is nothing to retake). Being ABSENT is no longer a reason to be skipped.
    passed = roster & set(
        MidtermOutcome.objects.filter(midterm_id=midterm.retake_of_id, passed=True).values_list(
            "student_id", flat=True
        )
    )
    result = AssignmentService.bulk_assign_resource(
        list(User.objects.filter(pk__in=eligible)),
        RT_MIDTERM_V2,
        midterm.id,
        actor=actor,
        source=ResourceAccessGrant.SOURCE_CLASSROOM,
        classroom=classroom,
        note="teacher retake assignment (v2, failers only)",
    )
    result["classroom_id"] = classroom.pk
    result["resource_type"] = RT_MIDTERM_V2
    result["resource_id"] = midterm.id
    summary = {
        "granted": len(eligible),
        "skipped_passed": len(passed),
        # Was "skipped_no_result", which conflated two very different students. Absentees now
        # get the retake, so the only ones left here are students who were never given the
        # parent at all — a newcomer to the class.
        "skipped_not_in_cohort": len(roster) - len(eligible) - len(passed),
    }
    return result, summary


def _retake_detail(summary: dict) -> str:
    """Plain-English assignment outcome for the teacher's toast."""
    parts = [f"Retake granted to {summary['granted']} student(s), including anyone who was absent."]
    if summary["skipped_passed"]:
        parts.append(f"{summary['skipped_passed']} skipped — already passed the original midterm.")
    if summary["skipped_not_in_cohort"]:
        parts.append(
            f"{summary['skipped_not_in_cohort']} skipped — never assigned the original midterm."
        )
    return " ".join(parts)


class AssignMidtermV2View(_ClassroomScopedView):
    """Assign a published midterm to every enrolled student (whole-class flavor).

    Exception: a retake goes only to the students who failed its parent — see
    ``_grant_to_classroom``.
    """

    def post(self, request, classroom_pk):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response({"detail": "Only the teaching team can assign midterms."}, status=http.HTTP_403_FORBIDDEN)

        try:
            midterm_id = int(request.data.get("midterm_id") or request.data.get("mock_exam_id"))
        except (TypeError, ValueError):
            return Response({"detail": "midterm_id is required."}, status=http.HTTP_400_BAD_REQUEST)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)
        if not midterm.is_published:
            return Response({"detail": "Publish the midterm before assigning it."}, status=http.HTTP_400_BAD_REQUEST)

        expected = _CLASSROOM_TO_MIDTERM_SUBJECT.get(classroom.subject)
        if expected and midterm.subject != expected:
            return Response(
                {"detail": f"This midterm's subject does not match the classroom subject ({classroom.get_subject_display()})."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        starts_at = _parse_schedule_dt(request.data.get("starts_at"))
        deadline = _parse_schedule_dt(request.data.get("deadline"))
        if "INVALID" in (starts_at, deadline):
            return Response({"detail": "Invalid schedule datetime."}, status=http.HTTP_400_BAD_REQUEST)
        if starts_at is not None and deadline is not None and deadline <= starts_at:
            return Response({"detail": "Deadline must be after the start time."}, status=http.HTTP_400_BAD_REQUEST)

        # Mandatory window — but only when there is not one already: re-assigning to pick up
        # a late student sends no schedule fields and must keep the teacher's chosen window.
        existing = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
        if starts_at is None and (existing is None or existing.starts_at is None):
            return missing_starts_at_response()

        # The SCHEDULE owns the access window; do NOT set grant.expires_at=deadline (that would
        # strip access from a student mid-attempt at the deadline).
        result, retake_summary = _grant_to_classroom(classroom, midterm, request.user)
        schedule, created = MidtermSchedule.objects.get_or_create(
            classroom=classroom, midterm=midterm,
            defaults={"starts_at": starts_at, "deadline": deadline, "created_by": request.user},
        )
        if not created:
            update_fields = []
            if starts_at is not None:
                schedule.starts_at = starts_at
                update_fields.append("starts_at")
            if deadline is not None:
                schedule.deadline = deadline
                update_fields.append("deadline")
            if update_fields:
                schedule.save(update_fields=[*update_fields, "updated_at"])
        notify_class_midterm_scheduled(schedule)
        detail = "Midterm assigned to classroom."
        if retake_summary is not None:
            detail = _retake_detail(retake_summary)
            result["retake"] = retake_summary
        return Response({"detail": detail, **result}, status=http.HTTP_200_OK)


class MidtermV2PanelView(_ClassroomScopedView):
    """Roster + schedule + stats for one classroom midterm; PATCH edits the schedule window."""

    def _load(self, midterm_id):
        return Midterm.objects.filter(pk=midterm_id).first()

    def get(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        midterm = self._load(midterm_id)
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        cohort = _classroom_cohort_ids(midterm, classroom)
        latest = _latest_completed_attempts(midterm, cohort)
        ranks, _ = _competition_ranks([(sid, att.score) for sid, att in latest.items()])
        users = {u.id: u for u in User.objects.filter(pk__in=cohort)}
        codes = {
            c.student_id: c.code
            for c in MidtermCertificate.objects.filter(
                classroom=classroom, midterm=midterm, flavor=MidtermCertificate.FLAVOR_CLASSROOM
            )
        }

        assignment_rows = _assignment_rows(midterm, classroom)
        assign_map = {a.student_id: a.version for a in assignment_rows}
        seat_map = {a.student_id: (a.seat_row, a.seat_col) for a in assignment_rows if a.seat_row is not None}
        seat_columns = columns_from_seat_cols(col for _row, col in seat_map.values())
        # Who currently holds an unspent re-sit (a student who failed and repeated the month may
        # sit this same paper again), and how many times each has finished it — the two signals
        # the "Allow re-sit" control in the panel needs. See MidtermResit.
        resit_open_ids = set(
            MidtermResit.objects.filter(
                midterm=midterm, student_id__in=cohort, consumed_at__isnull=True
            ).values_list("student_id", flat=True)
        )
        sittings = {}
        for sid in MidtermAttempt.objects.filter(
            midterm=midterm, student_id__in=cohort, is_completed=True
        ).values_list("student_id", flat=True):
            sittings[sid] = sittings.get(sid, 0) + 1
        students = []
        scores = []
        for sid in cohort:
            att = latest.get(sid)
            score = att.score if att else None
            if score is not None:
                scores.append(score)
            ver = assign_map.get(sid)
            seat = seat_map.get(sid)
            students.append({
                "student_id": sid,
                "student_name": _display_name(users.get(sid)),
                "student_profile_image_url": profile_image_url(users.get(sid), request),
                "state": att.current_state if att else "NOT_STARTED",
                "submitted": bool(att),
                "score": score,
                "rank": ranks.get(sid),
                "certificate_code": codes.get(sid),
                # How many times they have finished it, and whether they may sit it once more.
                "sittings": sittings.get(sid, 0),
                "resit_open": sid in resit_open_ids,
                "version_number": ver.version_number if ver else None,
                "version_label": (ver.label or f"Version {ver.version_number}") if ver else None,
                "seat_row": seat[0] if seat else None,
                "seat_col": seat[1] if seat else None,
                "side": seat[1] % SEATS_PER_DESK if seat else None,
                "desk_number": (seat[0] * seat_columns + seat[1] // SEATS_PER_DESK + 1) if seat else None,
            })
        students.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["student_name"]))

        sched = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
        # Not "everyone has a completed attempt": a student holding an unspent re-sit, or
        # part-way through one, is still to sit it. Publishing over them would freeze their
        # rank and certificate from the paper they are about to replace — and this flag is
        # what invites the teacher to press publish.
        from midterms.certificate_service import students_still_to_sit

        all_finished = bool(cohort) and not students_still_to_sit(midterm, cohort)
        versions = list(MidtermVersion.objects.filter(midterm=midterm))
        stats = {
            "assigned": len(cohort),
            "completed": len(latest),
            "average": round(sum(scores) / len(scores)) if scores else None,
            "highest": max(scores) if scores else None,
            "lowest": min(scores) if scores else None,
        }
        return Response({
            "midterm": _midterm_brief(midterm),
            "schedule": _serialize_schedule(sched),
            "students": students,
            "stats": stats,
            "all_finished": all_finished,
            "certificates_issued": bool(codes),
            "has_versions": bool(versions),
            "versions": [_version_brief(v) for v in versions],
        })

    def patch(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        midterm = self._load(midterm_id)
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        data = request.data or {}
        # Validate BEFORE touching the row: creating it first and then rejecting the payload
        # leaves behind exactly the thing this endpoint must never produce — a schedule with
        # no start time, i.e. a midterm open to the class immediately.
        starts_at = deadline = None
        if "starts_at" in data:
            starts_at = _parse_schedule_dt(data.get("starts_at"))
            if starts_at == "INVALID":
                return Response({"detail": "Invalid starts_at."}, status=http.HTTP_400_BAD_REQUEST)
            # A blank start is not an edit, it is the bypass: it reopens the exam to everyone.
            if starts_at is None:
                return missing_starts_at_response()
        if "deadline" in data:
            deadline = _parse_schedule_dt(data.get("deadline"))
            if deadline == "INVALID":
                return Response({"detail": "Invalid deadline."}, status=http.HTTP_400_BAD_REQUEST)

        sched = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
        effective_start = starts_at or (sched.starts_at if sched else None)
        if effective_start is None:
            return missing_starts_at_response()
        effective_deadline = deadline if "deadline" in data else (sched.deadline if sched else None)
        if effective_deadline is not None and effective_deadline <= effective_start:
            return Response({"detail": "Deadline must be after the start time."}, status=http.HTTP_400_BAD_REQUEST)

        if sched is None:
            sched = MidtermSchedule(classroom=classroom, midterm=midterm, created_by=request.user)
        sched.starts_at = effective_start
        sched.deadline = effective_deadline
        if "ignore_start" in data:
            sched.ignore_start = bool(data.get("ignore_start"))
        sched.save()
        notify_class_midterm_scheduled(sched)
        return Response({"schedule": _serialize_schedule(sched)})


class MidtermV2StartCodeView(_ClassroomScopedView):
    """POST /classes/<pk>/midterms-v2/<midterm_id>/start-code/ — generate/rotate the
    6-digit access code students must enter to begin ("Start midterm").

    Accepts an optional ``starts_at``: the panel's start dialog sets the window and takes
    the code in one request, so a teacher can never end up with a code on a schedule that
    has no start time (which would open the exam to the class immediately).
    """

    def post(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response({"detail": "Only the teaching team can start a midterm."}, status=http.HTTP_403_FORBIDDEN)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        starts_at = _parse_schedule_dt((request.data or {}).get("starts_at"))
        if starts_at == "INVALID":
            return Response({"detail": "Invalid starts_at."}, status=http.HTTP_400_BAD_REQUEST)
        sched = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
        if starts_at is None and (sched is None or sched.starts_at is None):
            return missing_starts_at_response()

        if sched is None:
            sched = MidtermSchedule(classroom=classroom, midterm=midterm, created_by=request.user)
        if starts_at is not None:
            sched.starts_at = starts_at
        if sched.deadline is not None and sched.deadline <= sched.starts_at:
            return Response({"detail": "Deadline must be after the start time."}, status=http.HTTP_400_BAD_REQUEST)
        code = sched.generate_access_code()
        sched.save()
        notify_class_midterm_scheduled(sched)
        return Response({"access_code": code, "schedule": _serialize_schedule(sched)})


class AssignVersionsView(_ClassroomScopedView):
    """Seating + version assignment for a versioned midterm.

    The system decides who sits where AND which paper each chair gets, so that no student
    can read a useful answer off a desk partner, an across-the-aisle neighbour, or the row
    in front or behind (see ``midterms.seating``).

    GET  → versions, per-student assignments, and the saved seating grid.
    POST {action:"preview", columns} → a fresh shuffle of the cohort into the grid, NOT
         saved, so the teacher can re-shuffle before committing.
    POST {action:"commit", columns, seats:[{student_id, version_id, row, col}]} → persist.
         Still accepts the older {assignments:{student_id: version_id}} shape, which writes
         versions with no seats.

    Students never see any of this; the version is applied silently on their next start.
    """

    def _cohort_and_versions(self, classroom, midterm):
        """The cohort in a STABLE order, and the versions a student can actually be given.

        The cohort helper returns an unordered set, whose iteration order drifts as it
        grows — sorting it puts a deterministic base under the explicit shuffle, so
        "Re-shuffle" is the only thing that moves people.

        Empty versions are filtered out: "Add version" in the builder makes a blank form,
        and seating somebody on a paper with no questions is worse than not seating them.
        """
        cohort_ids = _classroom_cohort_ids(midterm, classroom)
        users = {u.id: u for u in User.objects.filter(pk__in=cohort_ids)}
        cohort = sorted(cohort_ids, key=lambda sid: (_display_name(users.get(sid)).casefold(), sid))
        versions = [
            v
            for v in MidtermVersion.objects.filter(midterm=midterm).order_by("version_number")
            if v.total_question_count() > 0
        ]
        return cohort, versions

    def _started_ids(self, midterm, classroom, cohort) -> set:
        """Students who already have an attempt — their version is no longer ours to change."""
        return set(
            MidtermAttempt.objects.filter(midterm=midterm, student_id__in=cohort).values_list(
                "student_id", flat=True
            )
        )

    # ── serialisation ────────────────────────────────────────────────────────

    def _rows(self, mapping, *, seats=None, started=(), columns=DEFAULT_COLUMNS):
        """The flat per-student list. Keys are additive over the pre-seating shape."""
        users = {u.id: u for u in User.objects.filter(pk__in=mapping.keys())}
        seats = seats or {}
        out = []
        for sid, ver in mapping.items():
            seat = seats.get(sid)
            row, col = (seat if seat else (None, None))
            out.append({
                "student_id": sid,
                "student_name": _display_name(users.get(sid)),
                "student_profile_image_url": profile_image_url(users.get(sid), getattr(self, "request", None)),
                "version_id": ver.id,
                "version_number": ver.version_number,
                "version_label": ver.label or f"Version {ver.version_number}",
                "seat_row": row,
                "seat_col": col,
                "side": None if col is None else col % SEATS_PER_DESK,
                "desk_number": None if row is None else row * columns + col // SEATS_PER_DESK + 1,
                "locked": sid in started,
            })
        out.sort(key=lambda r: r["student_name"])
        return out

    def _grid(self, *, placed, versions, columns, warnings, started, student_count):
        """Render ``{(row, col): (student_id, version)}`` as the desk grid the teacher sees.

        Built from whatever is placed rather than from the generator, so a grid read back
        from the database and a grid just previewed serialise identically.
        """
        if not placed:
            return None
        users = {u.id: u for u in User.objects.filter(pk__in=[sid for sid, _ in placed.values()])}
        rows = max(r for r, _ in placed) + 1
        width = _grid_width(placed, columns)
        desks = []
        # EVERY position in the grid is emitted, so a chair left empty by a student who was
        # removed from the class shows as a hole rather than sliding the rest of the row
        # left. Only fully-empty desks trailing off the end are trimmed.
        for row in range(rows):
            for desk_col in range(width):
                seats = []
                for side in range(SEATS_PER_DESK):
                    col = desk_col * SEATS_PER_DESK + side
                    sid, ver = placed.get((row, col), (None, None))
                    seats.append({
                        "side": side,
                        "seat_col": col,
                        "student_id": sid,
                        "student_name": _display_name(users.get(sid)) if sid else None,
                        "student_profile_image_url": (
                            profile_image_url(users.get(sid), getattr(self, "request", None)) if sid else None
                        ),
                        "version_id": ver.id if ver else None,
                        "version_number": ver.version_number if ver else None,
                        "version_label": (ver.label or f"Version {ver.version_number}") if ver else None,
                        "locked": bool(sid) and sid in started,
                    })
                desks.append({
                    "row": row,
                    "desk_col": desk_col,
                    "desk_number": row * width + desk_col + 1,
                    "seats": seats,
                })
        while len(desks) > 1 and all(s["student_id"] is None for s in desks[-1]["seats"]):
            desks.pop()
        counts: dict[str, int] = {}
        for _sid, ver in placed.values():
            if ver is not None:
                counts[str(ver.id)] = counts.get(str(ver.id), 0) + 1
        return {
            "columns": width,
            "rows": rows,
            "desk_count": len(desks),
            "seat_count": len(desks) * SEATS_PER_DESK,
            "student_count": student_count,
            "version_counts": counts,
            "warnings": list(warnings),
            "any_started": bool(started),
            "desks": desks,
        }

    def _saved_state(self, classroom, midterm, cohort, versions):
        """Everything the GET (and a preview's default width) needs from persisted rows."""
        rows = [a for a in _assignment_rows(midterm, classroom) if a.student_id in set(cohort)]
        mapping = {a.student_id: a.version for a in rows}
        seats = {a.student_id: (a.seat_row, a.seat_col) for a in rows if a.seat_row is not None}
        columns = columns_from_seat_cols(col for _row, col in seats.values())
        placed = {seats[sid]: (sid, mapping[sid]) for sid in seats}
        return mapping, seats, columns, placed

    # ── endpoints ────────────────────────────────────────────────────────────

    def get(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)
        cohort, versions = self._cohort_and_versions(classroom, midterm)
        mapping, seats, columns, placed = self._saved_state(classroom, midterm, cohort, versions)
        started = self._started_ids(midterm, classroom, cohort)
        return Response({
            "has_versions": bool(versions),
            "versions": [_version_brief(v) for v in versions],
            "assignments": self._rows(mapping, seats=seats, started=started, columns=columns),
            "unassigned_count": len([sid for sid in cohort if sid not in mapping]),
            "seating": self._grid(
                placed=placed, versions=versions, columns=columns, warnings=(),
                started=started, student_count=len(placed),
            ),
        })

    def post(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response({"detail": "Only the teaching team can assign versions."}, status=http.HTTP_403_FORBIDDEN)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)
        cohort, versions = self._cohort_and_versions(classroom, midterm)
        if not versions:
            return Response({"detail": "This midterm has no versions."}, status=http.HTTP_400_BAD_REQUEST)
        action = str(request.data.get("action") or "preview")

        if action == "preview":
            return self._preview(request, classroom, midterm, cohort, versions)
        if action == "commit":
            return self._commit(request, classroom, midterm, cohort, versions)
        return Response({"detail": "Unknown action."}, status=http.HTTP_400_BAD_REQUEST)

    def _preview(self, request, classroom, midterm, cohort, versions):
        started = self._started_ids(midterm, classroom, cohort)
        if started:
            # Re-shuffling a room where somebody is already writing would show the teacher a
            # chart that contradicts the paper that student is holding.
            return Response(
                {"detail": "Some students have already started — the seating plan is fixed for this sitting."},
                status=http.HTTP_409_CONFLICT,
            )
        if "columns" in request.data:
            columns = clamp_columns(request.data.get("columns"))
        else:
            columns = self._saved_state(classroom, midterm, cohort, versions)[2]

        plan = build_seating_plan(cohort, len(versions), columns=columns)
        placed, seats, mapping = {}, {}, {}
        for seat in plan.occupied_seats():
            version = versions[seat.version_index]
            placed[(seat.row, seat.seat_col)] = (seat.student_id, version)
            seats[seat.student_id] = (seat.row, seat.seat_col)
            mapping[seat.student_id] = version
        return Response({
            "versions": [_version_brief(v) for v in versions],
            "assignments": self._rows(mapping, seats=seats, started=started, columns=plan.columns),
            "seating": self._grid(
                placed=placed, versions=versions, columns=plan.columns, warnings=plan.warnings,
                started=started, student_count=plan.student_count,
            ),
        })

    def _commit(self, request, classroom, midterm, cohort, versions):
        vmap = {v.id: v for v in versions}
        cohort_set = set(cohort)
        started = self._started_ids(midterm, classroom, cohort)
        raw_seats = request.data.get("seats")

        valid: dict[int, MidtermVersion] = {}
        seats: dict[int, tuple[int, int]] = {}
        taken: set[tuple[int, int]] = set()

        if isinstance(raw_seats, list):
            columns = clamp_columns(request.data.get("columns"))
            for entry in raw_seats:
                if not isinstance(entry, dict):
                    continue
                try:
                    sid, vid = int(entry.get("student_id")), int(entry.get("version_id"))
                    row, col = int(entry.get("row")), int(entry.get("col"))
                except (TypeError, ValueError):
                    continue
                if sid not in cohort_set or vid not in vmap or row < 0 or col < 0:
                    continue
                if (row, col) in taken:
                    # Reject rather than let the partial unique index turn this into a 500.
                    return Response(
                        {"detail": f"Two students were placed in the same seat (row {row + 1}, seat {col + 1})."},
                        status=http.HTTP_400_BAD_REQUEST,
                    )
                taken.add((row, col))
                valid[sid] = vmap[vid]
                seats[sid] = (row, col)
        else:
            # Legacy shape: versions only, no seats.
            columns = DEFAULT_COLUMNS
            for sid_str, vid in (request.data.get("assignments") or {}).items():
                try:
                    sid, vid = int(sid_str), int(vid)
                except (TypeError, ValueError):
                    continue
                if sid in cohort_set and vid in vmap:
                    valid[sid] = vmap[vid]

        if not valid:
            return Response({"detail": "No valid assignments to save."}, status=http.HTTP_400_BAD_REQUEST)

        if seats:
            problems = validate_plan(
                _plan_from_seats(seats, {sid: ver.version_number for sid, ver in valid.items()}, columns),
                len(versions),
            )
            if problems:
                return Response(
                    {"detail": "This seating plan puts the same version next to itself.",
                     "violations": problems},
                    status=http.HTTP_400_BAD_REQUEST,
                )

        # A student who has started is holding a paper; the seat may move, the version may not.
        pinned: dict[int, set] = {}
        for sid, vid in MidtermAttempt.objects.filter(
            midterm=midterm, student_id__in=started, version_id__isnull=False
        ).values_list("student_id", "version_id"):
            pinned.setdefault(sid, set()).add(vid)
        conflicted = [sid for sid, ver in valid.items() if pinned.get(sid, {ver.id}) != {ver.id}]
        if conflicted:
            users = {u.id: u for u in User.objects.filter(pk__in=conflicted)}
            names = ", ".join(sorted(_display_name(users.get(sid)) for sid in conflicted))
            return Response(
                {"detail": f"Already started on a different version: {names}. Their paper cannot be changed."},
                status=http.HTTP_409_CONFLICT,
            )

        with transaction.atomic():
            # Wholesale, not student_id__in: a row left behind for a since-removed student
            # would still hold a seat and collide with the new plan.
            MidtermVersionAssignment.objects.filter(midterm=midterm, classroom=classroom).delete()
            MidtermVersionAssignment.objects.bulk_create([
                MidtermVersionAssignment(
                    midterm=midterm, classroom=classroom, student_id=sid, version=ver,
                    seat_row=seats.get(sid, (None, None))[0],
                    seat_col=seats.get(sid, (None, None))[1],
                    assigned_by=request.user,
                )
                for sid, ver in valid.items()
            ])

        placed = {seats[sid]: (sid, valid[sid]) for sid in seats}
        return Response({
            "detail": f"Seated {len(valid)} student(s)." if seats else f"Assigned {len(valid)} student(s).",
            "versions": [_version_brief(v) for v in versions],
            "assignments": self._rows(valid, seats=seats, started=started, columns=columns),
            "seating": self._grid(
                placed=placed, versions=versions, columns=columns, warnings=(),
                started=started, student_count=len(placed),
            ),
        })


def _grid_width(placed: dict, columns: int) -> int:
    """Desks per row. The stored seats win over a requested width, so a hand-written payload
    cannot make the grid narrower than the seats it contains and shift desk numbers."""
    if not placed:
        return columns
    return max(columns, max(col for _row, col in placed) // SEATS_PER_DESK + 1)


def _plan_from_seats(seats: dict, version_numbers: dict, columns: int) -> SeatingPlan:
    """Wrap a proposed ``{student: (row, col)}`` mapping so ``validate_plan`` can check it.

    Version IDENTITY is what matters to the check, so the version number stands in for the
    index — two seats collide exactly when they hold the same version.
    """
    desks = []
    for sid, (row, col) in seats.items():
        desk_col, side = divmod(col, SEATS_PER_DESK)
        seat = SeatSlot(
            row=row, desk_col=desk_col, side=side, seat_col=col,
            student_id=sid, version_index=version_numbers[sid],
        )
        empty = SeatSlot(
            row=row, desk_col=desk_col, side=1 - side, seat_col=desk_col * SEATS_PER_DESK + (1 - side),
            student_id=None, version_index=-1,
        )
        left, right = (seat, empty) if side == 0 else (empty, seat)
        desks.append(DeskSlot(row=row, desk_col=desk_col, number=len(desks) + 1, left=left, right=right))
    return SeatingPlan(columns=columns, rows=0, desks=tuple(desks), warnings=())


class IssueMidtermV2CertificatesView(_ClassroomScopedView):
    """Publish: compute class ranking, issue certificates, release results."""

    def post(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response({"detail": "Only the teaching team can issue certificates."}, status=http.HTTP_403_FORBIDDEN)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        force = str(request.data.get("force") or request.query_params.get("force") or "").strip().lower() in ("1", "true", "yes")
        result = issue_classroom_certificates(midterm, classroom, request.user, force=force)
        if not result.get("ok"):
            reason = result.get("reason")
            if reason == "not_all_finished":
                return Response(
                    {"detail": "Not all assigned students have finished this midterm yet.", "reason": reason, "remaining": result.get("remaining")},
                    status=http.HTTP_409_CONFLICT,
                )
            if reason == "no_students":
                return Response({"detail": "No assigned students to certify.", "reason": reason}, status=http.HTTP_400_BAD_REQUEST)
            return Response({"detail": "Could not issue certificates.", "reason": reason}, status=http.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "detail": f"Issued {result['issued']} certificate(s).",
                "issued": result["issued"],
                "certificates": [serialize_certificate(c) for c in result["certificates"]],
            },
            status=http.HTTP_200_OK,
        )
