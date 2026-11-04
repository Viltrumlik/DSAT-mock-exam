import json

from django.core.management.base import BaseCommand

from billing.tasks import shadow_tick


class Command(BaseCommand):
    help = (
        "One 15-minute tick by hand. --allow-mass lets through a tick held because too many seats ended at "
        "once, after a person has checked that they really did."
    )

    def add_arguments(self, parser):
        parser.add_argument("--allow-mass", action="store_true", help="The seats really did end: follow them.")

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(shadow_tick(allow_mass=options["allow_mass"]), ensure_ascii=False, indent=2))
