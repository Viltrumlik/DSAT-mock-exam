import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from billing.shadow import NotReady, open_ledger


class Command(BaseCommand):
    help = (
        "Open the ledger from lc-up's balances, once. Without --apply it does all of it and rolls it back, "
        "so the report is exactly what opening would write. Calls nothing outside our database."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Really open it.")

    def handle(self, *args, **options):
        try:
            report = open_ledger(timezone.now(), apply=options["apply"])
        except NotReady as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(dict(report, applied=options["apply"]), ensure_ascii=False, indent=2))
