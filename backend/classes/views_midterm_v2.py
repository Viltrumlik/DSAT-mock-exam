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
from midterms.models import Midterm

from .capabilities import classroom_capabilities
from .models_certificates import MidtermCertificate
from .models_schedule import MidtermSchedule
from .views_assign import _CLASSROOM_TO_MIDTERM_SUBJECT, _parse_schedule_dt
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


class AssignMidtermV2View(_ClassroomScopedView):
    """Assign a published midterm to every enrolled student (whole-class flavor)."""

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

        # The SCHEDULE owns the access window; do NOT set grant.expires_at=deadline (that would
        # strip access from a student mid-attempt at the deadline).
        result = ClassroomAccessService.assign_resource_to_classroom(
            classroom, RT_MIDTERM_V2, midterm.id, actor=request.user, note="teacher midterm assignment (v2)",
        )
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
        return Response({"detail": "Midterm assigned to classroom.", **result}, status=http.HTTP_200_OK)


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

        students = []
        scores = []
        for sid in cohort:
            att = latest.get(sid)
            score = att.score if att else None
            if score is not None:
                scores.append(score)
            students.append({
                "student_id": sid,
                "student_name": _display_name(users.get(sid)),
                "state": att.current_state if att else "NOT_STARTED",
                "submitted": bool(att),
                "score": score,
                "rank": ranks.get(sid),
                "certificate_code": codes.get(sid),
            })
        students.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["student_name"]))

        sched = MidtermSchedule.objects.filter(classroom=classroom, midterm=midterm).first()
        all_finished = bool(cohort) and cohort <= set(latest.keys())
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
        })

    def patch(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        midterm = self._load(midterm_id)
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        sched, _ = MidtermSchedule.objects.get_or_create(
            classroom=classroom, midterm=midterm, defaults={"created_by": request.user}
        )
        data = request.data or {}
        if "starts_at" in data:
            v = _parse_schedule_dt(data.get("starts_at"))
            if v == "INVALID":
                return Response({"detail": "Invalid starts_at."}, status=http.HTTP_400_BAD_REQUEST)
            sched.starts_at = v
        if "deadline" in data:
            v = _parse_schedule_dt(data.get("deadline"))
            if v == "INVALID":
                return Response({"detail": "Invalid deadline."}, status=http.HTTP_400_BAD_REQUEST)
            sched.deadline = v
        if "ignore_start" in data:
            sched.ignore_start = bool(data.get("ignore_start"))
        if sched.starts_at and sched.deadline and sched.deadline <= sched.starts_at:
            return Response({"detail": "Deadline must be after the start time."}, status=http.HTTP_400_BAD_REQUEST)
        sched.save()
        return Response({"schedule": _serialize_schedule(sched)})


class MidtermV2StartCodeView(_ClassroomScopedView):
    """POST /classes/<pk>/midterms-v2/<midterm_id>/start-code/ — generate/rotate the
    6-digit access code students must enter to begin ("Start midterm")."""

    def post(self, request, classroom_pk, midterm_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_assignments:
            return Response({"detail": "Only the teaching team can start a midterm."}, status=http.HTTP_403_FORBIDDEN)
        midterm = Midterm.objects.filter(pk=midterm_id).first()
        if midterm is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)
        sched, _ = MidtermSchedule.objects.get_or_create(
            classroom=classroom, midterm=midterm, defaults={"created_by": request.user}
        )
        code = sched.generate_access_code()
        sched.save(update_fields=["access_code", "access_code_set_at", "updated_at"])
        return Response({"access_code": code, "schedule": _serialize_schedule(sched)})


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
