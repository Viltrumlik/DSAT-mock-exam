"""Add XP to the reward ledger, and give existing students the XP they already earned.

Shipping this with `xp = 0` everywhere would tell every student on the platform that months
of attendance and homework counted for nothing, on the day XP appears in their ranking. So
the column is backfilled — and it can be backfilled *exactly*, because XP is defined as the
high-water mark of an earning and `PointAwardAudit` has recorded every value each award has
ever held.

For each award: the largest `new_points` it was ever set to, or its current `points` if it
somehow has no audit history. Zero for the two events XP excludes. That is the same number
the live rule would have produced had it existed from the start.
"""

from django.conf import settings
from django.db import migrations, models


def backfill_xp(apps, schema_editor):
    from django.db.models import Max

    PointAward = apps.get_model("rewards", "PointAward")
    # Re-stated rather than imported from constants: a migration has to keep meaning what it
    # meant on the day it ran, and a later change to the excluded set must not silently
    # rewrite what this migration did to production.
    excluded = ("ATTENDANCE_LATE", "SURVEY")

    high_water = {
        row["id"]: int(row["peak"] or 0)
        for row in PointAward.objects.exclude(event__in=excluded)
        .annotate(peak=Max("audit_events__new_points"))
        .values("id", "peak", "points")
    }

    updates = []
    for award in PointAward.objects.exclude(event__in=excluded).only("id", "points"):
        peak = max(high_water.get(award.id, 0), int(award.points or 0))
        if peak > 0:
            award.xp = peak
            updates.append(award)
    if updates:
        PointAward.objects.bulk_update(updates, ["xp"], batch_size=1000)


def clear_xp(apps, schema_editor):
    """Reverse leg. The column is about to be dropped, so zeroing it is only for the case
    where this migration is unapplied and re-applied without a schema change in between."""
    apps.get_model("rewards", "PointAward").objects.update(xp=0)


class Migration(migrations.Migration):

    dependencies = [
        ('classes', '0042_support_cancel_reason_and_rating'),
        ('rewards', '0003_coins_wallet'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='pointaward',
            name='xp',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='pointawardaudit',
            name='new_xp',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='pointawardaudit',
            name='previous_xp',
            field=models.PositiveIntegerField(blank=True, help_text='Null on first grant.', null=True),
        ),
        migrations.AddIndex(
            model_name='pointaward',
            index=models.Index(fields=['student', 'xp'], name='reward_award_student_xp_idx'),
        ),
        # After the index, so the backfill's bulk_update writes against it rather than
        # leaving the index to be built over rows it just rewrote.
        migrations.RunPython(backfill_xp, clear_xp),
    ]
