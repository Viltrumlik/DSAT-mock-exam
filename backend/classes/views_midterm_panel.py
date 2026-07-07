"""Per-midterm control panel (teacher) + student midterm list.

Teacher (staff of the classroom):
  GET   /api/classes/<pk>/midterms/<mock_exam_id>/panel/     roster + stats + schedule + cert state
  PATCH /api/classes/<pk>/midterms/<mock_exam_id>/schedule/  set starts_at / deadline / ignore_start

Student (self):
  GET   /api/classes/my-midterms/   each assigned midterm with its schedule + release state

The schedule (``MidtermSchedule``) is the single source of truth for the access window and
results-release gate. Absence of a schedule = legacy behaviour (open, results visible).
"""

from __future__ import annotations

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from exams.models import MockExam, TestAttempt

from .capabilities import classroom_capabilities
from .certificates_service import _rank_by_student, certificate_codes_for
from .models import ClassroomMembership
from .models_certificates import MidtermCertificate
from .models_schedule import MidtermSchedule
from .views_certificates import cert_api_path
from .views_rankings import _ClassroomScopedView, _display_name


def serialize_schedule(schedule: MidtermSchedule | None, now=None) -> dict:
    """Serialize schedule window/release state (None → unscheduled defaults)."""
    now = now or timezone.now()
    if schedule is None:
        return {
            "exists": False, "starts_at": None, "deadline": None, "ignore_start": False,
            "available_at": None, "is_open": True, "is_before_start": False,
            "results_released": False, "results_released_at": None,
        }
    available = schedule.available_at
    return {
        "exists": True,
        "starts_at": schedule.starts_at.isoformat() if schedule.starts_at else None,
        "deadline": schedule.deadline.isoformat() if schedule.deadline else None,
        "ignore_start": schedule.ignore_start,
        "available_at": available.isoformat() if available else None,
        "is_open": schedule.is_open(now),
        "is_before_start": schedule.is_before_start(now),
        "results_released": schedule.results_released,
        "results_released_at": schedule.results_released_at.isoformat() if schedule.results_released_at else None,
    }


def _agg(scores: list[float]) -> dict:
    if not scores:
        return {"average": None, "highest": None, "lowest": None}
    return {"average": round(sum(scores) / len(scores), 1), "highest": max(scores), "lowest": min(scores)}


