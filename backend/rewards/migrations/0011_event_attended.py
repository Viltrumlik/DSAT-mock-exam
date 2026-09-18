"""EVENT_ATTENDED: what turning up to a learning-center event pays.

The AlterFields are the new choice; the RunPython is the row the learning center retunes from ops.
`get_or_create`, never update: re-running must not undo a retune made since.
"""

from django.db import migrations, models

SEED_POINTS = 10


def seed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    RewardRule.objects.get_or_create(
        event="EVENT_ATTENDED", defaults={"points": SEED_POINTS, "grants_xp": True}
    )


def unseed(apps, schema_editor):
    RewardRule = apps.get_model("rewards", "RewardRule")
    RewardRule.objects.filter(event="EVENT_ATTENDED").delete()


class Migration(migrations.Migration):

    dependencies = [("rewards", "0010_support_session_group_ladder")]

    operations = [
        migrations.AlterField(
            model_name='pointaward',
            name='event',
            field=models.CharField(choices=[('ATTENDANCE_PRESENT', 'Attended a lesson'), ('ATTENDANCE_LATE', 'Attended a lesson (late)'), ('SUPPORT_SESSION', 'Support-teacher session held'), ('SURVEY', 'Survey completed'), ('MIDTERM_PASS', 'Midterm passed'), ('MIDTERM_RETAKE_PASS', 'Midterm retake passed'), ('HOMEWORK', 'Homework completed'), ('CLASSWORK_MANUAL', 'Classwork awarded by a teacher'), ('MANUAL', 'Manual adjustment'), ('EVENT_ATTENDED', 'Attended an event'), ('COIN_CONVERSION', 'Turned into coins'), ('HOMEWORK_FULL', 'Homework 100%'), ('HOMEWORK_HIGH', 'Homework 80–99%'), ('HOMEWORK_MID', 'Homework 60–79%')], db_index=True, max_length=40),
        ),
        migrations.AlterField(
            model_name='rewardrule',
            name='event',
            field=models.CharField(choices=[('ATTENDANCE_PRESENT', 'Attended a lesson'), ('ATTENDANCE_LATE', 'Attended a lesson (late)'), ('SUPPORT_SESSION', 'Support-teacher session held'), ('SURVEY', 'Survey completed'), ('MIDTERM_PASS', 'Midterm passed'), ('MIDTERM_RETAKE_PASS', 'Midterm retake passed'), ('HOMEWORK', 'Homework completed'), ('CLASSWORK_MANUAL', 'Classwork awarded by a teacher'), ('MANUAL', 'Manual adjustment'), ('EVENT_ATTENDED', 'Attended an event'), ('COIN_CONVERSION', 'Turned into coins'), ('HOMEWORK_FULL', 'Homework 100%'), ('HOMEWORK_HIGH', 'Homework 80–99%'), ('HOMEWORK_MID', 'Homework 60–79%')], max_length=40, unique=True),
        ),
        migrations.RunPython(seed, unseed),
    ]
