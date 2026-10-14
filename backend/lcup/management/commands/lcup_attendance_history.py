import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_date

from lcup.attendance import import_history
from lcup.client import default_client


class Command(BaseCommand):
    help = (
        "Copy lc-up's attendance history into the paired classes' registers, from each course's "
        "start (owner, 2026-10-14). Sends nothing to lc-up. --dry-run computes it all and rolls it "
        "back — run that first and show the owner the report."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would change; keep nothing.")
        parser.add_argument("--until", help="Last day to copy (YYYY-MM-DD). Default: yesterday.")

    def handle(self, *args, **options):
        until = timezone.localdate() - timedelta(days=1)
        if options.get("until"):
            until = parse_date(options["until"])
            if until is None:
                raise CommandError("--until must be YYYY-MM-DD")
        report = import_history(default_client(), until=until, dry_run=options["dry_run"])
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
