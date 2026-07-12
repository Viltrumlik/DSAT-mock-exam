"""Refresh every midterm mirror (midterms.Midterm) from its live legacy builder source.

The mirror now syncs questions IN PLACE (preserving Question.id so attempt answers survive),
so this is safe to run against production even with existing attempts. Use it once after
deploying the live-content change to un-freeze mirrors that were locked with a stale question
copy (e.g. questions added after publish, or after an attempt existed).

    python manage.py resync_midterm_mirrors            # DRY-RUN (default; reports drift only)
    python manage.py resync_midterm_mirrors --commit   # apply the refresh
    python manage.py resync_midterm_mirrors --commit --only-mock-exam-id 11
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Re-mirror all (or one) legacy midterm MockExams into midterms.Midterm, live and in place."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Apply changes (default: dry-run).")
        parser.add_argument("--only-mock-exam-id", type=int, default=None)

    def handle(self, *args, **opts):
        from exams.models import MockExam
        from midterms.models import Midterm
        from midterms.sync import upsert_midterm_from_legacy

        commit = opts["commit"]
        only = opts["only_mock_exam_id"]

        qs = MockExam.objects.filter(kind=MockExam.KIND_MIDTERM).order_by("id")
        if only is not None:
            qs = qs.filter(pk=only)

        self.stdout.write(f"{'COMMIT' if commit else 'DRY-RUN'} — {qs.count()} midterm MockExam(s)")
        changed = 0

        for exam in qs:
            mirror = Midterm.objects.filter(legacy_mock_exam_id=exam.id).first()
            before = mirror.display_question_count() if mirror else None
            live = self._live_count(exam)

            def _do():
                return upsert_midterm_from_legacy(exam, sync_questions=True)

            if commit:
                with transaction.atomic():
                    m = _do()
                after = m.display_question_count() if m else None
            else:
                # Dry-run: report the drift without writing.
                after = live

            drift = "" if before == after else f"  <-- COUNT {before} -> {after}"
            if before != after:
                changed += 1
            self.stdout.write(
                f"  MockExam#{exam.id} {exam.title!r} live={live} mirror_before={before} mirror_after={after}{drift}"
            )

        total = qs.count()
        if commit:
            self.stdout.write(self.style.SUCCESS(
                f"Done. Refreshed {total} mirror(s) in place ({changed} had a question-COUNT change; "
                f"content is refreshed for all regardless)."
            ))
        else:
            # Dry-run compares COUNTS only — a content-only fix (same count, e.g. a corrected
            # answer key) won't show as drift here but IS refreshed by --commit. Never read a
            # zero count-drift as "nothing to do".
            self.stdout.write(self.style.WARNING(
                f"DRY-RUN: {changed} mirror(s) have a question-COUNT drift. This does NOT capture "
                f"content-only edits — run with --commit to refresh all {total} mirror(s) in place."
            ))

    @staticmethod
    def _live_count(exam) -> int:
        """Per-version live count (versions are equal-length parallel forms) or flat live count."""
        pts = list(exam.tests.all().order_by("id"))
        from exams.models import Question

        if len(pts) >= 2:
            first = pts[0]
            return Question.objects.filter(module__practice_test=first).count()
        return Question.objects.filter(module__practice_test__mock_exam=exam).count()
