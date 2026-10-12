import json

from django.core.management.base import BaseCommand, CommandError

from lcup.client import default_client
from lcup.conf import lcup_enabled
from lcup.sync import run_sync


class Command(BaseCommand):
    help = (
        "Sync groups, members and accounts from lc-up. --dry-run computes everything and rolls it "
        "back (allowed while LCUP_ENABLED is off — it is how a deploy is previewed)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Compute the run, write nothing but its report.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not lcup_enabled():
            raise CommandError("LCUP_ENABLED is off. Use --dry-run to preview a sync.")
        run = run_sync(default_client(), dry_run=dry_run)
        report = {"ok": run.ok, "dry_run": run.dry_run, "counts": run.counts, "alerts": run.alerts, "errors": run.errors}
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
