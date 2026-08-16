"""Manual entry point for the homework deadline sweep.

The logic lives in ``rewards.tasks.settle_due_homework`` so this command and the Celery-beat
entry can never drift apart — and so the task keeps its name in the one module
``autodiscover_tasks()`` actually imports. Beat runs it every ten minutes in production; this
command exists for the one thing beat cannot do:

    python manage.py settle_due_homework                     # the default 7-day window
    python manage.py settle_due_homework --lookback-days 45  # after an outage

``SWEEP_LOOKBACK_DAYS`` is a hard floor on what the platform will ever pay for. Under the
deadline-frozen model an unfinished bundle writes nothing before its due date, so this sweep is
the only thing that ever settles it — and a bundle whose deadline falls outside the window is
not settled late, it is never settled at all. A beat outage of more than a week therefore
orphans that homework permanently, and until this command existed nothing anywhere could pass a
wider window to recover it.

Runs **in this process**, not via ``.delay()``, deliberately: an operator reaching for this is
usually recovering from a broker or worker that was the thing that went down, and firing the
work into that broker would put the recovery back in the queue that failed. Running inline also
gives them the stats and an exit code to look at.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from rewards.tasks import SWEEP_LOOKBACK_DAYS, settle_due_homework


class Command(BaseCommand):
    help = "Settle homework reward points for bundles whose deadline has passed."

    def add_arguments(self, parser):
        parser.add_argument(
            "--lookback-days",
            type=int,
            default=SWEEP_LOOKBACK_DAYS,
            help=(
                "How far back to look for passed deadlines. Widen this after a worker or beat "
                f"outage longer than {SWEEP_LOOKBACK_DAYS} days, or that homework is never paid."
            ),
        )

    def handle(self, *args, **options):
        days = int(options["lookback_days"])
        if days < 1:
            # Zero would silently settle nothing and still report success, which reads as
            # "there was no due homework" — the one answer an operator must not be given while
            # recovering from an outage.
            raise CommandError("--lookback-days must be at least 1.")

        stats = settle_due_homework(lookback_days=days)
        self.stdout.write(
            self.style.SUCCESS(
                f"Settled {stats['students']} student bundle(s) across "
                f"{stats['assignments']} assignment(s) over the last {days} day(s)."
            )
        )
