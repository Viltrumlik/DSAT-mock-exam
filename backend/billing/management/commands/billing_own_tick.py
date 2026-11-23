import json

from django.core.management.base import BaseCommand

from billing.tasks import own_tick


class Command(BaseCommand):
    help = (
        "One tick of the ledger's own billing and debt freeze, once lc-up no longer writes it (what beat runs every "
        "15 minutes). --allow-mass lets through freezes held because too many came at once, after a person checked."
    )

    def add_arguments(self, parser):
        parser.add_argument("--allow-mass", action="store_true", help="Freeze them all: they really do owe.")

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(own_tick(allow_mass=options["allow_mass"]), ensure_ascii=False, indent=2))
