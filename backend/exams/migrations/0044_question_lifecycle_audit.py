# Generated manually for question lifecycle + audit fields.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def backfill_question_status(apps, schema_editor):
    Question = apps.get_model("exams", "Question")
    Question.objects.filter(is_active=False).update(status="archived")
    Question.objects.filter(is_active=True).update(status="approved")


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("exams", "0043_alter_question_options_remove_question_order_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="question",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("review", "In review"),
                    ("approved", "Approved"),
                    ("archived", "Archived"),
                ],
                db_index=True,
                default="approved",
                max_length=16,
            ),
        ),
        migrations.RunPython(backfill_question_status, noop_reverse),
        migrations.AddField(
            model_name="question",
            name="created_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="questions_created",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="question",
            name="updated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="questions_updated",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="question",
            name="review_comment",
            field=models.TextField(blank=True, default="", help_text="Optional note from last rejection for authors."),
        ),
        migrations.AlterField(
            model_name="question",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("review", "In review"),
                    ("approved", "Approved"),
                    ("archived", "Archived"),
                ],
                db_index=True,
                default="draft",
                max_length=16,
            ),
        ),
    ]
