"""A support hour pays 10 alone, 15 each in a pair, 20 each in a three.

The school's decision, 2026-09-02. It replaces a flat rate that paid the same whether a
student came alone or brought two classmates with them — so the invitation feature, which
exists to get a second student in front of a support teacher, was worth nothing at all to the
person doing the inviting.

**This migration only sets the bottom rung.** The two above it are arithmetic, not data:
``constants.support_session_points`` adds ``SUPPORT_GROUP_STEP`` per extra head, up to
``SUPPORT_GROUP_MAX``, on top of whatever this row says. So the school retunes the whole
ladder from the one admin field they already have, and the three numbers on the rewards page
are computed from the same helper the hook pays from.

**An UPDATE, not a ``get_or_create``.** Migration 0002 seeded SUPPORT_SESSION at 10 and the
row was later retuned to 15 in the admin; leaving it there would make the ladder 15/20/25,
which is not what was asked for. Migrations 0002 and 0006 seed defensively *because* they are
re-runnable seeds — here the change is the retune itself, and a fresh database should start
from the school's current decision.

**Nothing already banked is restated.** Awards are priced when the earning is first recognised
and this rewrites no history: a student who has been paid 15 for a past solo session keeps it.
The one exception is a booking that is *touched* again afterwards — a teacher correcting a
settlement, or a student rating the hour — which re-fires the hook and re-prices that row to
the live ladder. A handful of rows at most, and the correct price is the new one.
"""

from django.db import migrations

EVENT = "SUPPORT_SESSION"
#: What one student earns from an hour they attended alone. Every rung above it is derived.
SOLO_POINTS = 10
#: What the flat rate had been retuned to before the ladder existed.
PREVIOUS_FLAT_POINTS = 15


def _price(apps, points: int):
    RewardRule = apps.get_model("rewards", "RewardRule")
    # Not filtered on `is_active`: an inactive row still has to carry the right answer for the
    # day somebody switches it back on.
    updated = RewardRule.objects.filter(event=EVENT).update(points=points)
    if not updated:
        RewardRule.objects.create(event=EVENT, points=points, grants_xp=True)


def set_solo_price(apps, schema_editor):
    _price(apps, SOLO_POINTS)


def restore_flat_price(apps, schema_editor):
    _price(apps, PREVIOUS_FLAT_POINTS)


class Migration(migrations.Migration):

    dependencies = [("rewards", "0009_survey_stops_granting_xp")]

    operations = [migrations.RunPython(set_solo_price, restore_flat_price)]
