"""Teacher-facing lesson plan for one classroom (the Journals "teacher panel").

Mounted under ``/api/classes/`` deliberately, not under ``/api/journals/``. Two
independent gates make the journals namespace unusable here: ``access.host_guard``
allowlists ``/api/journals/`` for the **admin** subdomain only, so a teacher-portal call
would 403 before DRF ran; and ``CanManageJournals`` is global-staff-only, with teachers
explicitly excluded. ``/api/classes/`` is already allowlisted for the teacher subdomain,
so these routes need no host-guard change.

Authoring stays admin-only. What a teacher gets here is delivery: see the plan, hand out
a session's homework, and open individual items to the class during the lesson.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.response import Response

from journals import delivery
from journals.models import ClassroomLessonGrant, JournalLesson

from .capabilities import classroom_capabilities
from .views_rankings import _ClassroomScopedView

logger = logging.getLogger(__name__)


def _flag(request, name: str) -> bool:
    """Read a boolean confirm flag from the body (multipart sends it as a string)."""
    return str(request.data.get(name, "")).strip().lower() in ("1", "true", "yes", "on")


def _grant_payload(grant: ClassroomLessonGrant) -> dict:
    return {
        "id": grant.id,
        "block": grant.block,
        "resource_type": grant.resource_type,
        "resource_id": grant.resource_id,
        "granted_at": grant.granted_at,
    }


def _assessment_payload(link) -> dict:
    aset = link.assessment_set
    return {
        "resource_type": "assessment_set",
        "resource_id": aset.id,
        "title": aset.title,
        "question_count": getattr(aset, "question_count", None),
    }


def _lesson_row(entry, *, detail: bool = False) -> dict:
    """Serialize one plan entry. ``detail`` adds the homework brief + classwork blocks."""
    session: JournalLesson = entry["session"]
    row = entry["delivery"]
    granted = {(g.resource_type, g.resource_id) for g in entry["grants"]}

    data = {
        "lesson_id": session.id,
        "lesson_number": session.lesson_number,
        "lesson_type": session.lesson_type,
        "title": session.title,
        "scheduled_for": entry["scheduled_for"],
        "is_ready": session.is_ready,
        "homework_ready": session.homework_ready,
        "classwork_ready": session.classwork_ready,
        # Delivery state
        "homework_released": bool(row and row.homework_released_at),
        "homework_released_at": row.homework_released_at if row else None,
        "assignment_id": row.assignment_id if row else None,
        "grants": [_grant_payload(g) for g in entry["grants"]],
    }

    if session.is_midterm:
        exam = session.midterm_exam
        schedule = row.midterm_schedule if row else None
        data["midterm"] = (
            {
                "exam_id": exam.id,
                "title": exam.title,
                "access_days_before": session.midterm_access_days_before,
                "granted": schedule is not None,
                # Access alone does not let students in — the teacher must also generate
                # the start code, which is what this flag drives in the UI.
                "has_start_code": bool(schedule and schedule.access_code),
                # Return the code itself: it lived only in component state, so a teacher
                # who navigated away could not read it out to the class any more. Staff-
                # only endpoint, and the same panel endpoint already returns it.
                "start_code": (schedule.access_code or "") if schedule else "",
                "starts_at": schedule.starts_at if schedule else None,
            }
            if exam
            else None
        )

    if not detail:
        return data

    data["homework"] = {
        "instructions": session.instructions,
        "external_url": session.external_url,
        "allow_file_upload": session.allow_file_upload,
        "practice_test_ids": session.practice_test_ids or [],
        "practice_test_pack_ids": session.practice_test_pack_ids or [],
        "assessments": [_assessment_payload(l) for l in session.assessments.all()],
        "validation": session.homework_validation_reasons(),
    }

    cw = getattr(session, "classwork", None)
    if cw is not None:
        def _items(block_assessments, practice_ids, pack_ids, block):
            items = []
            for link in block_assessments:
                item = _assessment_payload(link)
                item["block"] = block
                item["given"] = ("assessment_set", link.assessment_set_id) in granted
                items.append(item)
            for pid in practice_ids or []:
                items.append(
                    {
                        "resource_type": "practice_test",
                        "resource_id": pid,
                        "block": block,
                        "given": ("practice_test", pid) in granted,
                    }
                )
            for pid in pack_ids or []:
                items.append(
                    {
                        "resource_type": "practice_test_pack",
                        "resource_id": pid,
                        "block": block,
                        "given": ("practice_test_pack", pid) in granted,
                    }
                )
            return items

        by_block = {"NEW_TOPIC": [], "EXERCISES": []}
        for link in cw.assessments.all():
            by_block.setdefault(link.block, []).append(link)

        data["classwork"] = {
            # timetable() is a method, total_minutes is a property — not symmetric.
            "timetable": cw.timetable(),
            "total_minutes": cw.total_minutes,
            "new_topic": {
                "title": cw.new_topic_title,
                "instructions": cw.new_topic_instructions,
                "external_url": cw.new_topic_external_url,
                "minutes": cw.new_topic_minutes,
                "items": _items(
                    by_block.get("NEW_TOPIC", []),
                    cw.new_topic_practice_test_ids,
                    cw.new_topic_practice_test_pack_ids,
                    "NEW_TOPIC",
                ),
            },
            "exercises": {
                "minutes": cw.exercises_minutes,
                "items": _items(
                    by_block.get("EXERCISES", []),
                    cw.exercise_practice_test_ids,
                    cw.exercise_practice_test_pack_ids,
                    "EXERCISES",
                ),
            },
            "homework_review_minutes": cw.homework_review_minutes,
            "break_minutes": cw.break_minutes,
            "revision": {"minutes": cw.revision_minutes, "notes": cw.revision_notes},
            "validation": session.classwork_validation_reasons(),
        }
    return data


class Http404Lesson(Exception):
    """This classroom has no journal to deliver (no level, or none published)."""


class _LessonScopedView(_ClassroomScopedView):
    """Classroom-scoped view with capability helpers.

    ``IsClassMemberCap`` (inherited) is what confines a teacher to their own classrooms —
    a non-member gets 403 before any handler runs.
    """

    def caps(self, request):
        return classroom_capabilities(request.user, self.get_classroom())

    def deny_unless_staff(self, request):
        if not self.caps(request).is_staff:
            return Response(
                {"detail": "Only the teaching team can view the lesson plan."},
                status=http.HTTP_403_FORBIDDEN,
            )
        return None

    def deny_unless_can_manage(self, request):
        if not self.caps(request).can_manage_assignments:
            return Response(
                {"detail": "Only the teaching team can hand out lessons."},
                status=http.HTTP_403_FORBIDDEN,
            )
        return None

    def session(self, lesson_id: int) -> JournalLesson:
        """The template session, confirmed to belong to THIS classroom's journal.

        Scoping through the binding is what stops a teacher reaching another course's
        session by guessing an id.

        Binds on demand: a teacher may hand out a lesson without having loaded the plan
        first (or at all), so this must not depend on a GET having happened.
        """
        binding = delivery.get_binding(
            self.get_classroom(), actor=self.request.user, create=True
        )
        if binding is None:
            raise Http404Lesson()
        return get_object_or_404(JournalLesson, pk=lesson_id, journal_id=binding.journal_id)


class ClassroomLessonsView(_LessonScopedView):
    """GET the classroom's whole lesson plan."""

    def get(self, request, classroom_pk):
        denied = self.deny_unless_staff(request)
        if denied:
            return denied
        classroom = self.get_classroom()
        plan = delivery.lesson_plan(classroom, actor=request.user)
        if not plan["bound"]:
            return Response(
                {
                    "bound": False,
                    "reason": plan["reason"],
                    "journal": None,
                    "lessons": [],
                }
            )
        journal = plan["journal"]
        binding = plan["binding"]
        return Response(
            {
                "bound": True,
                "reason": "",
                "journal": {
                    "id": journal.id,
                    "title": journal.display_title,
                    "subject": journal.subject,
                    "level": journal.level,
                },
                "starts_on": binding.starts_on,
                "lessons": [_lesson_row(e) for e in plan["lessons"]],
            }
        )


