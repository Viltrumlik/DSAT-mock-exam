"""Seed the point values the school agreed, so they are visible and editable in ops.

The service falls back to ``constants.DEFAULT_POINTS`` when a row is missing, so this is not
load-bearing for correctness — it exists so the numbers are *findable*. Without it the only
place the school could read "a lesson is worth 5" would be a Python constant.

``get_or_create``, never update: re-running must not silently undo a retune the school has
made since.
"""

from django.db import migrations

SEED = {
    "ATTENDANCE_PRESENT": 5,
    "ATTENDANCE_LATE": 3,
    "SUPPORT_SESSION": 10,
    "SURVEY": 40,
    "MIDTERM_PASS": 20,
    "MIDTERM_RETAKE_PASS": 5,
    "HOMEWORK_FULL": 15,
    "HOMEWORK_HIGH": 10,
    "HOMEWORK_MID": 5,
    "MANUAL": 0,
}


def seed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    for event, points in SEED.items():
        RewardRule.objects.get_or_create(event=event, defaults={"points": points})


def unseed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    RewardRule.objects.filter(event__in=SEED).delete()


class Migration(migrations.Migration):

    dependencies = [("rewards", "0001_initial")]

    operations = [migrations.RunPython(seed, unseed)]
