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
from django.utils import timezone
from rest_framework import status as http
from rest_framework.response import Response

from journals import delivery
from journals.models import ClassroomLessonGrant, JournalLesson

from .capabilities import classroom_capabilities
from .models import ClassroomMembership
from .views_rankings import _ClassroomScopedView

logger = logging.getLogger(__name__)

#: Ceiling on a single classwork award. **This number is mine, not the school's** — it is a
#: fat-finger guard, not a policy. Set against the homework maximum of 15 so one lesson can
#: be worth several homeworks and still not be worth a term.
MAX_CLASSWORK_POINTS = 50


def _vocab_rows(ids):
    """[{resource_id, title, word_count}] for vocabulary bank-set ids, in stored order."""
    ids = [int(x) for x in (ids or [])]
    if not ids:
        return []
    from django.db.models import Count
    from vocabulary.models import VocabSet, VocabSetItem

    counts = dict(
        VocabSetItem.objects.filter(vocab_set_id__in=ids)
        .values_list("vocab_set")
        .order_by()
        .annotate(n=Count("id"))
        .values_list("vocab_set", "n")
    )
    by_id = {
        s.id: {"resource_id": s.id, "title": s.title, "word_count": counts.get(s.id, 0)}
        for s in VocabSet.objects.filter(pk__in=ids)
    }
    return [by_id[i] for i in ids if i in by_id]


def _media_url(filefield):
    """A file's URL (R2 signed URLs are already absolute), or None. Never raises."""
    if not filefield:
        return None
    try:
        return filefield.url
    except ValueError:
        return None


def _flag(request, name: str) -> bool:
    """Read a boolean confirm flag from the body (multipart sends it as a string)."""
    return str(request.data.get(name, "")).strip().lower() in ("1", "true", "yes", "on")


def _roster_student(classroom, raw_id):
    """The classroom's non-removed STUDENT with this id, or None.

    Resolved through the roster rather than by a bare user lookup on purpose: an id from
    anywhere else would let a teacher mint points for a student in somebody else's class.
    """
    try:
        student_id = int(raw_id)
    except (TypeError, ValueError):
        return None
    membership = (
        ClassroomMembership.objects.filter(
            classroom=classroom, user_id=student_id, role=ClassroomMembership.ROLE_STUDENT
        )
        .exclude(status=ClassroomMembership.STATUS_REMOVED)
        .select_related("user")
        .first()
    )
    return membership.user if membership is not None else None


def _classwork_points(raw) -> tuple[int | None, str]:
    """Parse the teacher's points field into ``(points, error)``.

    Zero is allowed and meaningful: it records "a teacher looked at this and it earned
    nothing this time", which the absence of a row does not. It is NOT how a mis-click is
    undone — awarding 0 is a *smaller fact* and leaves the XP standing (OVERHAUL §6), so
    withdrawing the award is its own operation: ``DELETE`` on this endpoint. Negative is
    refused — a classwork award is a reward, and docking a student is a manual admin
    adjustment (``EVENT_MANUAL``), not something a lesson panel should do.
    """
    if raw is None or str(raw).strip() == "":
        return None, "points is required."
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return None, "points must be a whole number."
    if value < 0:
        return None, "Classwork points cannot be negative."
    if value > MAX_CLASSWORK_POINTS:
        return None, f"Classwork points cannot be more than {MAX_CLASSWORK_POINTS}."
    return value, ""


