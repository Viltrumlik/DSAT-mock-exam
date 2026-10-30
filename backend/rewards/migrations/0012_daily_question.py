"""DAILY_QUESTION: the Question of the Day answered right first time (owner, 2026-10-30: 2 points, 2 XP).

The AlterFields are the new choice; the RunPython is the row the learning center retunes from ops.
`get_or_create`, never update: re-running must not undo a retune made since.
"""

from django.db import migrations, models

SEED_POINTS = 2


def seed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    RewardRule.objects.get_or_create(
        event="DAILY_QUESTION", defaults={"points": SEED_POINTS, "grants_xp": True}
    )


def unseed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    RewardRule.objects.filter(event="DAILY_QUESTION").delete()


class Migration(migrations.Migration):

    dependencies = [("rewards", "0011_event_attended")]

    operations = [
        migrations.AlterField(
            model_name='pointaward',
            name='event',
            field=models.CharField(choices=[('ATTENDANCE_PRESENT', 'Attended a lesson'), ('ATTENDANCE_LATE', 'Attended a lesson (late)'), ('SUPPORT_SESSION', 'Support-teacher session held'), ('SURVEY', 'Survey completed'), ('MIDTERM_PASS', 'Midterm passed'), ('MIDTERM_RETAKE_PASS', 'Midterm retake passed'), ('HOMEWORK', 'Homework completed'), ('CLASSWORK_MANUAL', 'Classwork awarded by a teacher'), ('MANUAL', 'Manual adjustment'), ('EVENT_ATTENDED', 'Attended an event'), ('DAILY_QUESTION', 'Question of the Day answered'), ('COIN_CONVERSION', 'Turned into coins'), ('HOMEWORK_FULL', 'Homework 100%'), ('HOMEWORK_HIGH', 'Homework 80–99%'), ('HOMEWORK_MID', 'Homework 60–79%')], db_index=True, max_length=40),
        ),
        migrations.AlterField(
            model_name='rewardrule',
            name='event',
            field=models.CharField(choices=[('ATTENDANCE_PRESENT', 'Attended a lesson'), ('ATTENDANCE_LATE', 'Attended a lesson (late)'), ('SUPPORT_SESSION', 'Support-teacher session held'), ('SURVEY', 'Survey completed'), ('MIDTERM_PASS', 'Midterm passed'), ('MIDTERM_RETAKE_PASS', 'Midterm retake passed'), ('HOMEWORK', 'Homework completed'), ('CLASSWORK_MANUAL', 'Classwork awarded by a teacher'), ('MANUAL', 'Manual adjustment'), ('EVENT_ATTENDED', 'Attended an event'), ('DAILY_QUESTION', 'Question of the Day answered'), ('COIN_CONVERSION', 'Turned into coins'), ('HOMEWORK_FULL', 'Homework 100%'), ('HOMEWORK_HIGH', 'Homework 80–99%'), ('HOMEWORK_MID', 'Homework 60–79%')], max_length=40, unique=True),
        ),
        migrations.RunPython(seed, unseed),
    ]
