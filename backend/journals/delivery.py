"""Deliver a Journal's sessions into a live classroom.

The Journals app authors **templates**: one plan per (subject, level), shared by every
classroom of that course. This module is the seam where a template becomes real work for
real students — what ``services.release_lesson_into_classroom`` reserved space for.

Two distinct teacher actions live here:

* **Release homework** — build a ``classes.Assignment`` from the session's homework brief,
  due at the START of the classroom's next lesson, and attach its assessments/pastpapers.
* **Grant** — the in-lesson "give the class access to this" button, for one item of the
  classwork plan (new-topic or exercise content) or for a midterm session.

Content is never copied onto the classroom. It is read through the template FK and
materialized exactly once, into the structures students already read. Which structure
that is differs per content type, and each one has a different live gate:

===================  ==========================================================
assessment set       a ``HomeworkAssignment`` row + STUDENT membership IS the
                     gate — there is no per-student access row
pastpaper / pack     the legacy ``PracticeTest.assigned_users`` M2M; publishing
                     a test never exposes it on its own
midterm              a ``ResourceAccessGrant`` **plus** a ``MidtermSchedule``;
                     and access alone is still not enough to let a student in —
                     the teacher must also generate the 6-digit start code
===================  ==========================================================
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from .models import (
    ClassroomJournal,
    ClassroomLesson,
    ClassroomLessonGrant,
    Journal,
    JournalLesson,
)

logger = logging.getLogger(__name__)


class DeliveryError(Exception):
    """A delivery action could not be completed. ``code`` is a stable machine string."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ── binding ────────────────────────────────────────────────────────────────────


def journal_for_classroom(classroom) -> Journal | None:
    """The published Journal this classroom should be teaching, or None.

    Both models use the same subject ("ENGLISH"/"MATH") and level vocabularies, so this is
    a direct lookup. ``Classroom.level`` is optional, so a classroom with no level has no
    journal — that is a data gap for an admin to fix, not an error.
    """
    if not classroom.level:
        return None
    return Journal.objects.filter(
        subject=classroom.subject, level=classroom.level, status=Journal.STATUS_PUBLISHED
    ).first()


def get_binding(classroom, *, actor=None, create: bool = False) -> ClassroomJournal | None:
    """The classroom's journal binding; optionally create it on first use.

    Binding is lazy — a teacher opening the Lessons tab binds the class automatically
    rather than having to press a setup button first.
    """
    binding = ClassroomJournal.objects.filter(classroom=classroom).select_related("journal").first()
    if binding is not None or not create:
        return binding
    journal = journal_for_classroom(classroom)
    if journal is None:
        return None
    binding, _ = ClassroomJournal.objects.get_or_create(
        classroom=classroom,
        defaults={
            "journal": journal,
            "starts_on": classroom.start_date,
            "bound_by": actor,
        },
    )
    return binding


def reschedule(binding: ClassroomJournal, starts_on) -> ClassroomJournal:
    """Move the whole plan to a new anchor date.

    Only sessions that have NOT been delivered move: ``ClassroomLesson.scheduled_for`` is
    frozen at release time precisely so a reschedule cannot rewrite history.
    """
    binding.starts_on = starts_on
    binding.save(update_fields=["starts_on"])
    return binding


# ── the derived plan ───────────────────────────────────────────────────────────


def lesson_plan(classroom, *, actor=None, create_binding: bool = True) -> dict:
    """The classroom's lesson plan: journal sessions paired with real dates + state.

    Derived on read rather than materialized, so an admin adding, removing or reordering
    sessions in the journal flows straight through to every classroom teaching it.
    """
    from classes.lesson_schedule import lesson_starts

    binding = get_binding(classroom, actor=actor, create=create_binding)
    if binding is None:
        return {
            "bound": False,
            # Tell the UI *why* there is no plan, so it can give the admin an instruction
            # instead of an empty list.
            "reason": "no_level" if not classroom.level else "no_published_journal",
            "journal": None,
            "lessons": [],
        }

    sessions = list(
        binding.journal.lessons.order_by("lesson_number", "id")
        .select_related("classwork", "midterm_exam")
        .prefetch_related("assessments", "classwork__assessments")
    )
    starts = lesson_starts(classroom, len(sessions), anchor=binding.starts_on)
    delivered = {
        d.journal_lesson_id: d
        for d in ClassroomLesson.objects.filter(classroom=classroom).prefetch_related("grants")
    }

    lessons = []
    for session, planned_start in zip(sessions, starts):
        row = delivered.get(session.id)
        lessons.append(
            {
                "session": session,
                "delivery": row,
                # A delivered lesson keeps the date it actually happened on; an
                # undelivered one shows where it currently falls.
                "scheduled_for": (row.scheduled_for if row and row.scheduled_for else planned_start),
                "grants": list(row.grants.filter(revoked_at__isnull=True)) if row else [],
            }
        )
    return {
        "bound": True,
        "reason": "",
        "journal": binding.journal,
        "binding": binding,
        "lessons": lessons,
    }


