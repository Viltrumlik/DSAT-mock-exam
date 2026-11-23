import json

from django.core.management.base import BaseCommand, CommandError

from billing.history import NotOpen, copy_past_payments


class Command(BaseCommand):
    help = (
        "Copy lc-up's payments from before the ledger opened out of the archive into billing.PastPayment, so they stay "
        "on the money pages once lc-up is gone. History only: no balance changes. Without --apply nothing is kept."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Keep what the run writes.")

    def handle(self, *args, **options):
        try:
            report = copy_past_payments(apply=options["apply"])
        except NotOpen as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
