"""Give back points and XP that a revocation took by mistake.

    python manage.py restore_revoked_awards --reason "attendance record deleted" \
        --since 2026-08-26 --until 2026-08-27              # report only
    python manage.py restore_revoked_awards ... --apply    # actually write

**Why this exists rather than a SQL UPDATE.** ``services.revoke`` zeroes an award and records
the drop in ``PointAwardAudit`` — ``previous_points`` and ``previous_xp`` are still there, so
the ledger already knows exactly what was taken and from whom. This reads that trail back and
undoes it, writing its own audit row as it goes. A hand-written UPDATE would restore the
numbers and leave the history saying they were taken, which is the state nobody can reason
about later.

**Why it is scoped by reason AND by time, and never by "everything revoked".** Most
revocations are correct and must stay: a PRESENT flipped to ABSENT, a support session nobody
attended, and — on this database — a deliberate integrity sweep on 2026-08-27 that removed
561 XP of attendance marked for lessons students had not joined. Restoring those would put
back the exact rows that sweep existed to remove. So the caller has to name the revocation
event they mean, and the default is a report.

**Idempotent.** An award that is no longer zero has been re-earned or already restored, and is
skipped. Running twice restores nothing the second time.

First use: 2026-09-09, undoing the accidental deletion of the platform's first register
(2026-08-16, deleted 2026-08-26 06:20) which took 5 points and 5 XP from each of 19 students.
"""

from __future__ import annotations

from datetime import datetime, time

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from rewards.models import PointAward, PointAwardAudit


def _aware(value: str, *, end: bool):
    """Parse a ``YYYY-MM-DD`` (or full ISO) bound into an aware datetime."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise CommandError(f"Not a date I can read: {value!r}") from exc
    if parsed.time() == time.min and len(value) == 10:
        parsed = datetime.combine(parsed.date(), time.min)
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def _display(user) -> str:
    if user is None:
        return "(no student)"
    return (f"{user.first_name} {user.last_name}".strip() or user.username or user.email)


class Command(BaseCommand):
    help = "Restore points and XP zeroed by a revocation, using the ledger's own audit trail."

    def add_arguments(self, parser):
        parser.add_argument("--reason", required=True,
                            help='The revocation reason to undo, exactly as recorded (e.g. "attendance record deleted").')
        parser.add_argument("--since", required=True, help="Inclusive lower bound, YYYY-MM-DD or ISO.")
        parser.add_argument("--until", required=True, help="Exclusive upper bound, YYYY-MM-DD or ISO.")
        parser.add_argument("--apply", action="store_true",
                            help="Write the restores. Without it this only reports.")
        parser.add_argument("--note", default="restored: revocation undone",
                            help="Reason recorded on the audit row this writes.")

    def handle(self, *args, **options):
        since, until = _aware(options["since"], end=False), _aware(options["until"], end=True)
        if since >= until:
            raise CommandError("--since must be before --until.")

        rows = (
            PointAwardAudit.objects
            .filter(reason=options["reason"], created_at__gte=since, created_at__lt=until,
                    new_points=0, new_xp=0)
            .select_related("award", "award__student")
            .order_by("award_id", "-created_at", "-id")
        )

        # One award may carry several zeroing rows; the newest is the one that took the value.
        latest: dict[int, PointAwardAudit] = {}
        for row in rows:
            latest.setdefault(row.award_id, row)

        restored = skipped = 0
        points_back = xp_back = 0
        for award_id, row in sorted(latest.items()):
            award = row.award
            gave_points = int(row.previous_points or 0)
            gave_xp = int(row.previous_xp or 0)
            if not gave_points and not gave_xp:
                continue
            if award.points != 0 or award.xp != 0:
                # Re-earned since, or already restored. Never stack a second restore on top.
                skipped += 1
                self.stdout.write(f"  skip  {_display(award.student)}: award {award_id} is not zero")
                continue

            points_back += gave_points
            xp_back += gave_xp
            restored += 1
            self.stdout.write(
                f"  {'give ' if options['apply'] else 'would'} {_display(award.student):<30} "
                f"+{gave_points} points, +{gave_xp} XP   ({award.idempotency_key})"
            )
            if not options["apply"]:
                continue
            with transaction.atomic():
                locked = PointAward.objects.select_for_update().get(pk=award_id)
                if locked.points != 0 or locked.xp != 0:
                    continue                      # raced with something else; leave it alone
                locked.points = gave_points
                locked.xp = gave_xp
                locked.save(update_fields=["points", "xp", "updated_at"])
                PointAwardAudit.objects.create(
                    award=locked, previous_points=0, new_points=gave_points,
                    previous_xp=0, new_xp=gave_xp, reason=options["note"][:240],
                )

        verb = "Restored" if options["apply"] else "Would restore"
        self.stdout.write(self.style.SUCCESS(
            f"\n{verb} {restored} award(s): +{points_back} points, +{xp_back} XP"
            + (f"   ({skipped} skipped, not zero)" if skipped else "")
        ))
        if not options["apply"] and restored:
            self.stdout.write("Nothing was written. Re-run with --apply.")
