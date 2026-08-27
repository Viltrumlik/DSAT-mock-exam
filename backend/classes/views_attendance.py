"""Attendance API (inside the classes app — no separate application).

Reads:
  GET  /api/classes/<pk>/attendance/sessions/            staff: list sessions
  GET  /api/classes/<pk>/attendance/sessions/<id>/       staff: roster + marks
  GET  /api/classes/<pk>/attendance/me/                  member: own history + %
  GET  /api/classes/<pk>/attendance/students/<sid>/      staff or self: student detail
  GET  /api/classes/<pk>/attendance/summary/             staff: class rates + trend series
Writes (CanTakeAttendance):
  POST /api/classes/<pk>/attendance/sessions/            upsert session (201 new / 200 existing)
  POST /api/classes/<pk>/attendance/sessions/<id>/mark/  bulk upsert (also single quick-correction)
  POST /api/classes/<pk>/attendance/sessions/<id>/mark-all-present/
  POST /api/classes/<pk>/attendance/sessions/<id>/finalize/   idempotent; echoes already_finalized

A session is unique per (classroom, date) and FINALIZED is a freeze that only an owner/admin
may write through. Both properties exist because finalize is about to become the trigger that
awards attendance points, and a lesson must be payable exactly once.

**Every write is also bounded in time.** A register may be filled in during its lesson and
for two hours after it ends, and not afterwards — see ``attendance_window``, which owns that
rule for all four write endpoints. The roster a register offers is the roster *as it stood on
that lesson's date*, so a student who joined last week is not on last month's lessons.
Together those two are the fix for the 2026-08-26 incident in which a backlog of registers
was swept with "Mark all present" for a student who had joined that morning, paying him for
sixteen lessons he was never enrolled for.
"""

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import attendance as attendance_service
from . import attendance_auto
from . import attendance_window
from .capabilities import classroom_capabilities
from .models import ClassroomMembership
from .models_attendance import AttendanceRecord, AttendanceSession
from .permissions import CanTakeAttendance
from .views_rankings import _ClassroomScopedView, _display_name

_VALID_STATUS = {c for c, _ in AttendanceRecord.STATUS_CHOICES}


def _active_students(classroom, *, on_date=None):
    """The roster, optionally as it stood on ``on_date``.

    **A student cannot attend a lesson held before they joined.** Without the floor, adding a
    student in August put them on every register back to July — and because attendance pays
    the moment a mark is saved, one ``Mark all present`` on the backlog paid them for lessons
    they were not enrolled for. That is exactly how one student reached the top of the school
    leaderboard on 2026-08-26; see ``attendance_window`` for the other half of the fix.

    ``joined_at`` is compared in the school's timezone, because the register's ``date`` is a
    local calendar day: a membership created at 21:30 on the 26th is a member for the 26th,
    and reading its UTC date would say the 27th for half the school year.

    ``on_date=None`` keeps the old meaning — everyone on the roster now — for the callers
    that are not about one particular lesson.
    """
    members = classroom.memberships.filter(
        role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE
    ).select_related("user")
    if on_date is None:
        return members
    # Filtered in Python rather than SQL: the comparison is on the LOCAL date of a
    # DateTimeField, and pushing that into the database makes the answer depend on the
    # backend's timezone support (SQLite has none without pytz tables). A roster is tens of
    # rows, so this costs nothing.
    return [m for m in members if timezone.localdate(m.joined_at) <= on_date]


def _session_brief(s: AttendanceSession, counts: dict | None = None, *,
                   classroom=None, user=None) -> dict:
    """One register, as the API reports it.

    ``marking`` is present whenever the caller passed the classroom, and is what lets the UI
    disable a closed register instead of offering buttons the server will refuse.
    """
    out = {
        "id": s.id, "date": s.date.isoformat(), "title": s.title,
        "lesson_index": s.lesson_index, "status": s.status,
        "counts": counts,
    }
    if classroom is not None:
        out["marking"] = attendance_window.window_payload(classroom, s.date, user=user)
    return out


