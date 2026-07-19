"""Journal business logic: session management, duplication, publishing, audit, and the
future classroom-release seam.

Sessions are NOT pre-provisioned. A journal starts empty and the admin appends sessions
explicitly ("New session"), choosing how many lessons and how many midterms the course has.
``structure.py`` still describes the *recommended* shape (12 lessons/month, midterm every
12th) and is surfaced as a hint only.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from . import structure
from .models import (
    Journal,
    JournalAuditEvent,
    JournalClasswork,
    JournalClassworkAssessment,
    JournalLesson,
    JournalLessonAssessment,
)


def log_event(journal, actor, event_type, detail=None, lesson=None) -> JournalAuditEvent:
    return JournalAuditEvent.objects.create(
        journal=journal,
        lesson=lesson,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        event_type=event_type,
        detail=detail or {},
    )


def _sync_counts(journal: Journal, actor=None) -> None:
    # Explicit queryset, NOT journal.lessons.count(): on a prefetched journal the related
    # manager answers .count() from the (now stale) prefetch cache, which would persist a
    # wrong total after adding/removing sessions.
    journal.total_lessons = JournalLesson.objects.filter(journal_id=journal.pk).count()
    fields = ["total_lessons", "updated_at"]
    if actor is not None and getattr(actor, "is_authenticated", False):
        journal.updated_by = actor
        fields.append("updated_by")
    journal.save(update_fields=fields)


def ensure_classwork(lesson: JournalLesson) -> JournalClasswork | None:
    """Classwork exists for every HOMEWORK session (lazily created for legacy rows)."""
    if lesson.is_midterm:
        return None
    cw = getattr(lesson, "classwork", None)
    if cw is None:
        cw = JournalClasswork.objects.create(lesson=lesson)
    return cw


@transaction.atomic
def create_journal(*, subject: str, level: str, actor, title: str = "") -> tuple[Journal, bool]:
    """Create an EMPTY journal for (subject, level).

    Sessions are added explicitly afterwards via :func:`add_session` — nothing is
    pre-provisioned. Idempotent: an existing journal is returned untouched.
    Raises ``structure.InvalidCourse`` for an impossible pair (e.g. English + Foundation).
    """
    subject = str(subject or "").upper()
    level = str(level or "").lower()
    if not structure.is_valid_course(subject, level):
        raise structure.InvalidCourse(
            f"No course exists for subject={subject!r} level={level!r} "
            f"(English has no Foundation)."
        )

    existing = Journal.objects.filter(subject=subject, level=level).first()
    if existing is not None:
        return existing, False

    journal = Journal.objects.create(
        subject=subject,
        level=level,
        title=title or "",
        # Recommended duration only — the admin controls the real session count.
        duration_months=structure.months_for(subject, level),
        total_lessons=0,
        created_by=actor,
        updated_by=actor,
    )
    log_event(journal, actor, "created", {})
    return journal, True


@transaction.atomic
def add_session(
    journal: Journal,
    *,
    actor,
    lesson_type: str = JournalLesson.TYPE_HOMEWORK,
    midterm_exam=None,
) -> JournalLesson:
    """Append a new session to the journal.

    A HOMEWORK session is created with an empty homework brief AND an empty classwork
    plan, so the admin can fill either side. A MIDTERM session carries the chosen midterm
    exam and has no homework/classwork.
    """
    lesson_type = (lesson_type or JournalLesson.TYPE_HOMEWORK).upper()
    if lesson_type not in (JournalLesson.TYPE_HOMEWORK, JournalLesson.TYPE_MIDTERM):
        raise ValueError(f"Unknown session type {lesson_type!r}")

    next_number = (
        journal.lessons.aggregate(m=Max("lesson_number"))["m"] or 0
    ) + 1
    lesson = JournalLesson.objects.create(
        journal=journal,
        lesson_number=next_number,
        lesson_type=lesson_type,
        midterm_exam=midterm_exam if lesson_type == JournalLesson.TYPE_MIDTERM else None,
    )
    if lesson_type == JournalLesson.TYPE_HOMEWORK:
        JournalClasswork.objects.create(lesson=lesson)

    _sync_counts(journal, actor)
    log_event(
        journal,
        actor,
        "session_added",
        {"lesson_number": next_number, "type": lesson_type},
        lesson=lesson,
    )
    return lesson


@transaction.atomic
def delete_session(journal: Journal, lesson: JournalLesson, actor) -> None:
    """Remove a session and renumber the rest so numbering stays contiguous 1..N.

    Renumbering only ever shifts numbers DOWN into the freed gap, so the
    (journal, lesson_number) unique constraint can't be transiently violated.
    """
    number = lesson.lesson_number
    lesson.delete()
    for idx, l in enumerate(journal.lessons.order_by("lesson_number"), start=1):
        if l.lesson_number != idx:
            l.lesson_number = idx
            l.save(update_fields=["lesson_number"])
    _sync_counts(journal, actor)
    log_event(journal, actor, "session_removed", {"lesson_number": number})


def publish_journal(journal: Journal, actor) -> dict:
    """Publish a journal iff every session is ready.

    Returns ``{"ok": bool, "blocking_lessons": [...]}``. On success, publishes the
    journal and all its sessions.
    """
    lessons = list(
        journal.lessons.all().prefetch_related(
            "assessments", "extra_attachments", "classwork__assessments"
        )
    )
    if not lessons:
        return {
            "ok": False,
            "blocking_lessons": [],
            "detail": "Journal has no sessions yet.",
        }

    blocking = [
        {"lesson_number": l.lesson_number, "reasons": l.validation_reasons()}
        for l in lessons
        if not l.is_ready
    ]
    if blocking:
        return {"ok": False, "blocking_lessons": blocking}

    now = timezone.now()
    with transaction.atomic():
        journal.status = Journal.STATUS_PUBLISHED
        journal.published_at = now
        journal.archived_at = None
        journal.updated_by = actor
        journal.save(
            update_fields=["status", "published_at", "archived_at", "updated_by", "updated_at"]
        )
        for l in lessons:
            if l.status != JournalLesson.STATUS_PUBLISHED:
                l.status = JournalLesson.STATUS_PUBLISHED
                l.published_at = now
                l.save(update_fields=["status", "published_at", "updated_at"])
        log_event(journal, actor, "published", {"sessions": len(lessons)})
    return {"ok": True, "blocking_lessons": []}


def set_journal_status(journal: Journal, status: str, actor) -> Journal:
    """Move a journal to DRAFT / ARCHIVED (publish has its own validated path)."""
    now = timezone.now()
    journal.status = status
    journal.updated_by = actor
    if status == Journal.STATUS_ARCHIVED:
        journal.archived_at = now
    elif status == Journal.STATUS_DRAFT:
        journal.archived_at = None
    journal.save(update_fields=["status", "archived_at", "updated_by", "updated_at"])
    log_event(
        journal,
        actor,
        {"ARCHIVED": "archived", "DRAFT": "drafted"}.get(status, "status_changed"),
    )
    return journal


@transaction.atomic
def duplicate_journal(
    source: Journal, *, target_subject: str, target_level: str, actor
) -> tuple[Journal, dict]:
    """Copy every session of ``source`` into the (target_subject, target_level) journal.

    Creates the target journal if missing. The target must have no sessions yet.
    Uploaded files are NOT copied (assessment links, past-paper ids, text and durations are).
    """
    target, _created = create_journal(subject=target_subject, level=target_level, actor=actor)
    if target.id == source.id:
        raise ValueError("Cannot duplicate a journal onto itself.")
    if target.lessons.exists():
        raise ValueError(
            f"{target.display_title} already has sessions — clear it before duplicating into it."
        )

    src_lessons = source.lessons.order_by("lesson_number").prefetch_related(
        "assessments", "classwork__assessments"
    )
    copied = 0
    for src in src_lessons:
        lesson = add_session(
            target,
            actor=actor,
            lesson_type=src.lesson_type,
            midterm_exam=src.midterm_exam,
        )
        if src.is_midterm:
            lesson.midterm_access_days_before = src.midterm_access_days_before
            lesson.save(update_fields=["midterm_access_days_before"])
            copied += 1
            continue

        # Homework brief
        lesson.title = src.title
        lesson.instructions = src.instructions
        lesson.external_url = src.external_url
        lesson.allow_file_upload = src.allow_file_upload
        lesson.practice_scope = src.practice_scope
        lesson.practice_test_ids = src.practice_test_ids
        lesson.practice_test_pack_ids = src.practice_test_pack_ids
        lesson.category = src.category
        lesson.max_score = src.max_score
        lesson.save()
        for link in src.assessments.all():
            JournalLessonAssessment.objects.create(
                lesson=lesson, assessment_set_id=link.assessment_set_id, added_by=actor
            )

        # Classwork plan
        src_cw = getattr(src, "classwork", None)
        if src_cw is not None:
            cw = ensure_classwork(lesson)
            for f in (
                "homework_review_minutes",
                "new_topic_minutes",
                "break_minutes",
                "exercises_minutes",
                "revision_minutes",
                "new_topic_title",
                "new_topic_instructions",
                "new_topic_external_url",
                "new_topic_practice_test_ids",
                "new_topic_practice_test_pack_ids",
                "exercise_practice_test_ids",
                "exercise_practice_test_pack_ids",
                "revision_notes",
            ):
                setattr(cw, f, getattr(src_cw, f))
            cw.save()
            for link in src_cw.assessments.all():
                JournalClassworkAssessment.objects.create(
                    classwork=cw,
                    assessment_set_id=link.assessment_set_id,
                    block=link.block,
                    added_by=actor,
                )
        copied += 1

    report = {"copied": copied, "files_copied": False}
    log_event(target, actor, "duplicated", {"from_journal": source.id, **report})
    return target, report


def release_lesson_into_classroom(lesson: JournalLesson, classroom, lesson_date):
    """FUTURE (NOT IMPLEMENTED): materialize a journal session into a live classroom.

    When classroom auto-journal is built, this is the single seam it will call. It would:
      * build a ``classes.Assignment`` from the session's homework brief,
      * set ``due_at`` to the START of the classroom's NEXT lesson after ``lesson_date``
        (``classes.schedule.next_lesson_start_after``) — or leave it null if there is no
        next lesson,
      * copy ``practice_test_ids`` / ``practice_test_pack_ids`` / ``practice_scope`` / files,
      * for each ``JournalLessonAssessment`` call
        ``assessments.domain.homework_versioning.ensure_current_version(...)`` and create an
        ``assessments.HomeworkAssignment`` pinned to that version,
      * materialize the ``JournalClasswork`` plan for the teacher's Classwork tab, and
      * for a MIDTERM session, grant the classroom access to ``lesson.midterm_exam``
        ``lesson.midterm_access_days_before`` days ahead, scheduled at ``lesson_date``'s
        lesson time.

    Deliberately unwired for now — the Journal module only authors templates.
    """
    raise NotImplementedError("Classroom auto-release from a Journal is not implemented yet.")
