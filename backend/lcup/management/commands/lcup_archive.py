import json

from django.core.management.base import BaseCommand, CommandError

from lcup.archive import run_row, summary
from lcup.conf import lcup_enabled
from lcup.tasks import archive_exclusive


class Command(BaseCommand):
    help = (
        "Copy everything lc-up's API serves into the archive tables (lcup.archive) — reads lc-up only. "
        "--dry-run does the whole pass and rolls it back; --report shows what the archive holds, calling nothing. "
        "A run by hand does not need LCUP_ARCHIVE_ENABLED: that switch is for the nightly beat entry."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Pull everything, write nothing but the run's report.")
        parser.add_argument("--report", action="store_true", help="What the archive holds; lc-up is not called.")

    def handle(self, *args, **options):
        if options["report"]:
            self.stdout.write(json.dumps(summary(), ensure_ascii=False, indent=2, default=str))
            return
        if not lcup_enabled():
            raise CommandError("LCUP_ENABLED is off: there are no lc-up credentials to read with.")
        run = archive_exclusive(dry_run=options["dry_run"])
        if run is None:
            raise CommandError("Another archive pass is running.")
        self.stdout.write(json.dumps(run_row(run), ensure_ascii=False, indent=2, default=str))
