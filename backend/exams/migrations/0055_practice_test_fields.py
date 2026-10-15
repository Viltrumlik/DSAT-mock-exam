from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("exams", "0054_mockexam_midterm_two_module_runtime"),
    ]

    operations = [
        migrations.AddField(
            model_name="practicetest",
            name="is_practice_test",
            field=models.BooleanField(db_default=False, db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="practicetest",
            name="practice_access",
            field=models.CharField(
                choices=[("open", "Open"), ("homework_only", "Homework only")],
                db_default="homework_only", default="homework_only", max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="practicetest",
            name="practice_level",
            field=models.CharField(
                blank=True,
                choices=[("foundation", "Foundation"), ("junior", "Junior"), ("middle", "Middle"), ("senior", "Senior")],
                db_default="", default="", max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="practicetest",
            name="practice_number",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="testattempt",
            name="is_timed",
            field=models.BooleanField(db_default=True, default=True),
        ),
        migrations.AddConstraint(
            model_name="practicetest",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_practice_test", True), ("practice_number__isnull", False)),
                fields=("subject", "practice_number"),
                name="uniq_practice_number_per_subject",
            ),
        ),
    ]
