"""``manage.py staging_after_day [--json]`` — the test copy's day of work after one time-machine step.

The time machine (deploy/staging/stg_timemachine.py) moves the copy's clock one day and runs this under that clock
(libfaketime), once per day moved. It does what the beat would have done that day — the lesson charges and the debt
freeze (``billing.tasks.own_tick``, with the beat's own guards: a finished cutover, the mass-freeze window), today's
registers, and the balance warnings where they are installed — and says what came of it, ``--json`` as one line:

  {"test_date": "YYYY-MM-DD", "lessons": {"count", "amount"}, "frozen", "unfrozen",
   "messages": {"sms", "telegram", "email", "push"}, "alerts": [...], "errors": [...]}

A step that crashes makes the command fail, and the time machine then puts the copy back as it was before the move.
Only on the copy (``staging.guard.toolbox_on``)."""

from __future__ import annotations

import importlib.util
import json

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Q, Sum
from django.utils import timezone

from staging.guard import toolbox_on

#: A lesson's charge (``billing.ledger.LESSON_KEY``) and a moved lesson's (Part C's lesson changes).
LESSON_KEYS = ("lesson:", "moved:")
CHANNELS = ("sms", "telegram", "email", "push")


def run_day() -> dict:
    from billing import tasks as billing_tasks
    from billing.ledger import SOURCE_BILLING
    from billing.models import Entry, EntryKind
    from classes import tasks as class_tasks
    from staging.models import CapturedMessage
    from users.models import RoleChange

    started = timezone.now()
    alerts: list[str] = []
    errors: list[str] = []

    tick = billing_tasks.own_tick.apply().get()
    if tick.get("skipped"):
        alerts.append(f"lesson charges: skipped ({tick['skipped']})")
    alerts += list(tick.get("alerts") or [])
    errors += list(tick.get("errors") or [])

    class_tasks.open_todays_attendance_registers.apply().get()

    if importlib.util.find_spec("sms.balance_warnings") is None:  # Part D, on its own branch until merged
        alerts.append("balance warnings: not installed")
    else:
        from sms import balance_warnings

        warned = balance_warnings.daily(timezone.now())
        if isinstance(warned.get("skipped"), str):
            alerts.append(f"balance warnings: skipped ({warned['skipped']})")

    lessons = Entry.objects.filter(created_at__gte=started, kind=EntryKind.CHARGE, voided_at__isnull=True).filter(
        Q(key__startswith=LESSON_KEYS[0]) | Q(key__startswith=LESSON_KEYS[1])
    )
    totals = lessons.aggregate(count=Count("id"), amount=Sum("amount"))
    # The ledger's own freezes and unfreezes (``ledger.apply_debt_freeze``): an unfreeze is written with the reason
    # "lcup_debt_paid", so both are found by their source.
    changes = RoleChange.objects.filter(created_at__gte=started, source=SOURCE_BILLING)
    captured = CapturedMessage.objects.filter(created_at__gte=started)
    return {
        "test_date": timezone.localdate().isoformat(),
        "lessons": {"count": totals["count"] or 0, "amount": -(totals["amount"] or 0)},
        "frozen": changes.filter(froze=True).count(),
        "unfrozen": changes.filter(unfroze=True).count(),
        "messages": {channel: captured.filter(channel=channel).count() for channel in CHANNELS},
        "alerts": alerts,
        "errors": errors,
    }


class Command(BaseCommand):
    help = "The test copy only: the day's lesson charges, freezes and warnings after a time-machine step."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print the report as one JSON line.")

    def handle(self, *args, **options):
        if not toolbox_on():
            raise CommandError("staging_after_day runs only on the test copy (STAGING_TOOLBOX and its own database).")
        report = run_day()
        if options["json"]:
            self.stdout.write(json.dumps(report, ensure_ascii=False))
            return
        lessons, messages = report["lessons"], report["messages"]
        self.stdout.write(
            f"{report['test_date']}: {lessons['count']} lessons, {lessons['amount']:,} so'm charged, "
            f"{report['frozen']} frozen, {report['unfrozen']} unfrozen, {messages['sms']} SMS"
        )
        for alert in report["alerts"]:
            self.stdout.write(f"alert: {alert}")
        for error in report["errors"]:
            self.stderr.write(f"error: {error}")
