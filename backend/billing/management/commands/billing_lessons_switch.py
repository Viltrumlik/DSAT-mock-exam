"""Move every running seat billed by the month to pay per lesson from one day (owner, 2026-11-22).

Each running monthly span ends the day before (``EndReason.SWITCH``: the lessons after it come back, as on a
freeze) and the seat starts again per lesson on the day. Balances carry over; nobody here pays a first month in
full, that is for new students. A span that had not begun by the day is billed per lesson from its own start.

Without ``--apply`` it runs inside a transaction that is rolled back and prints what it would do.
"""

import json
from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

from billing import conf, ledger
from billing.models import BillingState, EndReason, Entry, EntryKind, Span, SpanRule


class _DryRun(Exception):
    pass


class Command(BaseCommand):
    help = "Move every running monthly seat to pay per lesson from --day (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--day", required=True, help="YYYY-MM-DD, today or earlier: the first day paid per lesson.")
        parser.add_argument("--apply", action="store_true", help="Write it. Without this nothing is kept.")

    def handle(self, *args, **options):
        day = parse_date(options["day"] or "")
        today = timezone.localdate()
        if day is None:
            raise CommandError("--day must be YYYY-MM-DD.")
        if day > today:
            raise CommandError("--day cannot be later than today: run it on that day.")
        if not conf.lesson_billing():
            raise CommandError("BILLING_MODE is not 'lesson': new seats would still be billed by the month.")
        if BillingState.get().opened_at is None:
            raise CommandError("The ledger is not open.")
        report = {}
        try:
            with transaction.atomic():
                report = switch(day, today)
                if not options["apply"]:
                    raise _DryRun
        except _DryRun:
            report["applied"] = False
        else:
            report["applied"] = True
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))


def switch(day, today) -> dict:
    counts = Counter()
    before = Entry.objects.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"] or 0
    first_new_row = (Entry.objects.order_by("-id").values_list("id", flat=True).first() or 0) + 1
    running = Span.objects.filter(rule=SpanRule.MONTH, end__isnull=True).select_related("seat__account")
    for span in running.order_by("id"):
        if span.start >= day:
            for entry in span.entries.filter(voided_at__isnull=True):
                ledger.void(entry, f"Paid per lesson from {day.isoformat()}")
            span.rule = SpanRule.LESSON
            span.save(update_fields=["rule"])
            ledger.bill_span(span, today)
            counts["not_begun_switched"] += 1
            continue
        ledger.end_span(span, day - timedelta(days=1), EndReason.SWITCH, today=today)
        ledger.start_span(span.seat, day, today=today, rule=SpanRule.LESSON)
        counts["switched"] += 1
    after = Entry.objects.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"] or 0
    written = Entry.objects.filter(id__gte=first_new_row)
    return {
        "day": day,
        "counts": dict(counts),
        "rows_written": written.count(),
        "lessons_given_back": written.filter(kind=EntryKind.CREDIT).aggregate(total=Sum("amount"))["total"] or 0,
        "lesson_charges": written.filter(key__startswith=ledger.LESSON_KEY).aggregate(total=Sum("amount"))["total"] or 0,
        "all_balances_before": before,
        "all_balances_after": after,
    }
