import json
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from sms.debt_warnings import plan
from sms.delivery import mask_phone


class Command(BaseCommand):
    help = "Who the debt warning would reach (today, or --day), phones masked. Sends nothing, changes nothing."

    def add_arguments(self, parser):
        parser.add_argument("--day", help="preview another day, YYYY-MM-DD (balances are still judged as of now)")

    def handle(self, *args, **options):
        try:
            day = date.fromisoformat(options["day"]) if options["day"] else None
        except ValueError:
            raise CommandError("--day must be YYYY-MM-DD")
        planned = plan(timezone.now(), today=day)
        report = {
            "blocked": planned.blocked,
            "skipped": planned.skipped,
            "warnings": [
                {
                    "lcup_student_id": w.link.lcup_student_id,
                    "name": w.link.name,
                    "phone": mask_phone(w.phone),
                    "debt": int(abs(w.link.balance)),
                    "text": w.text,
                }
                for w in planned.warnings
            ],
        }
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
