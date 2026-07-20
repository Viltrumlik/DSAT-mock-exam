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
import os.path

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
    if binding is not None:
        # Re-check the status on EVERY read, not just when binding. Publication is the
        # switch that makes a plan deliverable, so unpublishing or archiving one has to
        # stop delivery immediately — otherwise a class bound while the journal was live
        # keeps handing out draft content afterwards. The row is left in place: it holds
        # the date anchor, and re-publishing restores the plan unchanged.
        if binding.journal.status != Journal.STATUS_PUBLISHED:
            return None
        return binding
    if not create:
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


def _copy_files(session: JournalLesson, assignment) -> None:
    """Copy the session's files onto the Assignment, primary + extras.

    Deliberately a copy, not a FileField assignment: assigning one FileField to another
    stores the SAME storage path on both rows, so the journal template and every classroom
    that ever received it would share one file — and deleting any of them takes the file
    away from the rest. ``ContentFile`` forces a fresh write under the Assignment's own
    ``upload_to``.
    """
    from django.core.files.base import ContentFile
    from classes.models import AssignmentExtraAttachment

    def _dup(src_field):
        try:
            src_field.open("rb")
            try:
                return ContentFile(src_field.read(), name=os.path.basename(src_field.name))
            finally:
                src_field.close()
        except Exception:
            # A missing file on disk must not sink the whole release — the rest of the
            # homework is still worth delivering.
            logger.exception("journal file copy failed for %s", getattr(src_field, "name", "?"))
            return None

    if session.attachment_file:
        copied = _dup(session.attachment_file)
        if copied is not None:
            assignment.attachment_file = copied
            assignment.save(update_fields=["attachment_file", "updated_at"])

    for extra in session.extra_attachments.all():
        if not extra.file:
            continue
        copied = _dup(extra.file)
        if copied is not None:
            AssignmentExtraAttachment.objects.create(assignment=assignment, file=copied)


# ── releasing homework ─────────────────────────────────────────────────────────


