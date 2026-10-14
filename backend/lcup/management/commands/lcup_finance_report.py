import json

from django.core.management.base import BaseCommand
from django.utils import timezone

from lcup.finance import freeze_report


class Command(BaseCommand):
    help = (
        "Who the monthly debt freeze would freeze — and let go — if it ran now, switched on "
        "(owner: show this before LCUP_DEBT_FREEZE_ENABLED). Changes nothing."
    )

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(freeze_report(timezone.now()), ensure_ascii=False, indent=2))
