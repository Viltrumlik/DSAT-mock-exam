"""Run the class-group sweep by hand — the same pass Celery Beat makes every half hour.

    python manage.py audit_classroom_telegram_groups            # every active class group
    python manage.py audit_classroom_telegram_groups --class 12 # just one
    python manage.py audit_classroom_telegram_groups --health   # report only, change nothing
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from classes import telegram_group as tg
from classes.models import Classroom


class Command(BaseCommand):
    help = "Reconcile class Telegram groups with the site (bot rights, membership, stale invites)."

    def add_arguments(self, parser):
        parser.add_argument("--class", dest="classroom_id", type=int, default=None)
        parser.add_argument(
            "--health",
            action="store_true",
            help="Only report whether each group is wired up. Removes nobody.",
        )
        parser.add_argument(
            "--max", dest="max_classrooms", type=int, default=None,
            help="Stop after this many classrooms.",
        )

    def handle(self, *args, **options):
        if not tg.api.is_configured():
            raise CommandError("No Telegram bot token configured.")

        if options["classroom_id"]:
            classrooms = list(Classroom.objects.filter(pk=options["classroom_id"]))
            if not classrooms:
                raise CommandError(f"No classroom {options['classroom_id']}.")
        else:
            classrooms = list(
                Classroom.objects.filter(is_active=True).exclude(telegram_chat_id="").order_by("pk")
            )
            if options["max_classrooms"]:
                classrooms = classrooms[: options["max_classrooms"]]

        if not classrooms:
            self.stdout.write("No classroom has a Telegram chat id set.")
            return

        for classroom in classrooms:
            if options["health"]:
                health = tg.group_health(classroom)
                mark = "ok " if health.ok else "BAD"
                self.stdout.write(
                    f"[{mark}] #{classroom.pk} {classroom.name} — chat {health.chat_id} "
                    f"({health.title or 'no title'}), bot={health.bot_status or '?'}, "
                    f"members={health.member_count if health.member_count is not None else '?'}"
                    + (f" — {health.problem}" if health.problem else "")
                )
                continue

            result = tg.audit_classroom(classroom)
            self.stdout.write(
                f"#{classroom.pk} {classroom.name}: checked={result['checked']} "
                f"removed={result['removed']} reconciled={result['reconciled']} "
                f"expired={result['tickets_expired']}"
                + (f" — {result['problem']}" if result["problem"] else "")
            )
