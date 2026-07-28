"""Reaper for stranded midterm attempts.

A midterm attempt only ever moves when a REQUEST arrives: the runner autosaves, hits its
deadline and submits. If the student closes the tab (or their laptop dies, or the class ends)
the attempt just sits there — ACTIVE or MODULE_2_ACTIVE with a long-expired clock. It never
reaches SCORING, never scores, and because of ``uniq_active_midterm_attempt_per_student`` it
also blocks that student from ever starting the midterm again.

That is not hypothetical: after a two-module cutover, fifteen students who never reloaded the
page were left sitting in MODULE_2_ACTIVE with an expired timer and no score at all.

This command finds attempts whose CURRENT module's deadline passed long ago and fast-forwards
them to completion. Unanswered questions grade as omitted, which is the correct outcome for a
timed-out paper — and for a two-module midterm it drains module 1 -> module 2 -> SCORING, so a
student stranded mid-module-1 still gets both modules graded.

Run periodically on prod (cron / Celery beat):

    python manage.py sweep_midterm_attempts                      # grace 30 min
    python manage.py sweep_midterm_attempts --grace-minutes 15 --dry-run
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from midterms.models import MidtermAttempt
from midterms.state_machine import (
    STATE_ABANDONED,
    STATE_COMPLETED,
    STATE_NOT_STARTED,
    STATE_SCORING,
)
from midterms.tasks import enqueue_midterm_scoring


class Command(BaseCommand):
    help = "Force-close stranded midterm attempts whose module deadline long passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--grace-minutes",
            type=int,
            default=30,
            help="Only reap an attempt whose current module is expired by at least this many minutes.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be reaped without changing anything.",
        )
        parser.add_argument(
            "--midterm-id",
            type=int,
            default=None,
            help="Restrict the sweep to a single midterm (useful for a targeted remediation).",
        )

    def handle(self, *args, **opts):
        grace = int(opts["grace_minutes"]) * 60
        dry = bool(opts["dry_run"])
        midterm_id = opts.get("midterm_id")

        qs = MidtermAttempt.objects.filter(is_completed=False).exclude(current_state=STATE_ABANDONED)
        if midterm_id:
            qs = qs.filter(midterm_id=midterm_id)
        candidate_ids = list(qs.values_list("pk", flat=True))

        reaped = 0
        needs_scoring: list[int] = []
        for att_id in candidate_ids:
            with transaction.atomic():
                # NEVER select_related the nullable question_module here — Postgres rejects
                # SELECT ... FOR UPDATE on the nullable side of an outer join.
                att = MidtermAttempt.objects.select_for_update().select_related("midterm").get(pk=att_id)
                if not self._is_stranded(att, grace):
                    continue
                if dry:
                    self.stdout.write(
                        f"[dry-run] would reap attempt {att.pk} "
                        f"(midterm={att.midterm_id} state={att.current_state})"
                    )
                    reaped += 1
                    continue
                self._drain(att)
                reaped += 1
                if att.current_state == STATE_SCORING:
                    needs_scoring.append(att.pk)

        # Score outside the row lock (runs synchronously when no broker is configured).
        for att_id in needs_scoring:
            enqueue_midterm_scoring(attempt_id=att_id, request=None)

        verb = "Would reap" if dry else "Reaped"
        self.stdout.write(self.style.SUCCESS(f"{verb} {reaped} stranded midterm attempt(s)."))

    @staticmethod
    def _is_stranded(att, grace: int) -> bool:
        state = att.current_state
        if state == STATE_SCORING:
            return True  # stuck before scoring finished — finish it
        if state == STATE_NOT_STARTED:
            return False  # the student never began; never force-start them
        timing = att.get_timing()
        if not timing or not timing.is_expired:
            return False
        # remaining_seconds is clamped at 0, so measure lateness via elapsed vs limit.
        return (timing.elapsed_seconds - timing.limit_seconds) >= grace

    @staticmethod
    def _drain(att) -> None:
        """Fast-forward to SCORING, hop by hop (module 1 -> module 2 -> SCORING).

        Late answers are NEVER accepted here: whatever the student autosaved before they
        vanished is what gets graded. Bounded loop — the chain is at most two hops.
        """
        for _ in range(4):
            if att.current_state in (STATE_SCORING, STATE_COMPLETED, STATE_ABANDONED, STATE_NOT_STARTED):
                break
            if not att.submit(answers=None, flagged=None):
                break
