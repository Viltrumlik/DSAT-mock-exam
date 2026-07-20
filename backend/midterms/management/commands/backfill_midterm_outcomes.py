"""Backfill pass/fail verdicts and per-question results for midterms sat BEFORE this feature.

Both ``MidtermOutcome`` and ``MidtermQuestionResult`` are written by ``MidtermAttempt.complete()``,
so every attempt completed before that code shipped has neither. Two visible consequences:

* A retake is unusable by the exact cohort it exists for. ``retake_eligibility`` reads the
  parent's verdict; with no row it returns ``retake_no_result`` and 403s every student who
  actually failed — the retake looks broken to the whole class.
* The error report shows nothing. Worse, an empty breakdown reads as a *perfect* paper, so a
  student who scored 38/100 could be told they missed nothing.

Idempotent and safe to re-run. By default it will NOT overwrite a verdict that already exists,
because a stored verdict freezes the pass mark that was in force when the student sat the paper
and re-deriving it against today's pass mark is precisely the retroactive re-judging the model
was built to prevent. ``--rejudge`` opts into that, deliberately.

Usage:
    python manage.py backfill_midterm_outcomes --dry-run
    python manage.py backfill_midterm_outcomes
    python manage.py backfill_midterm_outcomes --midterm 12
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from midterms.models import Midterm, MidtermAttempt, MidtermOutcome, MidtermQuestionResult


class Command(BaseCommand):
    help = "Backfill MidtermOutcome + MidtermQuestionResult rows for already-completed attempts."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")
        parser.add_argument("--midterm", type=int, default=None, help="Limit to one midterm id.")
        parser.add_argument(
            "--rejudge",
            action="store_true",
            help="Also rewrite verdicts that already exist (re-judges against TODAY's pass mark).",
        )
        parser.add_argument(
            "--skip-questions",
            action="store_true",
            help="Backfill verdicts only; leave per-question results alone.",
        )

    def handle(self, *args, **options):
        dry = bool(options["dry_run"])
        rejudge = bool(options["rejudge"])
        skip_questions = bool(options["skip_questions"])

        attempts = (
            MidtermAttempt.objects.filter(is_completed=True, score__isnull=False)
            .select_related("midterm")
            .order_by("pk")
        )
        if options["midterm"]:
            attempts = attempts.filter(midterm_id=options["midterm"])

        stats = {
            "attempts_seen": 0,
            "outcomes_created": 0,
            "outcomes_skipped_existing": 0,
            "outcomes_skipped_pre_midterm": 0,
            "questions_frozen": 0,
            "question_rows_written": 0,
            "questions_skipped_existing": 0,
            "questions_unavailable": 0,
        }

        for attempt in attempts.iterator():
            stats["attempts_seen"] += 1
            midterm = attempt.midterm

            # ── verdict ──────────────────────────────────────────────────────
            if not midterm.is_graded:
                # A pre-midterm is a diagnostic; it has no verdict to give.
                stats["outcomes_skipped_pre_midterm"] += 1
            else:
                exists = MidtermOutcome.objects.filter(
                    midterm_id=midterm.pk, student_id=attempt.student_id
                ).exists()
                if exists and not rejudge:
                    stats["outcomes_skipped_existing"] += 1
                elif not dry:
                    with transaction.atomic():
                        MidtermOutcome.record_for(attempt)
                    stats["outcomes_created"] += 1
                else:
                    stats["outcomes_created"] += 1

            # ── per-question breakdown ───────────────────────────────────────
            if skip_questions:
                continue
            if MidtermQuestionResult.objects.filter(attempt_id=attempt.pk).exists():
                stats["questions_skipped_existing"] += 1
                continue
            # The question set is resolved live, so a midterm whose builder content was
            # since emptied can no longer be broken down. Count it rather than writing a
            # zero-row breakdown, which would render as a flawless paper.
            question_count = len(list(attempt.effective_questions()))
            if question_count == 0:
                stats["questions_unavailable"] += 1
                continue
            if not dry:
                with transaction.atomic():
                    written = MidtermQuestionResult.freeze_for(attempt)
            else:
                written = question_count
            stats["questions_frozen"] += 1
            stats["question_rows_written"] += written

        label = "DRY-RUN (nothing written)" if dry else "DONE (committed)"
        self.stdout.write(f"Scope: {stats['attempts_seen']} completed attempt(s)")
        for key in sorted(stats):
            if key != "attempts_seen":
                self.stdout.write(f"  {key}: {stats[key]}")
        if stats["questions_unavailable"]:
            self.stdout.write(
                self.style.WARNING(
                    f"  ^ {stats['questions_unavailable']} attempt(s) have no resolvable questions left; "
                    "their error report will report 'not analysed' rather than a clean paper."
                )
            )
        self.stdout.write(self.style.SUCCESS(label))

        # Surface what is still blocking a retake, since that is the usual reason to run this.
        # Written as an explicit per-row check rather than an ``exclude`` across the reverse
        # relation: excluding on a multi-valued join drops a retake as soon as its parent has
        # ANY verdict, which is the opposite of the question being asked.
        retakes = Midterm.objects.filter(
            midterm_type=Midterm.TYPE_RETAKE, retake_of__isnull=False
        ).values_list("id", "title", "retake_of_id")
        for mid, title, parent_id in retakes:
            if not MidtermOutcome.objects.filter(midterm_id=parent_id).exists():
                self.stdout.write(
                    self.style.WARNING(
                        f"  retake #{mid} '{title}' still has NO verdicts on its parent — nobody can sit it."
                    )
                )
