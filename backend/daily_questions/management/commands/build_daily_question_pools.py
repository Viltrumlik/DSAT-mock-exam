"""Build (or rebuild) a month's Question of the Day lists and print them.

    manage.py build_daily_question_pools                       # this month, keep what exists
    manage.py build_daily_question_pools --month 2026-11       # a given month
    manage.py build_daily_question_pools --month 2026-11 --rebuild
"""

from __future__ import annotations

from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from daily_questions.pools import build_pools, month_start


class Command(BaseCommand):
    help = "Build the Question of the Day lists for a month from the previous month's answers."

    def add_arguments(self, parser):
        parser.add_argument("--month", help="YYYY-MM (default: this month, Tashkent)")
        parser.add_argument(
            "--rebuild", action="store_true",
            help="Replace lists that already exist (what students were dealt is kept).",
        )

    def handle(self, *args, month=None, rebuild=False, **options):
        if month:
            try:
                day = datetime.strptime(month, "%Y-%m").date()
            except ValueError as exc:
                raise CommandError("--month must look like 2026-11") from exc
        else:
            day = timezone.localdate()
        pools = build_pools(month_start(day), rebuild=rebuild)
        for pool in sorted(pools, key=lambda p: (p.subject, p.level)):
            items = list(pool.items.order_by("rank"))
            self.stdout.write(
                f"{pool.month:%Y-%m} {pool.subject} {pool.level}: {len(items)} questions "
                f"(answers {pool.stats_from} .. {pool.stats_until})"
            )
            for item in items:
                self.stdout.write(
                    f"  #{item.rank:>2} q{item.question_id}  {item.correct_percent:>3}% right "
                    f"({item.correct_count}/{item.answers_count})"
                )