class AttendanceSessionsView(_ClassroomScopedView):
    """GET list (staff) / POST create (staff)."""

    def get(self, request, classroom_pk):
        classroom = self.get_classroom()
        if not classroom_capabilities(request.user, classroom).can_take_attendance:
            return Response({"detail": "Staff only."}, status=status.HTTP_403_FORBIDDEN)
        # The register for a lesson that has started exists whether or not anyone asked for
        # it. Doing this on read as well as from the cron means a school with no scheduler
        # still gets today's register the moment a teacher opens the page.
        attendance_auto.ensure_sessions(classroom)
        sessions = AttendanceSession.objects.filter(classroom=classroom).order_by("-date", "-id")
        return Response({
            "sessions": [
                _session_brief(s, classroom=classroom, user=request.user) for s in sessions
            ],
            # False means lesson days cannot be worked out from this classroom at all, so
            # nothing will ever materialise. The UI says so and re-opens the manual add
            # rather than showing an empty list that looks like "no lessons yet".
            "schedule_is_usable": attendance_auto.schedule_is_usable(classroom),
        })

    def post(self, request, classroom_pk):
        """Manual creation. The lesson schedule normally does this, so the UI only offers it
        when ``schedule_is_usable`` is False — but the endpoint stays open, because a class
        with a broken schedule must still be able to take a register."""
        classroom = self.get_classroom()
        if not classroom_capabilities(request.user, classroom).can_take_attendance:
            return Response({"detail": "Staff only."}, status=status.HTTP_403_FORBIDDEN)
        parsed_date = parse_date(request.data.get("date") or "")
        if parsed_date is None:
            return Response({"detail": "A valid date is required (YYYY-MM-DD)."}, status=400)
        # The escape hatch is for a class whose schedule cannot be read — not for reopening
        # last month. Without this check the lock on the mark endpoints is decorative: a
        # teacher would simply create the old day here and mark it. An existing session is
        # let through, because this call is an upsert and returning the row the teacher
        # already has is not a write.
        refusal = attendance_window.refusal(classroom, parsed_date)
        if refusal and not AttendanceSession.objects.filter(
            classroom=classroom, date=parsed_date
        ).exists():
            return Response({"detail": refusal}, status=status.HTTP_403_FORBIDDEN)
        # Upsert, not create: one lesson gets one session (uniq_attendance_session_per_day).
        # A teacher who adds the same date twice must land back on the session they already
        # marked, not create a second one that would finalize — and pay out — separately.
        s, created = AttendanceSession.objects.get_or_create(
            classroom=classroom, date=parsed_date,
            defaults={
                "lesson_index": request.data.get("lesson_index") or None,
                "created_by": request.user,
            },
        )
        return Response(
            _session_brief(s, classroom=classroom, user=request.user),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class AttendanceSessionDetailView(_ClassroomScopedView):
    permission_classes = [IsAuthenticated, CanTakeAttendance]

    def _get_session(self, classroom):
        return get_object_or_404(AttendanceSession, pk=self.kwargs["session_id"], classroom=classroom)

    def get(self, request, classroom_pk, session_id):
        classroom = self.get_classroom()
        session = self._get_session(classroom)
        records = {r.student_id: r for r in session.records.all()}
        roster = []
        # The roster as it stood on the lesson's own date, so a student added last week is
        # not offered for a lesson held the week before they arrived.
        for m in _active_students(classroom, on_date=session.date):
            r = records.get(m.user_id)
            roster.append({
                "student_id": m.user_id,
                "name": _display_name(m.user),
                "status": r.status if r else None,
                "note": r.note if r else "",
            })
        return Response({
            **_session_brief(session, classroom=classroom, user=request.user),
            "roster": roster,
        })


def _window_refusal(request, classroom, session):
    """403 body when the marking window forbids this write, else ``None``.

    Both write endpoints call this, and neither may answer the question itself — the whole
    point of ``attendance_window`` is that "may this register be written" has one answer.
    """
    if attendance_window.can_mark(classroom, session.date, user=request.user):
        return None
    return Response(
        {"detail": attendance_window.refusal(classroom, session.date)},
        status=status.HTTP_403_FORBIDDEN,
    )


class AttendanceMarkView(_ClassroomScopedView):
    """Bulk upsert of records (also serves single quick-corrections)."""

    permission_classes = [IsAuthenticated, CanTakeAttendance]

    @transaction.atomic
    def post(self, request, classroom_pk, session_id):
        classroom = self.get_classroom()
        session = get_object_or_404(AttendanceSession, pk=session_id, classroom=classroom)
        if session.status == AttendanceSession.STATUS_FINALIZED and not classroom_capabilities(
            request.user, classroom
        ).is_owner:
            return Response({"detail": "Session is finalized; only an owner/admin can edit."}, status=403)
        refused = _window_refusal(request, classroom, session)
        if refused is not None:
            return refused

        entries = request.data.get("records") or []
        # Scoped to the lesson's own date: a client that keeps a stale roster, or one that
        # simply posts every student id it knows, must not be able to mark somebody for a
        # lesson held before they joined. The view is the security boundary, not the UI.
        allowed = {m.user_id for m in _active_students(classroom, on_date=session.date)}
        updated = 0
        for e in entries:
            sid = e.get("student_id")
            st = e.get("status")
            if sid not in allowed or st not in _VALID_STATUS:
                continue
            AttendanceRecord.objects.update_or_create(
                session=session, student_id=sid,
                defaults={"status": st, "note": (e.get("note") or "").strip(), "marked_by": request.user},
            )
            updated += 1
        return Response({"status": "marked", "updated": updated})


class AttendanceMarkAllPresentView(_ClassroomScopedView):
    permission_classes = [IsAuthenticated, CanTakeAttendance]

    @transaction.atomic
    def post(self, request, classroom_pk, session_id):
        classroom = self.get_classroom()
        session = get_object_or_404(AttendanceSession, pk=session_id, classroom=classroom)
        # Same freeze as AttendanceMarkView. Without it this endpoint could silently rewrite
        # a finalized — and, once rewards land, already paid-out — session.
        if session.status == AttendanceSession.STATUS_FINALIZED and not classroom_capabilities(
            request.user, classroom
        ).is_owner:
            return Response({"detail": "Session is finalized; only an owner/admin can edit."}, status=403)
        # This is the button that caused the incident this window exists to prevent: one
        # press writes PRESENT for a whole roster, with no confirmation, and every row pays
        # immediately. It is the last endpoint that should be exempt from the lock.
        refused = _window_refusal(request, classroom, session)
        if refused is not None:
            return refused
        existing = {r.student_id: r.status for r in session.records.all()}
        updated = 0
        for m in _active_students(classroom, on_date=session.date):
            # Preserve an existing EXCUSED mark; set everyone else to PRESENT.
            if existing.get(m.user_id) == AttendanceRecord.STATUS_EXCUSED:
                continue
            AttendanceRecord.objects.update_or_create(
                session=session, student_id=m.user_id,
                defaults={"status": AttendanceRecord.STATUS_PRESENT, "marked_by": request.user},
            )
            updated += 1
        return Response({"status": "all_present", "updated": updated})


class AttendanceFinalizeView(_ClassroomScopedView):
    """Freeze a session. This is the terminal, once-per-lesson transition, and the moment
    the reward system will treat attendance as authoritative — so it has to be exactly
    once. Previously it re-saved unconditionally on every call."""

    permission_classes = [IsAuthenticated, CanTakeAttendance]

    def post(self, request, classroom_pk, session_id):
        classroom = self.get_classroom()
        with transaction.atomic():
            # Locked so two concurrent finalize clicks serialise; the second observes
            # FINALIZED and becomes a no-op instead of re-running the transition.
            session = get_object_or_404(
                AttendanceSession.objects.select_for_update(),
                pk=session_id,
                classroom=classroom,
            )
            already = session.status == AttendanceSession.STATUS_FINALIZED
            if not already:
                session.status = AttendanceSession.STATUS_FINALIZED
                session.save(update_fields=["status", "updated_at"])
        return Response({
            **_session_brief(session, classroom=classroom, user=request.user),
            "already_finalized": already,
        })


class AttendanceSummaryView(_ClassroomScopedView):
    def get(self, request, classroom_pk):
        classroom = self.get_classroom()
        if not classroom_capabilities(request.user, classroom).can_take_attendance:
            return Response({"detail": "Staff only."}, status=status.HTTP_403_FORBIDDEN)
        return Response(attendance_service.class_summary(classroom))


class AttendanceMeView(_ClassroomScopedView):
    def get(self, request, classroom_pk):
        classroom = self.get_classroom()  # IsClassMemberCap enforces membership
        return Response(attendance_service.student_detail(classroom, request.user))


class AttendanceStudentView(_ClassroomScopedView):
    def get(self, request, classroom_pk, student_id):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_take_attendance and request.user.id != int(student_id):
            return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
        student = get_object_or_404(
            ClassroomMembership, classroom=classroom, user_id=student_id
        ).user
        return Response(attendance_service.student_detail(classroom, student))
