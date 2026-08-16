"""XP becomes a per-rule flag, and homework gets a proportional event.

Two changes, one deploy:

1. ``RewardRule.grants_xp`` (default True). The old ``XP_EXCLUDED_EVENTS`` constant is now
   empty — the school asked for XP on everything — so this column is where the exclusion
   lives from here on. Defaulting True is what makes the backfill a no-op: every existing
   row keeps granting XP, which is the new rule, and the school turns SURVEY back off with a
   checkbox instead of a deploy.

2. ``HOMEWORK`` and ``CLASSWORK_MANUAL`` join the choice set, and the three
   ``HOMEWORK_FULL/HIGH/MID`` bands stay in it as legacy reads. Nothing is written with the
   bands any more, but every historical row carries one and a value outside ``choices``
   renders blank in the admin.

**Historical XP is deliberately not backfilled.** Migration 0004 already gave every student
the XP their history earned under the old rule, and it hardcodes the excluded events on
purpose. Retroactively paying XP for every late arrival and every survey ever recorded would
reorder the academic board overnight for work nobody did today; the reversal applies to what
is earned from now on.
"""

from django.db import migrations, models

# Only HOMEWORK. CLASSWORK_MANUAL is deliberately left unseeded: its amount is always the
# teacher's, exactly like MANUAL, and a 0-point row would surface in the student-facing
# "what earns what" list, which excludes MANUAL by name and knows nothing about this event.
SEED = {"HOMEWORK": 15}


def seed(apps, schema_editor):
    """Make the homework maximum findable and retunable in ops, the same as every other price.

    ``get_or_create``, never update — re-running must not undo a retune the school has made.

    The three retired band rules are deliberately left ACTIVE. Switching them off would be
    tidier, but ``/api/rewards/rules/`` serves every active rule to the student rewards page,
    so the retirement is a decision about that *view* — which still needs making, and is
    noted in the handoff, because a student now sees the three old bands alongside the new
    proportional one.
    """
    RewardRule = apps.get_model("rewards", "RewardRule")
    for event, points in SEED.items():
        RewardRule.objects.get_or_create(event=event, defaults={"points": points})


def unseed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    RewardRule.objects.filter(event__in=SEED).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('rewards', '0005_studentstrike_striketransaction'),
    ]

    operations = [
        migrations.AddField(
            model_name='rewardrule',
            name='grants_xp',
            field=models.BooleanField(default=True, help_text="Whether this event's points also earn XP."),
        ),
        migrations.AlterField(
            model_name='pointaward',
            name='event',
            field=models.CharField(choices=[('ATTENDANCE_PRESENT', 'Attended a lesson'), ('ATTENDANCE_LATE', 'Attended a lesson (late)'), ('SUPPORT_SESSION', 'Support-teacher session held'), ('SURVEY', 'Survey completed'), ('MIDTERM_PASS', 'Midterm passed'), ('MIDTERM_RETAKE_PASS', 'Midterm retake passed'), ('HOMEWORK', 'Homework completed'), ('CLASSWORK_MANUAL', 'Classwork awarded by a teacher'), ('MANUAL', 'Manual adjustment'), ('HOMEWORK_FULL', 'Homework 100%'), ('HOMEWORK_HIGH', 'Homework 80–99%'), ('HOMEWORK_MID', 'Homework 60–79%')], db_index=True, max_length=40),
        ),
        migrations.AlterField(
            model_name='rewardrule',
            name='event',
            field=models.CharField(choices=[('ATTENDANCE_PRESENT', 'Attended a lesson'), ('ATTENDANCE_LATE', 'Attended a lesson (late)'), ('SUPPORT_SESSION', 'Support-teacher session held'), ('SURVEY', 'Survey completed'), ('MIDTERM_PASS', 'Midterm passed'), ('MIDTERM_RETAKE_PASS', 'Midterm retake passed'), ('HOMEWORK', 'Homework completed'), ('CLASSWORK_MANUAL', 'Classwork awarded by a teacher'), ('MANUAL', 'Manual adjustment'), ('HOMEWORK_FULL', 'Homework 100%'), ('HOMEWORK_HIGH', 'Homework 80–99%'), ('HOMEWORK_MID', 'Homework 60–79%')], max_length=40, unique=True),
        ),
        migrations.RunPython(seed, unseed),
    ]
