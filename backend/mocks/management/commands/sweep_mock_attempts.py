"""Reaper for stranded full-mock attempts.

Open-practice mocks never pause and there is no Celery beat, so an attempt whose
student closed the tab mid-module stays ACTIVE with an expired clock forever — it
never reaches SCORING, never scores, and (via uniq_active_mock_attempt_per_student)
blocks the student from starting a fresh attempt. This command finds attempts whose
current phase deadline has long passed and fast-forwards them to completion
(unanswered questions grade as omitted, which is correct for a timed-out test), and
finishes any attempt stuck in SCORING.

Run periodically on prod (cron / Celery beat):

    python manage.py sweep_mock_attempts               # grace 30 min
    python manage.py sweep_mock_attempts --grace-minutes 15 --dry-run
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from mocks.models import MockAttempt
from mocks.state_machine import (
    STATE_ABANDONED,
    STATE_BREAK,
    STATE_COMPLETED,
    STATE_NOT_STARTED,
    STATE_SCORING,
)
from mocks.tasks import enqueue_mock_scoring


class Command(BaseCommand):
    help = "Force-advance/close stranded active mock attempts whose deadline long passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--grace-minutes",
            type=int,
            default=30,
            help="Only reap an attempt whose current phase is expired by at least this many minutes.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be reaped without changing anything.",
        )

    def handle(self, *args, **opts):
        grace = int(opts["grace_minutes"]) * 60
        dry = bool(opts["dry_run"])

        candidate_ids = list(
            MockAttempt.objects.filter(is_completed=False)
            .exclude(current_state=STATE_ABANDONED)
            .values_list("pk", flat=True)
        )

        reaped = 0
        needs_scoring: list[int] = []
        for att_id in candidate_ids:
            with transaction.atomic():
                att = MockAttempt.objects.select_for_update().select_related("mock").get(pk=att_id)
                if not self._is_stranded(att, grace):
                    continue
                if dry:
                    self.stdout.write(f"[dry-run] would reap attempt {att.pk} (state={att.current_state})")
                    reaped += 1
                    continue
                self._drain(att)
                reaped += 1
                if att.current_state == STATE_SCORING:
                    needs_scoring.append(att.pk)

        # Enqueue scoring outside the row lock (runs synchronously when no broker).
        for att_id in needs_scoring:
            enqueue_mock_scoring(attempt_id=att_id, request=None)

        verb = "Would reap" if dry else "Reaped"
        self.stdout.write(self.style.SUCCESS(f"{verb} {reaped} stranded mock attempt(s)."))

    @staticmethod
    def _is_stranded(att, grace: int) -> bool:
        state = att.current_state
        if state == STATE_SCORING:
            return True  # stuck before scoring finished — finish it
        if state == STATE_NOT_STARTED:
            return False  # student never began; not force-started here
        timing = att.get_break_timing() if state == STATE_BREAK else att.get_timing()
        if not timing or not timing.is_expired:
            return False
        # remaining_seconds is clamped at 0, so measure lateness via elapsed vs limit.
        return (timing.elapsed_seconds - timing.limit_seconds) >= grace

    @staticmethod
    def _drain(att) -> None:
        """Fast-forward a stranded attempt to SCORING (or as far as the state machine
        allows). Bounded loop — the linear chain is at most 5 hops."""
        for _ in range(8):
            state = att.current_state
            if state == STATE_BREAK:
                if not att.end_break():
                    break
                continue
            if state in (STATE_SCORING, STATE_COMPLETED, STATE_ABANDONED, STATE_NOT_STARTED):
                break
            # A submittable module: advance without accepting any late answers.
            if not att.submit_module(answers=None, flagged=None):
                break