class ClassroomLessonDetailView(_LessonScopedView):
    """GET one lesson: the homework brief and the classwork plan with per-item state."""

    def get(self, request, classroom_pk, lesson_id):
        denied = self.deny_unless_staff(request)
        if denied:
            return denied
        classroom = self.get_classroom()
        plan = delivery.lesson_plan(classroom, actor=request.user)
        if not plan["bound"]:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)
        for entry in plan["lessons"]:
            if entry["session"].id == int(lesson_id):
                return Response(_lesson_row(entry, detail=True))
        return Response({"detail": "Lesson not found."}, status=http.HTTP_404_NOT_FOUND)


class ClassroomLessonReleaseView(_LessonScopedView):
    """POST — hand out this session's homework to the class."""

    def post(self, request, classroom_pk, lesson_id):
        denied = self.deny_unless_can_manage(request)
        if denied:
            return denied
        try:
            session = self.session(lesson_id)
        except Http404Lesson:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)
        try:
            row, created, warnings = delivery.release_homework(
                self.get_classroom(), session, actor=request.user,
                allow_unapproved=_flag(request, "allow_unapproved"),
            )
        except delivery.DeliveryError as e:
            return Response({"detail": e.message, "code": e.code}, status=http.HTTP_400_BAD_REQUEST)
        except DjangoValidationError as e:
            # The access engine validates deep in the stack; letting that escape was a 500
            # whose message also confirmed whether an id existed.
            logger.warning("lesson action rejected: %s", e)
            return Response(
                {"detail": "That item could not be given to the class.", "code": "rejected"},
                status=http.HTTP_400_BAD_REQUEST,
            )

        detail = "Homework given to the class." if created else "Already given."
        if warnings:
            # Say so plainly: a set already given to this class stays on the earlier
            # homework, so this one goes out without it.
            detail = f"Homework given, but not everything attached: {'; '.join(warnings)}."
        return Response(
            {
                "detail": detail,
                "created": created,
                "warnings": warnings,
                "assignment_id": row.assignment_id,
                "released_at": row.homework_released_at,
            },
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )


