"""Backfill a JournalClasswork row for every existing HOMEWORK session.

Sessions created before the classwork model existed have no in-class plan. Services
create one lazily (``services.ensure_classwork``), but backfilling keeps
``classwork_ready`` meaningful for pre-existing journals from the first request.
"""

from django.db import migrations


def create_classwork(apps, schema_editor):
    JournalLesson = apps.get_model("journals", "JournalLesson")
    JournalClasswork = apps.get_model("journals", "JournalClasswork")

    existing = set(JournalClasswork.objects.values_list("lesson_id", flat=True))
    missing = [
        JournalClasswork(lesson_id=lesson_id)
        for lesson_id in JournalLesson.objects.filter(lesson_type="HOMEWORK")
        .exclude(id__in=existing)
        .values_list("id", flat=True)
    ]
    if missing:
        JournalClasswork.objects.bulk_create(missing, batch_size=500)


def drop_classwork(apps, schema_editor):
    # Reverse is a no-op: 0002 drops the table entirely on unapply.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("journals", "0002_remove_journallesson_deadline_time_and_more"),
    ]

    operations = [
        migrations.RunPython(create_classwork, drop_classwork),
    ]
