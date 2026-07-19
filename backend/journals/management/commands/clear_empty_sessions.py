"""Remove pre-provisioned EMPTY sessions from journals.

Journals used to auto-provision every lesson slot. They no longer do — an admin adds
sessions explicitly. This command cleans up the leftover auto-provisioned slots.

It only deletes a session when NOTHING has been authored on it (no homework brief or
content, no classwork content, no midterm chosen), so real work is never lost. Remaining
sessions are renumbered contiguously.

    python manage.py clear_empty_sessions            # dry run — shows what would go
    python manage.py clear_empty_sessions --apply    # actually delete
    python manage.py clear_empty_sessions --apply --journal 1
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from journals.models import Journal, JournalLesson


def _is_empty(lesson: JournalLesson) -> bool:
    """True when a session carries no authored content at all."""
    if lesson.is_midterm:
        return lesson.midterm_exam_id is None
    if (lesson.title or "").strip() or (lesson.instructions or "").strip():
        return False
    if (lesson.external_url or "").strip() or lesson.attachment_file:
        return False
    if lesson.allow_file_upload:
        return False
    if lesson.practice_test_ids or lesson.practice_test_pack_ids:
        return False
    if lesson.assessments.exists() or lesson.extra_attachments.exists():
        return False
    cw = getattr(lesson, "classwork", None)
    if cw is not None:
        if (cw.new_topic_title or "").strip() or (cw.new_topic_instructions or "").strip():
            return False
        if (cw.new_topic_external_url or "").strip() or cw.new_topic_attachment_file:
            return False
        if (cw.revision_notes or "").strip():
            return False
        if (
            cw.new_topic_practice_test_ids
            or cw.new_topic_practice_test_pack_ids
            or cw.exercise_practice_test_ids
            or cw.exercise_practice_test_pack_ids
        ):
            return False
        if cw.assessments.exists() or cw.extra_attachments.exists():
            return False
    return True


class Command(BaseCommand):
    help = "Delete leftover auto-provisioned EMPTY journal sessions (dry run by default)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Actually delete.")
        parser.add_argument("--journal", type=int, default=None, help="Limit to one journal id.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        journals = Journal.objects.all()
        if options["journal"]:
            journals = journals.filter(pk=options["journal"])

        total_removed = 0
        for journal in journals.prefetch_related("lessons__classwork"):
            lessons = list(journal.lessons.order_by("lesson_number"))
            empty = [l for l in lessons if _is_empty(l)]
            kept = len(lessons) - len(empty)
            if not empty:
                self.stdout.write(f"{journal.display_title}: nothing to remove ({kept} sessions)")
                continue

            self.stdout.write(
                self.style.WARNING(
                    f"{journal.display_title}: {len(empty)} empty session(s) "
                    f"-> would keep {kept}"
                )
                if not apply_changes
                else self.style.SUCCESS(
                    f"{journal.display_title}: removing {len(empty)} empty session(s), keeping {kept}"
                )
            )
            if not apply_changes:
                continue

            with transaction.atomic():
                JournalLesson.objects.filter(pk__in=[l.pk for l in empty]).delete()
                # Explicit queryset: journal.lessons.* would answer from the stale
                # prefetch cache populated before the delete.
                remaining = JournalLesson.objects.filter(journal_id=journal.pk).order_by(
                    "lesson_number"
                )
                for idx, l in enumerate(remaining, start=1):
                    if l.lesson_number != idx:
                        l.lesson_number = idx
                        l.save(update_fields=["lesson_number"])
                journal.total_lessons = JournalLesson.objects.filter(
                    journal_id=journal.pk
                ).count()
                journal.save(update_fields=["total_lessons", "updated_at"])
            total_removed += len(empty)

        if apply_changes:
            self.stdout.write(self.style.SUCCESS(f"Done. Removed {total_removed} empty session(s)."))
        else:
            self.stdout.write("Dry run — re-run with --apply to delete.")
