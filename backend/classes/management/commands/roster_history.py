"""Who changed a classroom's roster, and when.

    python manage.py roster_history --classroom 27
    python manage.py roster_history --student 333
    python manage.py roster_history --actor 41 --days 7
    python manage.py roster_history --action REMOVED --days 1

Reads ``ClassroomMembershipEvent``. Answers the question that could not be answered on
2026-08-29, when a class was emptied and the platform had no record of who did it — see that
model's docstring.

**It only knows what happened after it shipped.** Changes made before that are not here and
cannot be recovered: the old rows carry no history, and the nginx access logs that were the
only other trace keep ten days and name an IP rather than a person.
"""

from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from classes.models_membership_audit import ClassroomMembershipEvent


class Command(BaseCommand):
    help = "Show roster changes: who was added or removed from a class, by whom, and when."

    def add_arguments(self, parser):
        parser.add_argument("--classroom", type=int, help="Limit to one classroom id.")
        parser.add_argument("--student", type=int, help="Limit to one student id.")
        parser.add_argument("--actor", type=int, help="Limit to changes made by one user id.")
        parser.add_argument("--action", help="ADDED / REMOVED / REINSTATED / ROLE_CHANGED / DELETED.")
        parser.add_argument("--days", type=int, default=30, help="How far back to look (default 30).")
        parser.add_argument("--limit", type=int, default=200, help="Max rows (default 200).")

    def handle(self, *args, **options):
        qs = ClassroomMembershipEvent.objects.all()
        if options["classroom"]:
            qs = qs.filter(classroom_id=options["classroom"])
        if options["student"]:
            qs = qs.filter(student_id=options["student"])
        if options["actor"]:
            qs = qs.filter(actor_id=options["actor"])
        if options["action"]:
            qs = qs.filter(action=options["action"].upper())
        if options["days"]:
            qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=options["days"]))

        rows = list(qs.order_by("-created_at")[: options["limit"]])
        if not rows:
            self.stdout.write("No roster changes match that.")
            return

        self.stdout.write(f"{len(rows)} change(s), newest first:\n")
        self.stdout.write(
            f"{'when':17s} {'action':13s} {'student':26s} {'by':24s} classroom"
        )
        self.stdout.write("-" * 110)
        for e in rows:
            when = timezone.localtime(e.created_at).strftime("%Y-%m-%d %H:%M")
            # "system" is a real answer, not a missing one — a management command, a
            # migration or a Celery task genuinely has nobody behind it. See core.actor.
            by = e.actor_name or "system"
            extra = ""
            if e.action == ClassroomMembershipEvent.ACTION_ROLE_CHANGED:
                extra = f"  ({e.previous_role} -> {e.new_role})"
            self.stdout.write(
                f"{when:17s} {e.action:13s} {e.student_name[:26]:26s} {by[:24]:24s} "
                f"{e.classroom_name}{extra}"
            )

        # A burst is the shape the incident had: fourteen removals in sixty-two seconds. Worth
        # naming, because a list of timestamps does not make it obvious on its own.
        if len(rows) >= 3:
            span = (rows[0].created_at - rows[-1].created_at).total_seconds()
            if span and span < 300:
                self.stdout.write("")
                self.stdout.write(self.style.WARNING(
                    f"All {len(rows)} of these landed within {span:.0f} seconds — one sitting, "
                    "not a term's worth of ordinary changes."
                ))
