"""Switch the academic leaderboard onto the reward ledger.

The last step of the rewards epic (PR 9, docs/rewards/PLAN.md §0.3). The code change is in
``classes/ranking/service.py``; this command performs the one-off data move that has to
accompany it, and it is safe to re-run.

Three things happen, in this order:

1. **Season 1 is opened** if no season exists. ``current_season()`` would create it lazily on
   the first award anyway; doing it here means the season that scopes the cutover is the one
   that existed when the boards were rebuilt, not whichever one a later hook happened to mint.

2. **Historical ACADEMIC snapshots are deleted.** This is the part that must not be skipped.
   Those rows hold the retired currency — a re-derived sum of raw assessment ``score_points``,
   routinely in the hundreds — while a reward total starts near zero. ``_previous_scores``
   reads the newest snapshot from a *different* period to compute ``trend``, so leaving them
   would tell every student in the school they are DECLINING, and ``previous_rank`` would draw
   rank arrows between two boards measuring different things. The snapshots are a re-derivable
   cache, not a record: nothing is lost that the ledger does not now hold better.

3. **Every classroom's ACADEMIC board is recomputed** from the ledger, so nobody waits up to
   20 minutes for the Celery beat to catch up and sees an empty board in between.

SAT boards are untouched throughout — different kind, different rule, unaffected by rewards.

    python manage.py cutover_academic_leaderboard --dry-run
    python manage.py cutover_academic_leaderboard
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from classes.models import Classroom
from classes.models_ranking import RankingSnapshot
from classes.ranking import service as ranking_service
from rewards.services import current_season


class Command(BaseCommand):
    help = "Repoint the academic leaderboard at the reward ledger and clear the old points."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change and roll back.",
        )

    def handle(self, *args, **options):
        dry_run = bool(options["dry_run"])

        season = current_season()
        stale = RankingSnapshot.objects.filter(kind=RankingSnapshot.KIND_ACADEMIC)
        stale_count = stale.count()
        classrooms = list(Classroom.objects.all().order_by("id"))

        self.stdout.write(f"Season: {season.name}")
        self.stdout.write(f"Old ACADEMIC snapshots to clear: {stale_count}")
        self.stdout.write(f"Classrooms to recompute: {len(classrooms)}")

        written = 0
        try:
            with transaction.atomic():
                stale.delete()
                for classroom in classrooms:
                    summary = ranking_service.recompute_classroom(
                        classroom, kinds=("ACADEMIC",)
                    )
                    written += int(summary.get("ACADEMIC") or 0)
                if dry_run:
                    raise _Rollback()
        except _Rollback:
            self.stdout.write(
                self.style.WARNING(
                    f"[dry-run] would clear {stale_count} snapshot(s) and write {written} "
                    f"across {len(classrooms)} classroom(s) — rolled back."
                )
            )
            return

        self.stdout.write(
            self.style.SUCCESS(
                f"Cleared {stale_count} snapshot(s); wrote {written} academic row(s) "
                f"across {len(classrooms)} classroom(s) from the reward ledger."
            )
        )


class _Rollback(Exception):
    """Aborts the transaction on --dry-run. Not an error."""