class MidtermPanelView(_ClassroomScopedView):
    """Teacher per-midterm control panel: roster + stats + schedule + certificate state."""

    def _guard(self, request):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.is_staff:
            return None, Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return classroom, None

    def get(self, request, classroom_pk, mock_exam_id):
        classroom, err = self._guard(request)
        if err:
            return err
        mock = MockExam.objects.filter(pk=mock_exam_id, kind=MockExam.KIND_MIDTERM).first()
        if mock is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        students = list(
            classroom.memberships.filter(
                role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE
            ).select_related("user")
        )
        student_ids = [m.user_id for m in students]
        name_by_id = {m.user_id: _display_name(m.user) for m in students}

        attempts = TestAttempt.objects.filter(mock_exam=mock, student_id__in=student_ids)
        by_student: dict[int, list] = {}
        for a in attempts:
            by_student.setdefault(a.student_id, []).append(a)

        latest_completed = {
            sid: sorted([a for a in atts if a.is_completed], key=lambda x: x.created_at)[-1]
            for sid, atts in by_student.items()
            if any(a.is_completed for a in atts)
        }
        provisional_rank, _ = _rank_by_student(latest_completed)

        codes = certificate_codes_for(classroom, [mock.id])[mock.id]["by_student"]

        rows, completed_scores = [], []
        started = completed = 0
        for sid in student_ids:
            atts = sorted(by_student.get(sid, []), key=lambda x: x.created_at)
            if not atts:
                rows.append({"student_id": sid, "student": name_by_id[sid], "state": "not_started",
                             "score": None, "rank": None, "attempt_date": None, "attempt_count": 0,
                             "certificate_code": codes.get(sid)})
                continue
            started += 1
            done = [a for a in atts if a.is_completed]
            latest = (done or atts)[-1]
            if done:
                completed += 1
                if latest.score is not None:
                    completed_scores.append(float(latest.score))
            ts = latest.completed_at or latest.started_at or latest.created_at
            rows.append({
                "student_id": sid, "student": name_by_id[sid],
                "state": "completed" if done else "in_progress",
                "score": latest.score if done else None,
                "rank": provisional_rank.get(sid) if done else None,
                "attempt_date": ts.isoformat() if ts else None,
                "attempt_count": len(atts),
                "certificate_code": codes.get(sid),
            })

        schedule = MidtermSchedule.objects.filter(classroom=classroom, mock_exam=mock).first()
        return Response({
            "midterm": {
                "mock_exam_id": mock.id, "title": mock.title or f"Midterm #{mock.id}",
                "subject": mock.midterm_subject,
                "scoring_scale": getattr(mock, "midterm_scoring_scale", MockExam.SCALE_100),
            },
            "schedule": serialize_schedule(schedule),
            "summary": {"assigned": len(student_ids), "started": started, "completed": completed,
                        **_agg(completed_scores)},
            "certificates_issued": bool(codes),
            "all_finished": len(student_ids) > 0 and completed == len(student_ids),
            "students": rows,
        })

    def patch(self, request, classroom_pk, mock_exam_id):
        classroom, err = self._guard(request)
        if err:
            return err
        mock = MockExam.objects.filter(pk=mock_exam_id, kind=MockExam.KIND_MIDTERM).first()
        if mock is None:
            return Response({"detail": "Midterm not found."}, status=http.HTTP_404_NOT_FOUND)

        schedule, _ = MidtermSchedule.objects.get_or_create(
            classroom=classroom, mock_exam=mock, defaults={"created_by": request.user}
        )
        data = request.data
        update_fields = []

        def _parse_dt(value):
            if value in (None, ""):
                return None
            dt = parse_datetime(value)
            if dt is None:
                return "INVALID"
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            return dt

        if "starts_at" in data:
            parsed = _parse_dt(data.get("starts_at"))
            if parsed == "INVALID":
                return Response({"detail": "Invalid starts_at."}, status=http.HTTP_400_BAD_REQUEST)
            schedule.starts_at = parsed
            update_fields.append("starts_at")
        if "deadline" in data:
            parsed = _parse_dt(data.get("deadline"))
            if parsed == "INVALID":
                return Response({"detail": "Invalid deadline."}, status=http.HTTP_400_BAD_REQUEST)
            schedule.deadline = parsed
            update_fields.append("deadline")
        if "ignore_start" in data:
            schedule.ignore_start = bool(data.get("ignore_start"))
            update_fields.append("ignore_start")

        if update_fields:
            schedule.save(update_fields=[*update_fields, "updated_at"])
        return Response(serialize_schedule(schedule))


