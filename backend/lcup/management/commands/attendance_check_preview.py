"""Print the lesson-end check each paired class's teachers would get (lcup.followups). Read-only:
run it on prod and show the owner before LCUP_ATTENDANCE_CHECKS_ENABLED goes on."""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_date

from lcup.followups import preview_lesson_checks


class Command(BaseCommand):
    help = "Show what each paired class's teachers would be told as DAY's lesson ends. Sends nothing."

    def add_arguments(self, parser):
        parser.add_argument("--day", help="YYYY-MM-DD (default: today)")

    def handle(self, *args, **options):
        day = parse_date(options["day"]) if options.get("day") else timezone.localdate()
        if day is None:
            raise CommandError("--day must be YYYY-MM-DD")
        rows = preview_lesson_checks(day)
        if not rows:
            self.stdout.write(f"No paired class meets on {day}.")
        for row in rows:
            if not row["sends"]:
                self.stdout.write(f"{row['classroom']}: nothing to say — no notification")
                continue
            self.stdout.write(f"{row['title']}\n  to: {', '.join(row['teachers']) or '(no teacher)'}\n  {row['body']}\n")
