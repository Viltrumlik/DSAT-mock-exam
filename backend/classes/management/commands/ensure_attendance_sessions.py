"""Open today's attendance register for every class whose lesson has started.

Run it from cron a few times a day (or hourly — it is idempotent and cheap):

    python manage.py ensure_attendance_sessions

The sessions list materialises on read too, so this is belt-and-braces rather than the only
path: it means the register is already there when the teacher arrives, instead of appearing
because they opened the page.

``--dry-run`` reports what it would create and writes nothing.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from classes import attendance_auto
from classes.models import Classroom


class Command(BaseCommand):
    help = "Create the attendance session for any lesson that has started and has none."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Report what would be created without writing anything.",
        )
        parser.add_argument(
            "--backfill-days", type=int, default=attendance_auto.BACKFILL_DAYS,
            help=(
                "How far back to reach for missed lessons "
                f"(default {attendance_auto.BACKFILL_DAYS})."
            ),
        )
        parser.add_argument(
            "--classroom", type=int, default=None,
            help="Limit to one classroom id.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        backfill_days = options["backfill_days"]

        # Archived classes do not meet, so they get no register.
        qs = Classroom.objects.filter(is_active=True)
        if options["classroom"]:
            qs = qs.filter(pk=options["classroom"])

        created_total = 0
        unusable = []
        for classroom in qs.order_by("id"):
            if not attendance_auto.schedule_is_usable(classroom):
                unusable.append(classroom)
                continue
            if dry_run:
                due = attendance_auto.due_lesson_dates(
                    classroom, backfill_days=backfill_days
                )
                from classes.models_attendance import AttendanceSession

                have = set(
                    AttendanceSession.objects.filter(
                        classroom=classroom, date__in=due
                    ).values_list("date", flat=True)
                )
                missing = [d for d in due if d not in have]
                if missing:
                    created_total += len(missing)
                    self.stdout.write(
                        f"  would open {len(missing)} for #{classroom.id} {classroom.name}: "
                        + ", ".join(str(d) for d in missing)
                    )
                continue

            created = attendance_auto.ensure_sessions(
                classroom, backfill_days=backfill_days
            )
            if created:
                created_total += len(created)
                self.stdout.write(
                    f"  opened {len(created)} for #{classroom.id} {classroom.name}: "
                    + ", ".join(str(s.date) for s in created)
                )

        verb = "Would open" if dry_run else "Opened"
        self.stdout.write(self.style.SUCCESS(f"{verb} {created_total} attendance session(s)."))
        if unusable:
            # Not a failure — but a class in this list will never get a register on its own,
            # and its teacher has to add one by hand. Naming them is how that gets fixed.
            self.stdout.write(
                self.style.WARNING(
                    f"{len(unusable)} active class(es) have no usable lesson_days and were "
                    "skipped: " + ", ".join(f"#{c.id} {c.name}" for c in unusable)
                )
            )
