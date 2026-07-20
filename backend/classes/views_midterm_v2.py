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
from midterms.models import Midterm, MidtermVersion, MidtermVersionAssignment

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
    return {
        a.student_id: a.version
        for a in MidtermVersionAssignment.objects.filter(midterm=midterm, classroom=classroom).select_related("version")
    }


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
    passed are never granted it" — so a retake is granted only to the roster members who
    actually failed its parent, never to the whole room. Everything else (an ordinary
    midterm, a pre-midterm, a retake with no parent recorded) is the unchanged whole-class
    assignment.
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
    # cleared the parent, the other never sat it (so there is no verdict to retake).
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
        "skipped_no_result": len(roster) - len(eligible) - len(passed),
    }
    return result, summary


def _retake_detail(summary: dict) -> str:
    """Plain-English assignment outcome for the teacher's toast."""
    parts = [f"Retake granted to {summary['granted']} student(s)."]
    if summary["skipped_passed"]:
        parts.append(f"{summary['skipped_passed']} skipped — already passed the original midterm.")
    if summary["skipped_no_result"]:
        parts.append(f"{summary['skipped_no_result']} skipped — no result on the original midterm.")
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

        assign_map = _assignment_map(midterm, classroom)
        students = []
        scores = []
        for sid in cohort:
            att = latest.get(sid)
            score = att.score if att else None
            if score is not None:
                scores.append(score)
            ver = assign_map.get(sid)
            students.append({
                "student_id": sid,
                "student_name": _display_name(users.get(sid)),
                "state": att.current_state if att else "NOT_STARTED",
                "submitted": bool(att),
                "score": score,
                "rank": ranks.get(sid),
                "certificate_code": codes.get(sid),
                "version_number": ver.version_number if ver else None,
                "version_label": (ver.label or f"Version {ver.version_number}") if ver else None,
            })
        students.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["student_name"]))

        sched = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
        all_finished = bool(cohort) and cohort <= set(latest.keys())
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
    """Random version assignment for a versioned midterm.

    GET  → versions + current per-student assignments.
    POST {action:"preview"}  → a fresh random EVEN distribution of the cohort across the
         versions (NOT saved), so the teacher can re-random before committing.
    POST {action:"commit", assignments:{student_id: version_id}} → persist the mapping.
    Students never see any of this; the version is applied silently on their next start.
    """

    def _cohort_and_versions(self, classroom, midterm):
        cohort = list(_classroom_cohort_ids(midterm, classroom))
        versions = list(MidtermVersion.objects.filter(midterm=midterm).order_by("version_number"))
        return cohort, versions

    def _rows(self, mapping):
        users = {u.id: u for u in User.objects.filter(pk__in=mapping.keys())}
        out = [
            {
                "student_id": sid,
                "student_name": _display_name(users.get(sid)),
                "version_id": ver.id,
                "version_number": ver.version_number,
                "version_label": ver.label or f"Version {ver.version_number}",
            }
            for sid, ver in mapping.items()
        ]
        out.sort(key=lambda r: r["student_name"])
        return out

    def get(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)
        cohort, versions = self._cohort_and_versions(classroom, midterm)
        assign_map = _assignment_map(midterm, classroom)
        mapping = {sid: assign_map[sid] for sid in cohort if sid in assign_map}
        return Response({
            "has_versions": bool(versions),
            "versions": [_version_brief(v) for v in versions],
            "assignments": self._rows(mapping),
            "unassigned_count": len([sid for sid in cohort if sid not in assign_map]),
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
            import secrets

            shuffled = list(cohort)
            for i in range(len(shuffled) - 1, 0, -1):  # Fisher–Yates (secrets = unbiased)
                j = secrets.randbelow(i + 1)
                shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
            mapping = {sid: versions[idx % len(versions)] for idx, sid in enumerate(shuffled)}
            return Response({"assignments": self._rows(mapping), "versions": [_version_brief(v) for v in versions]})

        if action == "commit":
            raw = request.data.get("assignments") or {}
            vmap = {v.id: v for v in versions}
            cohort_set = set(cohort)
            valid = {}
            for sid_str, vid in raw.items():
                try:
                    sid, vid = int(sid_str), int(vid)
                except (TypeError, ValueError):
                    continue
                if sid in cohort_set and vid in vmap:
                    valid[sid] = vmap[vid]
            if not valid:
                return Response({"detail": "No valid assignments to save."}, status=http.HTTP_400_BAD_REQUEST)
            MidtermVersionAssignment.objects.filter(
                midterm=midterm, classroom=classroom, student_id__in=list(valid.keys())
            ).delete()
            MidtermVersionAssignment.objects.bulk_create([
                MidtermVersionAssignment(
                    midterm=midterm, classroom=classroom, student_id=sid, version=ver, assigned_by=request.user
                )
                for sid, ver in valid.items()
            ])
            return Response({"detail": f"Assigned {len(valid)} student(s).", "assignments": self._rows(valid)})

        return Response({"detail": "Unknown action."}, status=http.HTTP_400_BAD_REQUEST)


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
