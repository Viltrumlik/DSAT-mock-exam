"""Copy `level` from the legacy exams.MockExam onto its midterms.Midterm mirror.

WHY: the teacher classroom picker scopes midterms by the classroom's level, reading
``Midterm.level``. Several mirrors were created before ``level`` was synced (and were
deliberately never re-mirrored, so an in-flight answer-key fix couldn't be clobbered by a
full ``resync_midterm_mirrors``), leaving ``level=''`` while the legacy MockExam has the
correct tier. A blank mirror level hides that midterm from EVERY leveled classroom.

This command touches ONE scalar field (`level`) keyed on ``Midterm.legacy_mock_exam_id``.
It never re-mirrors questions, so answer keys / question ids are untouched — the reason a
full resync was avoided.

    python manage.py backfill_midterm_levels                 # dry-run (default)
    python manage.py backfill_midterm_levels --commit
    python manage.py backfill_midterm_levels --commit --overwrite   # mirror legacy verbatim
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from exams.models import MockExam
from midterms.models import Midterm


class Command(BaseCommand):
    help = "Backfill midterms.Midterm.level from the legacy exams.MockExam.midterm_level."

    def add_arguments(self, parser):
        parser.add_argument(
            "--commit", action="store_true",
            help="Apply the changes. Without it the command only reports (dry-run).",
        )
        parser.add_argument(
            "--overwrite", action="store_true",
            help="Also correct mirrors whose level differs from legacy. Default: fill blanks only.",
        )

    def handle(self, *args, **opts):
        commit = bool(opts["commit"])
        overwrite = bool(opts["overwrite"])

        legacy_level = dict(
            MockExam.objects.filter(kind=MockExam.KIND_MIDTERM)
            .values_list("id", "midterm_level")
        )

        planned: list[tuple[Midterm, str, str]] = []
        skipped_no_legacy = 0
        for mt in Midterm.objects.exclude(legacy_mock_exam_id=None).order_by("id"):
            want = (legacy_level.get(mt.legacy_mock_exam_id) or "").strip()
            have = (mt.level or "").strip()
            if not want:
                continue  # legacy itself is untagged — nothing authoritative to copy
            if have == want:
                continue
            if have and not overwrite:
                self.stdout.write(
                    f"  differs (kept, use --overwrite): Midterm#{mt.id} {have!r} != legacy {want!r} — {mt.title[:40]}"
                )
                continue
            planned.append((mt, have, want))

        skipped_no_legacy = Midterm.objects.filter(legacy_mock_exam_id=None).count()

        for mt, have, want in planned:
            self.stdout.write(f"  Midterm#{mt.id} {have!r} -> {want!r}  {mt.title[:48]}")

        if not planned:
            self.stdout.write(self.style.SUCCESS("Nothing to backfill — every mirror already matches legacy."))
            return

        if not commit:
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] would update {len(planned)} midterm(s). Re-run with --commit to apply."
                )
            )
            return

        with transaction.atomic():
            for mt, _have, want in planned:
                Midterm.objects.filter(pk=mt.pk).update(level=want)

        self.stdout.write(
            self.style.SUCCESS(
                f"Backfilled level on {len(planned)} midterm(s). "
                f"({skipped_no_legacy} mirror(s) have no legacy anchor and were skipped.)"
            )
        )