def _classwork_payload(assignment) -> dict:
    """Teacher-facing state of one lesson's classwork carrier.

    ``given: False`` is the honest answer for a lesson whose classwork has not been handed
    out — the carrier is created by the teacher's action, so there is nothing to read yet.
    """
    if assignment is None:
        return {
            "given": False,
            "assignment_id": None,
            "title": "",
            "given_at": None,
            # Sent on both branches so the points field can be bounded before the teacher
            # has handed anything out — the award endpoint hands it out on the way through.
            "max_points": MAX_CLASSWORK_POINTS,
            "awards": [],
        }
    awards = delivery.classwork_awards(assignment)
    return {
        "given": True,
        "assignment_id": assignment.id,
        "title": assignment.title,
        "given_at": assignment.published_at or assignment.created_at,
        "max_points": MAX_CLASSWORK_POINTS,
        "awards": [
            {"student_id": student_id, **row} for student_id, row in sorted(awards.items())
        ],
    }


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
    # Keyed by BLOCK too: grants are unique per (block, type, id), so the same item
    # sitting in both New topic and Exercises is granted and withdrawn separately.
    # Without the block, opening it in one block marked the other as given and hid its
    # button.
    granted = {(g.block, g.resource_type, g.resource_id) for g in entry["grants"]}

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
        # Classwork is handed out separately from homework and has its own carrier, so the
        # panel needs its own "given" flag — the homework one says nothing about it.
        "classwork_given": bool(row and row.classwork_assignment_id),
        "classwork_assignment_id": row.classwork_assignment_id if row else None,
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
        "external_urls": list(session.external_urls or []),
        "video_url": session.video_url,
        "video_file_url": _media_url(session.video_file),
        "allow_file_upload": session.allow_file_upload,
        "practice_test_ids": session.practice_test_ids or [],
        "practice_test_pack_ids": session.practice_test_pack_ids or [],
        "assessments": [_assessment_payload(l) for l in session.assessments.all()],
        "vocabulary": _vocab_rows(session.vocabulary_set_ids),
        "validation": session.homework_validation_reasons(),
    }

    cw = getattr(session, "classwork", None)
    if cw is not None:
        def _items(block_assessments, practice_ids, pack_ids, vocab_ids, block):
            items = []
            for link in block_assessments:
                item = _assessment_payload(link)
                item["block"] = block
                item["given"] = (block, "assessment_set", link.assessment_set_id) in granted
                items.append(item)
            for pid in practice_ids or []:
                items.append(
                    {
                        "resource_type": "practice_test",
                        "resource_id": pid,
                        "block": block,
                        "given": (block, "practice_test", pid) in granted,
                    }
                )
            for pid in pack_ids or []:
                items.append(
                    {
                        "resource_type": "practice_test_pack",
                        "resource_id": pid,
                        "block": block,
                        "given": (block, "practice_test_pack", pid) in granted,
                    }
                )
            for row in _vocab_rows(vocab_ids):
                items.append(
                    {
                        "resource_type": "vocabulary_set",
                        "resource_id": row["resource_id"],
                        "title": row["title"],
                        "word_count": row["word_count"],
                        "block": block,
                        "given": (block, "vocabulary_set", row["resource_id"]) in granted,
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
                "external_urls": list(cw.new_topic_external_urls or []),
                "video_url": cw.new_topic_video_url,
                "video_file_url": _media_url(cw.new_topic_video_file),
                "minutes": cw.new_topic_minutes,
                "items": _items(
                    by_block.get("NEW_TOPIC", []),
                    cw.new_topic_practice_test_ids,
                    cw.new_topic_practice_test_pack_ids,
                    cw.new_topic_vocabulary_set_ids,
                    "NEW_TOPIC",
                ),
            },
            "exercises": {
                "minutes": cw.exercises_minutes,
                "items": _items(
                    by_block.get("EXERCISES", []),
                    cw.exercise_practice_test_ids,
                    cw.exercise_practice_test_pack_ids,
                    cw.exercise_vocabulary_set_ids,
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

    def deny_unless_can_manage_class(self, request, action: str):
        """Owner + Teacher only. Deliberately NOT ``can_manage_assignments``/``can_grade``.

        Both of those include TAs (capabilities.py), and classwork points are *minted*
        rather than derived from work a student did — a TA holding the grading brief must
        not be able to create points out of nothing. ``rewards.views._is_reward_staff`` is
        not reusable here either: it excludes teachers entirely, which is the opposite of
        what a class-local award needs.
        """
        if not self.caps(request).can_manage_class:
            return Response(
                {"detail": f"Only the class teacher can {action}."},
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


def _focus_lesson(entries):
    """Which single lesson the teacher should land on, and why.

    The panel opens straight onto one lesson rather than a list, so the choice has to be
    made somewhere — here, on the server, because it depends on the local date and the
    server owns the timezone. Today's lesson wins; otherwise the nearest upcoming one, so
    the tab is still useful between lessons; otherwise the most recent past one.
    """
    dated = [
        (e, timezone.localtime(e["scheduled_for"]).date())
        for e in entries
        if e["scheduled_for"]
    ]
    if not dated:
        # An unschedulable classroom (no lesson_days / unparseable lesson_time) still has
        # a plan, just no dates — fall back to the first session.
        return (entries[0]["session"].id if entries else None), "undated"

    today = timezone.localdate()
    for e, d in dated:
        if d == today:
            return e["session"].id, "today"
    upcoming = [(e, d) for e, d in dated if d > today]
    if upcoming:
        return min(upcoming, key=lambda x: x[1])[0]["session"].id, "next"
    return max(dated, key=lambda x: x[1])[0]["session"].id, "last"


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
        focus_id, focus_kind = _focus_lesson(plan["lessons"])
        return Response(
            {
                "bound": True,
                "reason": "",
                # The lesson to open directly, and whether it is today's, the next one or
                # the last one — the panel shows no picker.
                "focus_lesson_id": focus_id,
                "focus": focus_kind,
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


class ClassroomLessonClassworkView(_LessonScopedView):
    """The lesson's classwork: GET its state, POST to give it to the class.

    Mounted here rather than under ``/api/journals/`` for the two reasons in this module's
    docstring — that namespace is host-guarded to the admin console and its permission
    class excludes teachers, so a route there 403s before DRF runs.
    """

    def get(self, request, classroom_pk, lesson_id):
        denied = self.deny_unless_staff(request)
        if denied:
            return denied
        try:
            session = self.session(lesson_id)
        except Http404Lesson:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)
        assignment = delivery.classwork_assignment_for(self.get_classroom(), session)
        return Response(_classwork_payload(assignment))

    def post(self, request, classroom_pk, lesson_id):
        denied = self.deny_unless_can_manage_class(request, "give out classwork")
        if denied:
            return denied
        try:
            session = self.session(lesson_id)
        except Http404Lesson:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)
        try:
            assignment, created = delivery.assign_classwork(
                self.get_classroom(), session, actor=request.user
            )
        except delivery.DeliveryError as e:
            return Response({"detail": e.message, "code": e.code}, status=http.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "detail": "Classwork given to the class." if created else "Already given.",
                "created": created,
                **_classwork_payload(assignment),
            },
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )


class ClassroomLessonClassworkAwardView(_LessonScopedView):
    """One student's classwork payment: POST to set it, DELETE to withdraw it.

    Manual by design: classwork has no deadline and no automatic scoring, so the teacher
    who was in the room is the only thing that decides what it was worth. That also makes
    CLASSWORK_MANUAL the one event whose amount a human types by hand, and therefore the one
    that gets typed wrong — which is why there are two corrections here rather than one.

    **POST sets the amount — including downwards. DELETE withdraws the award.** They are
    different facts and OVERHAUL §6 gives them different XP behaviour: a smaller fact keeps
    its XP (``award``'s ``max(previous_xp, …)``), a withdrawn fact takes its XP back
    (``services.revoke``). Collapsing them into one endpoint with a ``points=0`` convention
    would mean a teacher who typed 50 for the wrong student could never get that 50 off the
    XP board — correcting to 0 lowers only the points.

    DELETE rather than a ``withdraw=true`` flag on the POST: the two are meant to be hard to
    confuse, and the verb says which one happened in the access log without anyone having to
    read the body.
    """

    def _student(self, classroom, request):
        """The roster student this call is about, or None.

        Body first, query string second. A DELETE body is legal but not universally sent —
        some HTTP clients drop it — so a withdrawal must also be expressible in the URL, or
        it would fail as "not on this roster" for a student who is.
        """
        raw = request.data.get("student_id") if hasattr(request.data, "get") else None
        if raw in (None, ""):
            raw = request.query_params.get("student_id")
        return _roster_student(classroom, raw)

    def post(self, request, classroom_pk, lesson_id):
        denied = self.deny_unless_can_manage_class(request, "award classwork points")
        if denied:
            return denied
        try:
            session = self.session(lesson_id)
        except Http404Lesson:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)

        classroom = self.get_classroom()
        student = self._student(classroom, request)
        if student is None:
            return Response(
                {"detail": "That student is not on this class's roster.", "code": "not_on_roster"},
                status=http.HTTP_400_BAD_REQUEST,
            )
        points, error = _classwork_points(request.data.get("points"))
        if error:
            return Response({"detail": error, "code": "bad_points"}, status=http.HTTP_400_BAD_REQUEST)

        # Hand the classwork out on the way through rather than demanding the teacher press
        # two buttons in the right order mid-lesson. assign_classwork is idempotent, so this
        # is a no-op once the carrier exists — and paying for work implies the class did it.
        try:
            assignment, _created = delivery.assign_classwork(
                classroom, session, actor=request.user
            )
        except delivery.DeliveryError as e:
            return Response({"detail": e.message, "code": e.code}, status=http.HTTP_400_BAD_REQUEST)

        awarded = delivery.award_classwork(
            assignment,
            student,
            points=points,
            actor=request.user,
            # PointAward.note is 240 chars; an over-long note would raise inside award(),
            # which swallows it — the teacher would see a bare failure with no reason.
            note=str(request.data.get("note") or "").strip()[:240],
        )
        if awarded is None:
            # award() swallows by design, so None is the only signal that the write failed.
            # Say so rather than reporting a success the ledger does not have.
            return Response(
                {
                    "detail": "Those points could not be recorded. Please try again.",
                    "code": "award_failed",
                },
                status=http.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(
            {
                "detail": f"{points} point{'' if points == 1 else 's'} recorded for this classwork.",
                "assignment_id": assignment.id,
                "student_id": student.id,
                "points": awarded.points,
                "xp": awarded.xp,
                "awarded_at": awarded.awarded_at,
            }
        )

    def delete(self, request, classroom_pk, lesson_id):
        """Withdraw this student's classwork award entirely — the points and the XP with them.

        Same Owner+Teacher gate as awarding: taking points off a student is as much a ledger
        write as putting them on, and a TA must not be able to do either.
        """
        denied = self.deny_unless_can_manage_class(request, "withdraw classwork points")
        if denied:
            return denied
        try:
            session = self.session(lesson_id)
        except Http404Lesson:
            return Response({"detail": "This class has no lesson plan."}, status=http.HTTP_404_NOT_FOUND)

        classroom = self.get_classroom()
        student = self._student(classroom, request)
        if student is None:
            return Response(
                {"detail": "That student is not on this class's roster.", "code": "not_on_roster"},
                status=http.HTTP_400_BAD_REQUEST,
            )

        # Read the carrier; deliberately NOT assign_classwork, which the POST calls to hand
        # the lesson out on the way through. Paying for work implies the class did it;
        # withdrawing a payment implies nothing, and a withdrawal that handed the classwork
        # out as a side effect would be a genuinely surprising button.
        assignment = delivery.classwork_assignment_for(classroom, session)
        row = (
            delivery.withdraw_classwork(
                assignment,
                student,
                actor=request.user,
                # PointAwardAudit.reason is 240 chars and delivery clips the composed string;
                # this only keeps an over-long body from filling it with one field.
                reason=str(request.data.get("reason") or "").strip()[:200],
            )
            if assignment is not None
            else None
        )
        if row is None:
            return Response(
                {
                    "detail": "There is nothing to withdraw — this student has no classwork award.",
                    "code": "no_award",
                },
                status=http.HTTP_404_NOT_FOUND,
            )
        if row.points != 0 or row.xp != 0:
            # revoke() swallows by design, and it returns the same False for "already
            # withdrawn" as for "the write blew up" — so the ROW is the only honest check.
            # Withdrawing twice lands here with a row that is already zeroed, which is a
            # success; a failure is a row that still carries value.
            return Response(
                {
                    "detail": "That award could not be withdrawn. Please try again.",
                    "code": "withdraw_failed",
                },
                status=http.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(
            {
                "detail": "Classwork award withdrawn. The points and XP have been taken back.",
                "assignment_id": assignment.id,
                "student_id": student.id,
                "points": row.points,
                "xp": row.xp,
            }
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