class ClassroomLessonGrantView(_LessonScopedView):
    """POST — open one item of the lesson plan to the class right now."""

    def post(self, request, classroom_pk, lesson_id):
        denied = self.deny_unless_can_manage(request)
        if denied:
            return denied
        try:
            session = self.session(lesson_id)
        except Http404Lesson:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)

        classroom = self.get_classroom()
        # A midterm session grants the exam itself, not an individual item.
        if session.is_midterm:
            try:
                row, created = delivery.grant_midterm(classroom, session, actor=request.user)
            except delivery.DeliveryError as e:
                return Response({"detail": e.message, "code": e.code}, status=http.HTTP_400_BAD_REQUEST)
            return Response(
                {
                    "detail": "Class can now access the midterm."
                    if created
                    else "Already granted.",
                    "created": created,
                    "midterm_schedule_id": row.midterm_schedule_id,
                    # The teacher still has to start it — surfacing this keeps the panel
                    # honest instead of implying students can begin.
                    "needs_start_code": not bool(
                        row.midterm_schedule and row.midterm_schedule.access_code
                    ),
                }
            )

        resource_type = str(request.data.get("resource_type") or "").strip()
        block = str(request.data.get("block") or "").strip().upper()
        try:
            resource_id = int(request.data.get("resource_id"))
        except (TypeError, ValueError):
            return Response({"detail": "resource_id is required."}, status=http.HTTP_400_BAD_REQUEST)

        try:
            grant, created = delivery.grant_resource(
                classroom,
                session,
                block=block,
                resource_type=resource_type,
                resource_id=resource_id,
                actor=request.user,
                allow_unapproved=_flag(request, "allow_unapproved"),
            )
        except delivery.DeliveryError as e:
            return Response({"detail": e.message, "code": e.code}, status=http.HTTP_400_BAD_REQUEST)
        except DjangoValidationError as e:
            # The access engine validates deep in the stack; letting that escape was a 500
            # whose message also confirmed whether an id existed.
            logger.warning("lesson action rejected: %s", e)
            return Response(
                {"detail": "That item could not be given to the class.", "code": "rejected"},
                status=http.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "detail": "Class can now access this." if created else "Already available.",
                "created": created,
                "grant": _grant_payload(grant),
            },
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )


class ClassroomLessonRevokeView(_LessonScopedView):
    """POST — withdraw the record of an in-class grant."""

    def post(self, request, classroom_pk, lesson_id, grant_id):
        denied = self.deny_unless_can_manage(request)
        if denied:
            return denied
        grant = get_object_or_404(
            ClassroomLessonGrant,
            pk=grant_id,
            classroom_lesson__classroom_id=classroom_pk,
            classroom_lesson__journal_lesson_id=lesson_id,
        )
        delivery.revoke_grant(grant, actor=request.user)
        return Response({"detail": "Withdrawn.", "grant_id": grant.id})


class ClassroomLessonRescheduleView(_LessonScopedView):
    """PATCH — move the whole plan to a new anchor date."""

    def patch(self, request, classroom_pk):
        # Rescheduling sets the entire term's dates, so it is manager-only (Teacher/Owner),
        # a step above the TA-inclusive can_manage_assignments used for handing work out.
        if not self.caps(request).can_manage_class:
            return Response(
                {"detail": "Only the class teacher can reschedule the plan."},
                status=http.HTTP_403_FORBIDDEN,
            )
        binding = delivery.get_binding(self.get_classroom(), actor=request.user, create=True)
        if binding is None:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)

        from django.utils.dateparse import parse_date

        raw = request.data.get("starts_on")
        # Required: an omitted field used to fall through as None and NULL the anchor,
        # silently destroying the whole term's dates.
        if not raw:
            return Response(
                {"detail": "starts_on is required."}, status=http.HTTP_400_BAD_REQUEST
            )
        starts_on = parse_date(str(raw))
        if starts_on is None:
            return Response({"detail": "Invalid date."}, status=http.HTTP_400_BAD_REQUEST)
        delivery.reschedule(binding, starts_on)
        return Response({"detail": "Plan rescheduled.", "starts_on": binding.starts_on})