@transaction.atomic
def release_homework(
    classroom, session: JournalLesson, *, actor, allow_unapproved: bool = False
) -> tuple[ClassroomLesson, bool, list[str]]:
    """Materialize a session's homework brief as a live ``classes.Assignment``.

    Idempotent: re-releasing a session whose assignment still exists is a no-op, so a
    double-press in front of a class cannot produce two homeworks.

    Returns ``(delivery, created, warnings)``. ``warnings`` names any content that could
    NOT be attached — never silently dropped, because the teacher would otherwise be told
    the homework went out while students see an empty one.
    """
    from assessments.domain.homework_versioning import attach_assessment_set
    from classes.lesson_schedule import next_lesson_start_after
    from classes.models import Assignment, grant_practice_test_library_access_for_assignment

    if session.is_midterm:
        raise DeliveryError("midterm_session", "A midterm session has no homework to release.")
    if session.homework_validation_reasons():
        raise DeliveryError(
            "incomplete",
            "This session's homework is not ready: "
            + "; ".join(session.homework_validation_reasons()),
        )

    _assert_sets_approved(
        [l.assessment_set_id for l in session.assessments.all()],
        allow_unapproved=allow_unapproved,
    )

    delivery = _delivery_for(classroom, session)
    # Lock before the released? check: an unlocked read-then-write let a double-press
    # create two Assignments for one lesson, and there is no DB constraint behind it.
    delivery = ClassroomLesson.objects.select_for_update().get(pk=delivery.pk)
    if delivery.assignment_id and delivery.homework_released_at:
        return delivery, False, []

    assignment = Assignment.objects.create(
        classroom=classroom,
        created_by=actor,
        title=session.title or f"Lesson {session.lesson_number}",
        instructions=session.instructions,
        external_url=session.external_url,
        allow_file_upload=session.allow_file_upload,
        practice_scope=session.practice_scope,
        practice_test_ids=session.practice_test_ids or None,
        practice_test_pack_ids=session.practice_test_pack_ids or None,
        category=session.category,
        max_score=session.max_score,
        status=Assignment.STATUS_PUBLISHED,
        # No manual deadline anywhere in this system: homework set in lesson N is due at
        # the START of lesson N+1. Measured from THIS lesson's own date, not from "now" —
        # releasing lesson 5 a week late must not shorten its deadline to the next lesson
        # after today. None (unschedulable classroom) = never closes.
        due_at=next_lesson_start_after(classroom, after=delivery.scheduled_for),
    )

    # Files: COPY, never assign the template's FileField across. Assigning stores the same
    # storage path on both rows, so the Assignment and the journal template would share one
    # file and deleting either could pull it from under the other. The session's extra
    # attachments have to come across too — only the first used to.
    _copy_files(session, assignment)

    # Pastpapers attached to the brief: the assignment's own library grant opens them.
    try:
        grant_practice_test_library_access_for_assignment(assignment)
    except Exception:
        logger.exception(
            "grant_practice_test_library_access_for_assignment failed for assignment %s",
            assignment.pk,
        )

    # uniq_assessment_hw_classroom_set allows a set to reach a classroom only ONCE, ever.
    # A set this class already has (from an earlier session, or opened as classwork) can
    # therefore not be bound to this new Assignment — it stays on the old one. Silently
    # ignoring that produced a homework with no content while still reporting success, so
    # the caller is told which sets did not make it.
    skipped: list[str] = []
    for link in session.assessments.all():
        homework, created = attach_assessment_set(
            classroom=classroom,
            assignment=assignment,
            set_id=link.assessment_set_id,
            actor=actor,
        )
        if homework is None:
            skipped.append(f"set #{link.assessment_set_id} no longer exists")
        elif not created:
            skipped.append(
                f"{homework.assessment_set.title} was already given to this class"
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
    return delivery, True, skipped


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


def plan_items(session: JournalLesson) -> set[tuple[str, str, int]]:
    """Every ``(block, resource_type, resource_id)`` this session actually declares.

    The grant endpoint is "open THIS item of the plan", so it must be checked against the
    plan. Without it any assessment set or pastpaper id could be handed to the class,
    which would sidestep both the level/subject scoping journal authoring enforces and
    the approval gate on the ordinary assign path.

    Keyed by block as well as resource, because the same item may legitimately sit in both
    the new-topic and exercises blocks and they are granted (and withdrawn) separately.
    """
    from access.resources import RT_ASSESSMENT_SET, RT_PRACTICE_TEST, RT_PRACTICE_TEST_PACK

    out: set[tuple[str, str, int]] = set()
    cw = getattr(session, "classwork", None)
    if cw is None:
        return out
    for link in cw.assessments.all():
        out.add((link.block, RT_ASSESSMENT_SET, link.assessment_set_id))
    blocks = (
        (ClassroomLessonGrant.BLOCK_NEW_TOPIC, cw.new_topic_practice_test_ids, cw.new_topic_practice_test_pack_ids),
        (ClassroomLessonGrant.BLOCK_EXERCISES, cw.exercise_practice_test_ids, cw.exercise_practice_test_pack_ids),
    )
    for block, test_ids, pack_ids in blocks:
        for pid in test_ids or []:
            out.add((block, RT_PRACTICE_TEST, int(pid)))
        for pid in pack_ids or []:
            out.add((block, RT_PRACTICE_TEST_PACK, int(pid)))
    return out


def _assert_sets_approved(set_ids, *, allow_unapproved: bool) -> None:
    """Refuse content that has not passed review, unless the teacher confirms.

    Journal delivery reaches students by exactly the same route as the ordinary assign
    path, so it gets the same gate: ``assessments.views_assign`` and
    ``AssignmentViewSet.create`` both reject a set whose ``review_status`` is not APPROVED
    unless ``allow_unapproved`` is passed. Without this, an admin attaching a draft set to
    a journal put unreviewed questions in front of a class.
    """
    from assessments.models import AssessmentSet

    if allow_unapproved:
        return
    ids = [i for i in set_ids if i]
    if not ids:
        return
    bad = list(
        AssessmentSet.objects.filter(pk__in=ids)
        .exclude(review_status=AssessmentSet.STATUS_APPROVED)
        .values_list("title", flat=True)
    )
    if bad:
        raise DeliveryError(
            "assessment_not_approved",
            "Not approved yet: " + "; ".join(bad),
        )


def _assert_resource_exists(resource_type: str, resource_id: int) -> None:
    """Raise a DeliveryError if the granted resource is gone.

    A journal plan stores bare ids, so content deleted after authoring leaves a dangling
    entry. Without this the grant path raised ValidationError/IntegrityError out of the
    access engine — a 500 that also confirmed whether an id existed.
    """
    from access.resources import RT_ASSESSMENT_SET, RT_PRACTICE_TEST, RT_PRACTICE_TEST_PACK
    from assessments.models import AssessmentSet
    from exams.models import PracticeTest, PracticeTestPack

    model = {
        RT_ASSESSMENT_SET: AssessmentSet,
        RT_PRACTICE_TEST: PracticeTest,
        RT_PRACTICE_TEST_PACK: PracticeTestPack,
    }.get(resource_type)
    if model is None:
        return
    if not model.objects.filter(pk=resource_id).exists():
        raise DeliveryError(
            "not_found",
            "That item is no longer available — an admin may have deleted it from the plan.",
        )


def _pack_scope(practice_scope: str | None) -> str | None:
    """Translate ``Assignment.practice_scope`` into the vocabulary pack expansion uses.

    Two different vocabularies meet here: ``practice_scope`` is BOTH/ENGLISH/MATH, while
    ``access.resources.expand_subject_targets`` keys on ``{"math", "reading"}`` and treats
    anything else as "all sections". MATH survived that mismatch by accident (it
    lowercases to a key that exists); ENGLISH did not, so opening an English pack in class
    handed the students its Math sections too.
    """
    return {"ENGLISH": "reading", "MATH": "math"}.get(
        str(practice_scope or "").strip().upper()
    )


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
    classroom, session: JournalLesson, *, block: str, resource_type: str, resource_id: int,
    actor, allow_unapproved: bool = False,
) -> tuple[ClassroomLessonGrant, bool]:
    """Open one item of a lesson plan to the class, right now.

    Returns ``(grant, created)``; ``created is False`` means it was already open, which
    the panel shows as "Given" rather than an error.
    """
    from access.resources import RT_ASSESSMENT_SET, RT_PRACTICE_TEST, RT_PRACTICE_TEST_PACK

    if resource_type not in (RT_ASSESSMENT_SET, RT_PRACTICE_TEST, RT_PRACTICE_TEST_PACK):
        raise DeliveryError("bad_resource_type", f"Cannot grant '{resource_type}' from a lesson.")
    # The item must be one the session actually declares — see plan_items().
    if (block, resource_type, int(resource_id)) not in plan_items(session):
        raise DeliveryError(
            "not_in_plan", "That item is not part of this lesson's plan."
        )

    delivery = _delivery_for(classroom, session)
    # The resource can have been deleted after the journal was authored (the plan stores
    # bare ids). Check before granting so a stale plan entry is a clean 400 rather than
    # an IntegrityError or a grant of something that no longer exists.
    _assert_resource_exists(resource_type, resource_id)
    if resource_type == RT_ASSESSMENT_SET:
        _assert_sets_approved([resource_id], allow_unapproved=allow_unapproved)

    # Lock the delivery row: two teachers (or a double-press) racing an unlocked
    # read-then-write both saw "not granted" and both inserted, turning the partial unique
    # constraint into a 500 instead of a no-op.
    delivery = ClassroomLesson.objects.select_for_update().get(pk=delivery.pk)
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
        from access.resources import expand_subject_targets

        students = _student_members(classroom)
        if not students:
            raise DeliveryError("no_students", "This class has no enrolled students yet.")

        # A PACK is not itself readable by a student: the gate is PracticeTest.assigned_users
        # on the pack's individual SECTIONS. Granting the pack id alone wrote a row nothing
        # reads, so the button reported success and the class got nothing. Expand first —
        # for a plain practice_test this returns the test unchanged.
        targets = expand_subject_targets(
            resource_type, resource_id, _pack_scope(session.practice_scope)
        )
        if not targets:
            raise DeliveryError(
                "empty_pack", "That pack has no sections for this class's subject."
            )
        # verify=True re-reads the live gate after writing and rolls back if any student
        # still can't see it — a button pressed in front of a class must fail loudly
        # rather than silently grant nothing.
        AssignmentService.bulk_assign_targets(
            students,
            targets,
            actor=actor,
            source=ResourceAccessGrant.SOURCE_CLASSROOM,
            classroom=classroom,
            note="journal lesson grant",
            verify=True,
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
    from datetime import timedelta

    from access.engine.assignment_service import AssignmentService
    from access.models import ResourceAccessGrant
    from access.resources import RT_MIDTERM_V2
    from classes.models_schedule import MidtermSchedule

    if not session.is_midterm or session.midterm_exam_id is None:
        raise DeliveryError("not_midterm", "This session has no midterm to grant.")

    delivery = _delivery_for(classroom, session)
    if delivery.midterm_schedule_id:
        return delivery, False

    # Grant per-student rather than via assign_resource_to_classroom: that helper's own
    # student list does not exclude REMOVED memberships, so a removed student would be
    # handed the exam. _student_members() is the roster that respects removal.
    students = _student_members(classroom)
    if not students:
        raise DeliveryError("no_students", "This class has no enrolled students yet.")
    AssignmentService.bulk_assign_resource(
        students,
        RT_MIDTERM_V2,
        session.midterm_exam_id,
        actor=actor,
        source=ResourceAccessGrant.SOURCE_CLASSROOM,
        classroom=classroom,
        note="journal midterm session",
    )

    # The admin authored "the class gets access N days before the session"; honour that as
    # the window start. The schedule owns the window — deliberately NOT grant.expires_at,
    # which would strip access from a student mid-attempt.
    starts_at = None
    if delivery.scheduled_for:
        starts_at = delivery.scheduled_for - timedelta(
            days=session.midterm_access_days_before or 0
        )
    # The one path allowed to create a schedule without a start time. Every teacher-facing
    # path (assign / panel PATCH / start-code) now rejects that, because a NULL starts_at is
    # a midterm open to the whole class; here the window is derived from the lesson, and a
    # journal session with no scheduled date has nothing to derive it from. The lesson grant
    # itself is what gates entry, so the class is not exposed by the missing start — and no
    # class email goes out from here either: this grant follows the lesson, not a dialog.
    schedule, created_schedule = MidtermSchedule.objects.get_or_create(
        classroom=classroom,
        midterm_id=session.midterm_exam_id,
        defaults={"starts_at": starts_at, "created_by": actor},
    )
    # get_or_create ignores `defaults` on an existing row, so a schedule created elsewhere
    # (e.g. assigned from the Midterms tab) silently discarded the authored window. Only
    # fill a start that is genuinely unset — never overwrite a window a teacher chose.
    if not created_schedule and schedule.starts_at is None and starts_at is not None:
        schedule.starts_at = starts_at
        schedule.save(update_fields=["starts_at", "updated_at"])
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
