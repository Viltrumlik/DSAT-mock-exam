"""Journal business logic: provisioning, duplication, publishing, audit, and the
future classroom-release seam."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from . import structure
from .models import (
    Journal,
    JournalAuditEvent,
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


@transaction.atomic
def create_journal(*, subject: str, level: str, actor, title: str = "") -> tuple[Journal, bool]:
    """Create a Journal for (subject, level) and auto-provision its fixed lesson slots.

    Idempotent: if the journal already exists it is returned untouched (created=False).
    Raises ``structure.InvalidCourse`` for an impossible pair (e.g. English + Foundation).
    """
    subject = str(subject or "").upper()
    level = str(level or "").lower()
    plan = structure.lesson_plan(subject, level)  # validates the pair

    existing = Journal.objects.filter(subject=subject, level=level).first()
    if existing is not None:
        return existing, False

    journal = Journal.objects.create(
        subject=subject,
        level=level,
        title=title or "",
        duration_months=structure.months_for(subject, level),
        total_lessons=len(plan),
        created_by=actor,
        updated_by=actor,
    )
    JournalLesson.objects.bulk_create(
        [
            JournalLesson(journal=journal, lesson_number=n, lesson_type=t)
            for (n, t) in plan
        ]
    )
    log_event(journal, actor, "created", {"total_lessons": len(plan)})
    return journal, True


def publish_journal(journal: Journal, actor) -> dict:
    """Publish a journal iff every HOMEWORK lesson is ready.

    Returns ``{"ok": bool, "blocking_lessons": [...]}``. On success, publishes the
    journal and all its homework lessons.
    """
    lessons = list(
        journal.lessons.all().prefetch_related("assessments", "extra_attachments")
    )
    homework = [l for l in lessons if not l.is_midterm]
    blocking = [
        {"lesson_number": l.lesson_number, "reasons": l.validation_reasons()}
        for l in homework
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
        for l in homework:
            if l.status != JournalLesson.STATUS_PUBLISHED:
                l.status = JournalLesson.STATUS_PUBLISHED
                l.published_at = now
                l.save(update_fields=["status", "published_at", "updated_at"])
        log_event(journal, actor, "published", {"lessons": len(homework)})
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
    log_event(journal, actor, {"ARCHIVED": "archived", "DRAFT": "drafted"}.get(status, "status_changed"))
    return journal


@transaction.atomic
def duplicate_journal(source: Journal, *, target_subject: str, target_level: str, actor) -> tuple[Journal, dict]:
    """Copy homework content from ``source`` into the (target_subject, target_level) journal.

    Creates the target journal (with its own auto-provisioned slots) if missing. Copies
    lesson content only where the same lesson_number exists in the target and both lessons
    are HOMEWORK type. Uploaded files are NOT copied (assessment links + past-paper ids +
    text fields are). Returns (target_journal, report).
    """
    target, _created = create_journal(
        subject=target_subject, level=target_level, actor=actor
    )
    if target.id == source.id:
        raise ValueError("Cannot duplicate a journal onto itself.")

    src_lessons = {l.lesson_number: l for l in source.lessons.prefetch_related("assessments")}
    copied, skipped = 0, 0
    for tgt in target.lessons.all():
        src = src_lessons.get(tgt.lesson_number)
        if src is None or src.is_midterm or tgt.is_midterm:
            skipped += 1
            continue
        tgt.title = src.title
        tgt.instructions = src.instructions
        tgt.external_url = src.external_url
        tgt.allow_file_upload = src.allow_file_upload
        tgt.practice_scope = src.practice_scope
        tgt.practice_test_ids = src.practice_test_ids
        tgt.practice_test_pack_ids = src.practice_test_pack_ids
        tgt.category = src.category
        tgt.max_score = src.max_score
        tgt.due_after_days = src.due_after_days
        tgt.deadline_time = src.deadline_time
        tgt.status = JournalLesson.STATUS_DRAFT
        tgt.published_at = None
        tgt.save()
        # Re-point assessment links (skip dupes).
        existing = set(tgt.assessments.values_list("assessment_set_id", flat=True))
        for link in src.assessments.all():
            if link.assessment_set_id in existing:
                continue
            JournalLessonAssessment.objects.create(
                lesson=tgt, assessment_set_id=link.assessment_set_id, added_by=actor
            )
        copied += 1

    report = {"copied": copied, "skipped": skipped, "files_copied": False}
    log_event(
        target,
        actor,
        "duplicated",
        {"from_journal": source.id, **report},
    )
    return target, report


def release_lesson_into_classroom(lesson: JournalLesson, classroom, lesson_date):
    """FUTURE (NOT IMPLEMENTED): materialize a JournalLesson into a live classroom homework.

    When classroom auto-journal is built, this is the single seam it will call. It would:
      * build a ``classes.Assignment`` from the lesson's homework fields,
      * set ``due_at = combine(lesson_date + due_after_days, deadline_time)``,
      * copy ``practice_test_ids`` / ``practice_test_pack_ids`` / ``practice_scope`` / files,
      * for each ``JournalLessonAssessment`` call
        ``assessments.domain.homework_versioning.ensure_current_version(...)`` and create an
        ``assessments.HomeworkAssignment`` pinned to that version.

    Deliberately unwired for now — the Journal module only authors templates.
    """
    raise NotImplementedError("Classroom auto-release from a Journal is not implemented yet.")
