"""
DESTRUCTIVE: delete ALL Question Bank questions plus their versions, student
attempts, passages, and import batches. Keeps the taxonomy (domains/skills) and the
qb_id counter (ids never reused). Take a DB backup first.

Usage:
    python manage.py purge_bank_questions --dry-run
    python manage.py purge_bank_questions --confirm
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from questionbank.models import (
    BankPassage,
    BankQuestion,
    ImportBatch,
)

try:  # optional model
    from questionbank.models import BankQuestionAttempt
except ImportError:  # pragma: no cover
    BankQuestionAttempt = None


class Command(BaseCommand):
    help = "Delete ALL bank questions/attempts/passages/import-batches (keeps taxonomy)."

    def add_arguments(self, parser):
        parser.add_argument("--confirm", action="store_true", help="Actually delete.")
        parser.add_argument("--dry-run", action="store_true", help="Report counts only.")

    def handle(self, *args, **opts):
        counts = {
            "questions": BankQuestion.objects.count(),
            "attempts": BankQuestionAttempt.objects.count() if BankQuestionAttempt else 0,
            "passages": BankPassage.objects.count(),
            "import_batches": ImportBatch.objects.count(),
        }
        self.stdout.write(f"Will delete: {counts}")

        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING("DRY-RUN — nothing deleted."))
            return
        if not opts["confirm"]:
            raise CommandError("Refusing to delete without --confirm (or use --dry-run).")

        with transaction.atomic():
            if BankQuestionAttempt:
                BankQuestionAttempt.objects.all().delete()
            BankQuestion.objects.all().delete()
            BankPassage.objects.all().delete()           # PROTECTed only while a Q points at it
            ImportBatch.objects.all().delete()

        self.stdout.write(self.style.SUCCESS(f"DELETED {counts}"))