def _delivery_for(classroom, session: JournalLesson, *, planned_start=None) -> ClassroomLesson:
    """Get or create the per-classroom row for one session."""
    row = ClassroomLesson.objects.filter(classroom=classroom, journal_lesson=session).first()
    if row is not None:
        return row
    if planned_start is None:
        from classes.lesson_schedule import lesson_starts

        binding = get_binding(classroom)
        anchor = binding.starts_on if binding else None
        starts = lesson_starts(classroom, session.lesson_number, anchor=anchor)
        planned_start = starts[session.lesson_number - 1] if starts else None
    row, _ = ClassroomLesson.objects.get_or_create(
        classroom=classroom,
        journal_lesson=session,
        defaults={"lesson_number": session.lesson_number, "scheduled_for": planned_start},
    )
    return row


# ── releasing homework ─────────────────────────────────────────────────────────


@transaction.atomic
def release_homework(classroom, session: JournalLesson, *, actor) -> tuple[ClassroomLesson, bool]:
    """Materialize a session's homework brief as a live ``classes.Assignment``.

    Idempotent: re-releasing a session whose assignment still exists is a no-op, so a
    double-press in front of a class cannot produce two homeworks. Returns
    ``(delivery, created)``.
    """
    from assessments.domain.homework_versioning import attach_assessment_set
    from classes.lesson_schedule import homework_due_at
    from classes.models import Assignment, grant_practice_test_library_access_for_assignment

    if session.is_midterm:
        raise DeliveryError("midterm_session", "A midterm session has no homework to release.")
    if session.homework_validation_reasons():
        raise DeliveryError(
            "incomplete",
            "This session's homework is not ready: "
            + "; ".join(session.homework_validation_reasons()),
        )

    delivery = _delivery_for(classroom, session)
    if delivery.assignment_id and delivery.homework_released_at:
        return delivery, False

    assignment = Assignment.objects.create(
        classroom=classroom,
        created_by=actor,
        title=session.title or f"Lesson {session.lesson_number}",
        instructions=session.instructions,
        external_url=session.external_url,
        attachment_file=session.attachment_file or None,
        allow_file_upload=session.allow_file_upload,
        practice_scope=session.practice_scope,
        practice_test_ids=session.practice_test_ids or None,
        practice_test_pack_ids=session.practice_test_pack_ids or None,
        category=session.category,
        max_score=session.max_score,
        status=Assignment.STATUS_PUBLISHED,
        # No manual deadline anywhere in this system: homework runs until the START of
        # this classroom's next lesson. None (unschedulable classroom) = never closes.
        due_at=homework_due_at(classroom),
    )

    # Pastpapers attached to the brief: the assignment's own library grant opens them.
    try:
        grant_practice_test_library_access_for_assignment(assignment)
    except Exception:
        logger.exception(
            "grant_practice_test_library_access_for_assignment failed for assignment %s",
            assignment.pk,
        )

    for link in session.assessments.all():
        attach_assessment_set(
            classroom=classroom,
            assignment=assignment,
            set_id=link.assessment_set_id,
            actor=actor,
        )

    delivery.assignment = assignment
    delivery.homework_released_at = timezone.now()
    delivery.released_by = actor
    if delivery.scheduled_for is None:
        delivery.scheduled_for = timezone.now()
    delivery.save(
        update_fields=[
            "assignment",
            "homework_released_at",
            "released_by",
            "scheduled_for",
            "updated_at",
        ]
    )
    return delivery, True


# ── in-class grants ────────────────────────────────────────────────────────────


def _classwork_assignment(delivery: ClassroomLesson, session: JournalLesson, *, actor):
    """The lesson's in-class Assignment, created on first grant.

    ``HomeworkAssignment`` requires an ``Assignment``, so an assessment opened in class
    still needs one. It is categorised CLASSWORK (which routes it to the Academic ranking
    rather than SAT, per the Assignment category contract) and carries no ``due_at`` — it
    is done in the room, not by a deadline. One per lesson, so opening three items does
    not litter the Assignments tab with three entries.
    """
    from classes.models import Assignment

    if delivery.classwork_assignment_id:
        return delivery.classwork_assignment
    assignment = Assignment.objects.create(
        classroom=delivery.classroom,
        created_by=actor,
        title=f"Lesson {session.lesson_number} — classwork",
        instructions=(getattr(session, "classwork", None) and session.classwork.new_topic_instructions) or "",
        category=Assignment.CATEGORY_CLASSWORK,
        status=Assignment.STATUS_PUBLISHED,
        due_at=None,
    )
    delivery.classwork_assignment = assignment
    delivery.save(update_fields=["classwork_assignment", "updated_at"])
    return assignment


