"""Find the students whose pastpaper score is missing a Module 2 they never sat.

Background: until 2026-07-21 a retried Module 1 submit could land on the just-advanced
Module 2 and finalise it with Module 1's answers. The attempt went M1 → M2 → SCORING in
milliseconds, and the student was scored on half the paper. The cause is fixed (PR #68,
module-targeted submit); the **attempts already recorded that way were never repaired**, and
each one is a real student carrying a score lower than the work they did.

This command finds them. It does not repair them, on purpose — see "What it does NOT do".

    python manage.py audit_pastpaper_module2_skips
    python manage.py audit_pastpaper_module2_skips --max-seconds 60 --csv /tmp/skips.csv

## How an affected attempt is recognised

Two signals, reported separately because they carry different certainty:

**COPIED — Module 2's answers are keyed by Module 1's question ids.** This cannot happen any
other way: the runner only ever posts answers for the questions it is showing. It is the
signature of the exact bug and needs no judgement call.

**FAST — Module 2 lasted less than ``--max-seconds``.** Suggestive, not proof. A student who
opened Module 2 and immediately gave up looks the same from here, and that student was scored
correctly. Reported so somebody can look, not so somebody can act in bulk.

## What it does NOT do

It writes nothing. The remedy is a school decision and the options are not equivalent:
invalidate the attempt and let the student re-sit; rescale the Module 1 score; or leave the
record and note it. Nobody can invent a Module 2 the student never took, and a command that
silently picked one of those would be making a pedagogical choice in a script.
"""

from __future__ import annotations

import csv
import sys

from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from exams.models import Module, TestAttempt


class Command(BaseCommand):
    help = "Report completed 2-module pastpaper attempts whose Module 2 was never really taken."

    def add_arguments(self, parser):
        parser.add_argument(
            "--max-seconds",
            type=int,
            default=30,
            help="A Module 2 shorter than this is reported as FAST (default: 30).",
        )
        parser.add_argument(
            "--csv",
            dest="csv_path",
            help="Write the rows to this path as CSV as well as printing the summary.",
        )

    def handle(self, *args, **options):
        max_seconds = int(options["max_seconds"])
        csv_path = options.get("csv_path")

        # Standalone pastpapers only: mocks and midterms have their own runners and their own
        # module shapes, and the fix landed on both, but the historical damage reported here
        # was measured on pastpapers.
        two_module_test_ids = list(
            Module.objects.filter(practice_test__mock_exam__isnull=True)
            .values("practice_test_id")
            .annotate(n=Count("id"))
            .filter(n__gte=2)
            .values_list("practice_test_id", flat=True)
        )

        attempts = (
            TestAttempt.objects.filter(
                practice_test_id__in=two_module_test_ids,
                current_state=TestAttempt.STATE_COMPLETED,
                is_completed=True,
            )
            .select_related("student", "practice_test")
            .order_by("id")
        )

        rows = []
        scanned = 0
        for attempt in attempts.iterator(chunk_size=200):
            scanned += 1
            verdict = self._classify(attempt, max_seconds)
            if verdict is None:
                continue
            kind, seconds = verdict
            rows.append({
                "attempt_id": attempt.id,
                "student_id": attempt.student_id,
                "student": getattr(attempt.student, "email", "") or str(attempt.student_id),
                "practice_test_id": attempt.practice_test_id,
                "practice_test": attempt.practice_test.title or "",
                "score": attempt.score,
                "completed_at": attempt.completed_at.isoformat() if attempt.completed_at else "",
                "module_2_seconds": "" if seconds is None else round(seconds, 1),
                "signal": kind,
            })

        copied = [r for r in rows if r["signal"] == "COPIED"]
        fast = [r for r in rows if r["signal"] == "FAST"]

        self.stdout.write(f"Scanned {scanned} completed 2-module pastpaper attempt(s).")
        self.stdout.write(
            self.style.ERROR(f"  COPIED — Module 2 answered with Module 1's question ids: {len(copied)}")
            if copied
            else "  COPIED: 0"
        )
        self.stdout.write(f"  FAST   — Module 2 under {max_seconds}s (look, do not act in bulk): {len(fast)}")
        self.stdout.write(
            f"  Distinct students affected: {len({r['student_id'] for r in rows})}"
        )

        for r in copied[:20]:
            self.stdout.write(
                f"    attempt {r['attempt_id']} · student {r['student']} · "
                f"{r['practice_test']} · score {r['score']}"
            )
        if len(copied) > 20:
            self.stdout.write(f"    … and {len(copied) - 20} more (use --csv for the full list)")

        if csv_path:
            self._write_csv(csv_path, rows)
            self.stdout.write(self.style.SUCCESS(f"Wrote {len(rows)} row(s) to {csv_path}"))

        if rows:
            self.stdout.write("")
            self.stdout.write(
                "Nothing was changed. Deciding what these students are owed — a re-sit, a "
                "rescaled Module 1 score, or a note on the record — is the school's call, not "
                "this command's."
            )

    def _classify(self, attempt: TestAttempt, max_seconds: int):
        """``(signal, seconds)`` when the attempt looks affected, else ``None``."""
        answers = attempt.module_answers or {}
        if len(answers) < 2:
            return None

        modules = list(
            attempt.practice_test.modules.order_by("module_order").values_list("id", "module_order")
        )
        m1 = next((mid for mid, order in modules if order == 1), None)
        m2 = next((mid for mid, order in modules if order == 2), None)
        if m1 is None or m2 is None:
            return None

        m1_answers = answers.get(str(m1)) or {}
        m2_answers = answers.get(str(m2)) or {}

        seconds = None
        if attempt.module_2_started_at and attempt.module_2_submitted_at:
            seconds = (attempt.module_2_submitted_at - attempt.module_2_started_at).total_seconds()

        # The signature: Module 2's answer keys belong to Module 1's questions. The runner only
        # ever posts answers for the questions it is showing, so there is no honest path here.
        if m2_answers:
            m2_question_ids = {
                str(qid) for qid in attempt.practice_test.modules.get(pk=m2).questions.values_list("id", flat=True)
            }
            keys = set(m2_answers.keys())
            if keys and not (keys & m2_question_ids):
                return ("COPIED", seconds)

        if seconds is not None and seconds < max_seconds:
            return ("FAST", seconds)
        return None

    def _write_csv(self, path: str, rows: list[dict]) -> None:
        fields = [
            "attempt_id", "student_id", "student", "practice_test_id", "practice_test",
            "score", "completed_at", "module_2_seconds", "signal",
        ]
        handle = sys.stdout if path == "-" else open(path, "w", newline="", encoding="utf-8")
        try:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        finally:
            if handle is not sys.stdout:
                handle.close()
