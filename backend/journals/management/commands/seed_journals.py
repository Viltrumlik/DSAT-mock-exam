"""Create the 7 canonical (empty) journals (idempotent).

Journals are created with NO sessions — an admin adds them with "New session" and decides
how many lessons and midterms the course has.

    python manage.py seed_journals            # create any missing journals
    python manage.py seed_journals --actor 1  # attribute created_by to user id 1
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from journals import services, structure


class Command(BaseCommand):
    help = "Create the 7 canonical, EMPTY journals (Math: F/J/M/S, English: J/M/S)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--actor",
            type=int,
            default=None,
            help="User id to record as created_by (defaults to the first superuser).",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        actor_id = options.get("actor")
        if actor_id:
            actor = User.objects.filter(pk=actor_id).first()
            if actor is None:
                raise CommandError(f"No user with id={actor_id}")
        else:
            actor = User.objects.filter(is_superuser=True).order_by("id").first()
            if actor is None:
                actor = User.objects.order_by("id").first()
            if actor is None:
                raise CommandError("No users exist to attribute created_by; create one first.")

        created, existed = 0, 0
        for subject, level in structure.all_courses():
            journal, was_created = services.create_journal(
                subject=subject, level=level, actor=actor
            )
            if was_created:
                created += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"created {journal.display_title} (empty — add sessions in the admin)"
                    )
                )
            else:
                existed += 1
                self.stdout.write(f"exists  {journal.display_title}")

        self.stdout.write(
            self.style.SUCCESS(f"Done. created={created} already_existed={existed}")
        )
