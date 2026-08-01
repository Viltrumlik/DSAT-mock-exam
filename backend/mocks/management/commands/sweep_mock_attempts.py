"""Reaper for stranded full-mock attempts (manual / cron entry point).

The logic lives in ``mocks.reaper`` so this command and the Celery-beat task
``mocks.tasks.sweep_mock_attempts_task`` can never drift apart. Beat runs it every
20 minutes in production; this command is for one-off runs and dry-run inspection:

    python manage.py sweep_mock_attempts               # grace 30 min
    python manage.py sweep_mock_attempts --grace-minutes 15 --dry-run
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from mocks.reaper import DEFAULT_GRACE_MINUTES, sweep_stranded_mock_attempts


class Command(BaseCommand):
    help = "Force-advance/close stranded active mock attempts whose deadline long passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--grace-minutes",
            type=int,
            default=DEFAULT_GRACE_MINUTES,
            help="Only reap an attempt whose current phase is expired by at least this many minutes.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be reaped without changing anything.",
        )

    def handle(self, *args, **opts):
        dry = bool(opts["dry_run"])
        result = sweep_stranded_mock_attempts(grace_minutes=int(opts["grace_minutes"]), dry_run=dry)
        if dry:
            for att_id in result["attempt_ids"]:
                self.stdout.write(f"[dry-run] would reap attempt {att_id}")
        verb = "Would reap" if dry else "Reaped"
        self.stdout.write(self.style.SUCCESS(f"{verb} {result['reaped']} stranded mock attempt(s)."))