class MyMidtermsView(APIView):
    """Student's assigned midterms with schedule + release state (drives the midterm page)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        classroom_ids = list(
            ClassroomMembership.objects.filter(
                user=user, role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
            ).values_list("classroom_id", flat=True)
        )

        # A student "has" a midterm through ANY of the access signals the platform uses,
        # so visibility never depends on which grant path was taken:
        #   1) the authoritative RESOURCE grant (what the teacher panel + issuance read),
        #   2) the legacy assigned_users M2M on MockExam / PortalMockExam,
        #   3) any attempt they've already made.
        from access.models import ResourceAccessGrant
        from access.resources import RT_MIDTERM
        from exams.models import PortalMockExam

        granted_ids = set(
            ResourceAccessGrant.objects.filter(
                user=user, scope=ResourceAccessGrant.SCOPE_RESOURCE,
                resource_type=RT_MIDTERM, status=ResourceAccessGrant.STATUS_ACTIVE,
            ).values_list("resource_id", flat=True)
        )
        assigned_ids = set(
            MockExam.objects.filter(
                kind=MockExam.KIND_MIDTERM, assigned_users=user
            ).values_list("id", flat=True)
        )
        portal_ids = set(
            PortalMockExam.objects.filter(
                mock_exam__kind=MockExam.KIND_MIDTERM, assigned_users=user
            ).values_list("mock_exam_id", flat=True)
        )
        attempted_ids = set(
            TestAttempt.objects.filter(
                student=user, mock_exam__kind=MockExam.KIND_MIDTERM
            ).values_list("mock_exam_id", flat=True)
        )
        midterm_ids = [mid for mid in (granted_ids | assigned_ids | portal_ids | attempted_ids) if mid]
        if not midterm_ids:
            return Response({"midterms": []})

        # Only real, active midterms.
        mocks = {
            m.id: m
            for m in MockExam.objects.filter(
                id__in=midterm_ids, kind=MockExam.KIND_MIDTERM, is_active=True
            )
        }

        schedules_by_mid: dict[int, list[MidtermSchedule]] = {}
        for s in MidtermSchedule.objects.filter(mock_exam_id__in=midterm_ids, classroom_id__in=classroom_ids):
            schedules_by_mid.setdefault(s.mock_exam_id, []).append(s)

        attempts_by_mid: dict[int, list] = {}
        for a in TestAttempt.objects.filter(student=user, mock_exam_id__in=midterm_ids):
            attempts_by_mid.setdefault(a.mock_exam_id, []).append(a)

        certs = {
            c.mock_exam_id: c
            for c in MidtermCertificate.objects.filter(student=user, mock_exam_id__in=midterm_ids)
        }

        now = timezone.now()
        out = []
        for mid in midterm_ids:
            mock = mocks.get(mid)
            if mock is None:
                continue
            scheds = schedules_by_mid.get(mid, [])
            atts = attempts_by_mid.get(mid, [])
            completed = [a for a in atts if a.is_completed]
            submitted = bool(completed)

            # Resolve the effective window across the student's classrooms for this midterm.
            is_open = any(s.is_open(now) for s in scheds) if scheds else True
            future_starts = [s.available_at for s in scheds if s.available_at and s.available_at > now]
            available_at = min(future_starts) if future_starts else None
            is_before_start = bool(available_at) and not is_open
            results_released = any(s.results_released for s in scheds) if scheds else True

            cert = certs.get(mid)
            score = None
            if submitted and results_released:
                latest = sorted(completed, key=lambda x: x.created_at)[-1]
                score = latest.score

            module_count = getattr(mock, "midterm_module_count", 1) or 1
            duration = (getattr(mock, "midterm_module1_minutes", 0) or 0)
            if module_count >= 2:
                duration += (getattr(mock, "midterm_module2_minutes", 0) or 0)
            question_count = getattr(mock, "midterm_target_question_count", None) or (
                (getattr(mock, "midterm_module_question_limit", 0) or 0) * module_count
            )
            subject_label = "Math" if mock.midterm_subject == "MATH" else "Reading & Writing"

            out.append({
                "mock_exam_id": mid,
                "title": mock.title or f"Midterm #{mid}",
                "subject": mock.midterm_subject,
                "subject_label": subject_label,
                "duration_minutes": duration,
                "question_count": question_count,
                "scoring_scale": getattr(mock, "midterm_scoring_scale", MockExam.SCALE_100),
                "available_at": available_at.isoformat() if available_at else None,
                "is_open": is_open,
                "is_before_start": is_before_start,
                "has_attempt": bool(atts),
                "submitted": submitted,
                "results_visible": bool(results_released),
                "score": score,
                "certificate": {
                    "available": cert is not None,
                    "code": cert.code if cert else None,
                    "download_url": cert_api_path(cert.code) if cert else None,
                    "rank": cert.rank if cert else None,
                    "cohort_size": cert.cohort_size if cert else None,
                },
            })
        return Response({"midterms": out})
