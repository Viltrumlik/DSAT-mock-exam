"""A survey pays its points and nothing else — it stops counting toward XP.

The school's decision, 2026-09-01. Points are the reward for filling one in; the XP board is
for what a student has learned, and at 40 points a single questionnaire was worth two midterm
passes on it — exactly the failure the original exclusion named before it was reversed.

Migration 0006 built the lever for this and said so: "the school turns SURVEY back off with a
checkbox instead of a deploy." This is that checkbox, applied once so production and every
fresh environment agree without anybody having to remember to tick it. The checkbox itself
stays live in ``RewardRuleAdmin`` (``list_editable``), so reversing this needs no deploy —
an active rule row always outranks ``constants.XP_EXCLUDED_EVENTS``.

**An UPDATE, unlike migrations 0002 and 0006.** Those seed with ``get_or_create`` precisely so
a re-run cannot undo a retune the school has made; here the change *is* the retune, and a
migration runs once. Re-running it (a rebuilt database) re-applies the school's decision,
which is what a fresh environment should start from.

**Historical XP is deliberately not withdrawn.** Every survey already answered keeps the XP it
paid: XP has no downward direction in ``services.award`` (``max(previous_xp, …)``) and only a
withdrawn fact zeroes it. Restating hundreds of banked awards would reorder the board
overnight over a policy change, not over anything a student did — the same reasoning migration
0006 gave for not back-paying XP when the exclusion was lifted. This applies from here on.
"""

from django.db import migrations

EVENT = "SURVEY"
#: Only if the row is somehow missing. An existing row keeps whatever price it has been
#: retuned to — and a survey's real price comes from ``Survey.points_award`` regardless.
SEED_POINTS = 40


def _set(apps, grants_xp: bool):
    RewardRule = apps.get_model("rewards", "RewardRule")
    updated = RewardRule.objects.filter(event=EVENT).update(grants_xp=grants_xp)
    if not updated:
        RewardRule.objects.create(event=EVENT, points=SEED_POINTS, grants_xp=grants_xp)


def stop_granting_xp(apps, schema_editor):
    # Not filtered on `is_active`: an inactive row still has to carry the right answer for the
    # day somebody switches it back on.
    _set(apps, False)


def grant_xp_again(apps, schema_editor):
    _set(apps, True)


class Migration(migrations.Migration):

    dependencies = [("rewards", "0008_backfill_converted_points")]

    operations = [migrations.RunPython(stop_granting_xp, grant_xp_again)]
