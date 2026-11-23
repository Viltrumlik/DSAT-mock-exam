"""Leaving lc-up, step by step (``billing.cutover``; the runbook is ``deploy/CUTOVER.md``).

    manage.py billing_cutover check
    manage.py billing_cutover prepare --day 2026-12-01 [--apply] [--no-pull]
    (deploy/cutover-env.sh on)
    manage.py billing_cutover finish  --day 2026-12-01 [--apply] [--mass-until 2026-12-07]
    manage.py billing_cutover reverse --day <first day by the month again> --since 2026-12-01 [--apply]

Every step without ``--apply`` does all of its work inside a transaction that is rolled back, and prints what it would
keep (``prepare`` still pulls from lc-up: that is what lc-up's own timers do every 15 minutes anyway).
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_date

from billing import cutover


class Command(BaseCommand):
    help = "Leave lc-up: check, prepare (last pull + true-up), finish (per lesson + first tick), or reverse."

    def add_arguments(self, parser):
        parser.add_argument("step", choices=["check", "prepare", "finish", "reverse"])
        parser.add_argument("--day", help="YYYY-MM-DD: the first day on our own (prepare, finish), or back on lc-up (reverse).")
        parser.add_argument("--since", help="reverse: the cutover's first day; money entered here from it is listed.")
        parser.add_argument("--apply", action="store_true", help="Keep what the step writes.")
        parser.add_argument("--no-pull", action="store_true", help="prepare: skip the last pull (it was just done).")
        parser.add_argument("--allow-mass", action="store_true", help="finish: freeze everyone who owes, however many.")
        parser.add_argument(
            "--mass-until",
            help="finish: the last day the tick freezes however many owe at once (default: the first day + 6).",
        )

    def _day(self, raw, name):
        day = parse_date(raw or "")
        if day is None:
            raise CommandError(f"{name} must be YYYY-MM-DD.")
        return day

    def handle(self, *args, **options):
        step, today = options["step"], timezone.localdate()
        try:
            if step == "check":
                report = cutover.status()
            elif step == "prepare":
                report = cutover.prepare(
                    self._day(options["day"], "--day"), today=today, apply=options["apply"], pull=not options["no_pull"]
                )
            elif step == "finish":
                report = cutover.finish(
                    self._day(options["day"], "--day"), today=today, apply=options["apply"], allow_mass=options["allow_mass"],
                    mass_until=self._day(options["mass_until"], "--mass-until") if options["mass_until"] else None,
                )
            else:
                report = cutover.reverse(
                    self._day(options["day"], "--day"), since=self._day(options["since"], "--since"), today=today,
                    apply=options["apply"],
                )
        except cutover.CutoverRefused as refused:
            raise CommandError(str(refused)) from refused
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
