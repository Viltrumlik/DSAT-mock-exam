import json

from django.core.management.base import BaseCommand

from lcup.phone_confirm import create_prompts, prompt_status


class Command(BaseCommand):
    help = (
        "Ask every account of a student who has several same-name accounts for their phone, so the "
        "one they use becomes the account lc-up is linked to (owner, 2026-10-14). Without --apply it "
        "only reports who would be asked — show the owner that first. --status counts the answers."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Create the prompts.")
        parser.add_argument("--status", action="store_true", help="Count the prompts by state.")

    def handle(self, *args, **options):
        if options["status"]:
            report = prompt_status()
        else:
            report = create_prompts(dry_run=not options["apply"])
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
