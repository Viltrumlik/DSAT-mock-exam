"""Charge for the coins that were minted before conversion cost anything.

Conversion used to be a derivation: it worked out what a season's points were worth, paid the
difference, and left the points where they were. A student could hold 340 points, hold the 34
coins those points had minted, and spend the coins without the 340 ever moving. From this
release conversion is a purchase, and the school chose to settle the old ledger rather than
let it stand — so every coin ever minted has its points deducted now, once.

**What this does, per wallet:** sum the points behind every ``EARN`` row (``amount × the rate
of the season that minted it``), stamp each row with its own ``points_spent`` so the wallet
history can show what it cost, and write ONE compensating negative ``PointAward`` per
(student, season).

**Two decisions worth knowing, because both are visible to students:**

1. **The deduction is clamped so no balance goes below zero.** The old mint was deliberately
   one-way — if points were revoked after coins were minted (a mark corrected to ABSENT, a
   re-grade dropping a bundle) the coins stayed, and the student may already have spent them.
   Settling those honestly would put a student's points into debt for an administrator's
   correction they never saw. A wallet in debt has no meaning here, so the charge stops at
   zero and the remainder is written off. The clamp is recorded in the row's ``note``.

2. **Only the CURRENT season is charged.** A closed season's points are already off every
   screen a student can reach — ``balance()`` is season-scoped — so deducting from one would
   change nothing visible and would rewrite a term the school has already closed.

**XP is untouched**, here and everywhere: these rows carry ``xp=0``. Nobody's leaderboard
position moves because of this migration, which is the property that makes it safe to run.

Reversible in the sense that matters: the reverse deletes exactly the rows this created
(matched on the ``coin-conversion-backfill:`` key prefix) and resets ``points_spent`` to 0.
"""

from __future__ import annotations

from django.db import migrations


BACKFILL_PREFIX = "coin-conversion-backfill:"


def charge_for_past_conversions(apps, schema_editor):
    CoinTransaction = apps.get_model("rewards", "CoinTransaction")
    PointAward = apps.get_model("rewards", "PointAward")
    RewardSeason = apps.get_model("rewards", "RewardSeason")

    season = RewardSeason.objects.filter(is_current=True).first()
    if season is None:
        # A database that has never awarded anything. Nothing was ever minted either.
        return

    rate_by_season = {s.pk: max(1, int(s.points_per_coin or 1)) for s in RewardSeason.objects.all()}
    default_rate = rate_by_season.get(season.pk, 10)

    # Stamp every historical mint with what it cost, in one pass per season-rate. The column
    # is the receipt shown in the wallet history; the deduction below is what moves a balance.
    owed_by_student: dict[int, int] = {}
    for tx in CoinTransaction.objects.filter(
        kind="EARN", season_id=season.pk
    ).select_related("wallet").iterator(chunk_size=2000):
        rate = rate_by_season.get(tx.season_id, default_rate)
        cost = max(0, int(tx.amount)) * rate
        if tx.points_spent != cost:
            tx.points_spent = cost
            tx.save(update_fields=["points_spent"])
        student_id = tx.wallet.student_id
        owed_by_student[student_id] = owed_by_student.get(student_id, 0) + cost

    if not owed_by_student:
        return

    # Current balances, so the charge can be clamped at zero per student.
    from django.db.models import Sum

    balances = {
        row["student_id"]: int(row["total"] or 0)
        for row in PointAward.objects.filter(
            student_id__in=list(owed_by_student), season_id=season.pk
        )
        .values("student_id")
        .annotate(total=Sum("points"))
    }

    rows = []
    for student_id, owed in owed_by_student.items():
        if owed <= 0:
            continue
        available = balances.get(student_id, 0)
        charge = min(owed, max(0, available))
        if charge <= 0:
            continue
        note = f"Settling {owed} points already turned into coins"
        if charge < owed:
            # Say so in the ledger rather than silently under-charging: somebody reading this
            # row later needs to know the difference was written off, not lost.
            note = f"{note} (charged {charge}, balance would not cover the rest)"
        rows.append(
            PointAward(
                student_id=student_id,
                season_id=season.pk,
                event="COIN_CONVERSION",
                points=-charge,
                xp=0,
                source_type="backfill",
                idempotency_key=f"{BACKFILL_PREFIX}{season.pk}:{student_id}",
                note=note[:240],
            )
        )

    # ignore_conflicts so re-running the migration on a partially-migrated database is safe;
    # the key is unique per (season, student), which is exactly one settlement each.
    PointAward.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)


def unwind(apps, schema_editor):
    PointAward = apps.get_model("rewards", "PointAward")
    CoinTransaction = apps.get_model("rewards", "CoinTransaction")
    PointAward.objects.filter(idempotency_key__startswith=BACKFILL_PREFIX).delete()
    CoinTransaction.objects.filter(kind="EARN").update(points_spent=0)


class Migration(migrations.Migration):
    dependencies = [
        ("rewards", "0007_cointransaction_points_spent_alter_pointaward_event_and_more"),
    ]

    operations = [
        migrations.RunPython(charge_for_past_conversions, unwind),
    ]