def _student_members(classroom):
    from classes.models import ClassroomMembership

    return [
        m.user
        for m in classroom.memberships.select_related("user")
        .filter(role=ClassroomMembership.ROLE_STUDENT)
        .exclude(status=ClassroomMembership.STATUS_REMOVED)
    ]


@transaction.atomic
def grant_resource(
    classroom, session: JournalLesson, *, block: str, resource_type: str, resource_id: int, actor
) -> tuple[ClassroomLessonGrant, bool]:
    """Open one item of a lesson plan to the class, right now.

    Returns ``(grant, created)``; ``created is False`` means it was already open, which
    the panel shows as "Given" rather than an error.
    """
    from access.resources import RT_ASSESSMENT_SET, RT_PRACTICE_TEST, RT_PRACTICE_TEST_PACK

    if resource_type not in (RT_ASSESSMENT_SET, RT_PRACTICE_TEST, RT_PRACTICE_TEST_PACK):
        raise DeliveryError("bad_resource_type", f"Cannot grant '{resource_type}' from a lesson.")

    delivery = _delivery_for(classroom, session)
    existing = ClassroomLessonGrant.objects.filter(
        classroom_lesson=delivery,
        block=block,
        resource_type=resource_type,
        resource_id=resource_id,
        revoked_at__isnull=True,
    ).first()
    if existing is not None:
        return existing, False

    if resource_type == RT_ASSESSMENT_SET:
        from assessments.domain.homework_versioning import attach_assessment_set

        homework, _created = attach_assessment_set(
            classroom=classroom,
            assignment=_classwork_assignment(delivery, session, actor=actor),
            set_id=resource_id,
            actor=actor,
        )
        if homework is None:
            raise DeliveryError("not_found", "That assessment set no longer exists.")
    else:
        from access.engine.assignment_service import AssignmentService
        from access.models import ResourceAccessGrant

        students = _student_members(classroom)
        if not students:
            raise DeliveryError("no_students", "This class has no enrolled students yet.")
        # verify=True re-reads the live gate after writing and rolls back if any student
        # still can't see it — a button pressed in front of a class must fail loudly
        # rather than silently grant nothing.
        AssignmentService.bulk_assign_resource(
            students,
            resource_type,
            resource_id,
            actor=actor,
            source=ResourceAccessGrant.SOURCE_CLASSROOM,
            classroom=classroom,
            note="journal lesson grant",
        )

    grant = ClassroomLessonGrant.objects.create(
        classroom_lesson=delivery,
        block=block,
        resource_type=resource_type,
        resource_id=resource_id,
        granted_by=actor,
    )
    return grant, True


@transaction.atomic
def grant_midterm(classroom, session: JournalLesson, *, actor) -> tuple[ClassroomLesson, bool]:
    """Give the class access to a MIDTERM session's exam and open its access window.

    Access alone does NOT let a student start: ``midterms.access.can_start_midterm``
    refuses with ``midterm_no_code`` until the teacher generates the 6-digit start code
    (the existing ``midterms-v2/<id>/start-code/`` endpoint). The panel therefore shows
    this as two steps.
    """
    from access.engine.classroom_service import ClassroomAccessService
    from access.resources import RT_MIDTERM_V2
    from classes.models_schedule import MidtermSchedule

    if not session.is_midterm or session.midterm_exam_id is None:
        raise DeliveryError("not_midterm", "This session has no midterm to grant.")

    delivery = _delivery_for(classroom, session)
    if delivery.midterm_schedule_id:
        return delivery, False

    ClassroomAccessService.assign_resource_to_classroom(
        classroom,
        RT_MIDTERM_V2,
        session.midterm_exam_id,
        actor=actor,
        note="journal midterm session",
    )

    # The admin authored "the class gets access N days before the session"; honour that as
    # the window start. The schedule owns the window — deliberately NOT grant.expires_at,
    # which would strip access from a student mid-attempt.
    starts_at = None
    if delivery.scheduled_for:
        starts_at = delivery.scheduled_for - timezone.timedelta(
            days=session.midterm_access_days_before or 0
        )
    schedule, _ = MidtermSchedule.objects.get_or_create(
        classroom=classroom,
        midterm_id=session.midterm_exam_id,
        defaults={"starts_at": starts_at, "created_by": actor},
    )
    delivery.midterm_schedule = schedule
    delivery.save(update_fields=["midterm_schedule", "updated_at"])
    return delivery, True


@transaction.atomic
def revoke_grant(grant: ClassroomLessonGrant, *, actor=None) -> ClassroomLessonGrant:
    """Mark an in-class grant withdrawn.

    Only the RECORD is withdrawn: the underlying access stays, because a student may be
    mid-attempt and this button exists to tidy the panel, not to yank work away. Revoking
    frees the partial unique constraint so the item can be given again.
    """
    grant.revoked_at = timezone.now()
    grant.save(update_fields=["revoked_at"])
    return grant
