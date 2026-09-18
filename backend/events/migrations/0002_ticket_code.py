"""The ticket code, added to a table that already has rows.

Three steps in one file, and the order is the whole point: add it nullable, fill what is
there, and only then make it unique. One `AddField(unique=True)` fails the moment there is
more than one registration, because they would all start NULL.
"""

from django.db import migrations, models

ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
LENGTH = 8


def backfill(apps, schema_editor):
    import secrets

    EventRegistration = apps.get_model("events", "EventRegistration")
    taken = set(
        EventRegistration.objects.exclude(ticket_code=None).values_list("ticket_code", flat=True)
    )
    for row in EventRegistration.objects.filter(ticket_code=None).iterator():
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
            if code not in taken:
                break
        taken.add(code)
        EventRegistration.objects.filter(pk=row.pk).update(ticket_code=code)


def drop(apps, schema_editor):
    EventRegistration = apps.get_model("events", "EventRegistration")
    EventRegistration.objects.update(ticket_code=None)


class Migration(migrations.Migration):

    dependencies = [("events", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="eventregistration",
            name="ticket_code",
            field=models.CharField(blank=True, db_index=True, max_length=10, null=True),
        ),
        migrations.RunPython(backfill, drop),
        migrations.AlterField(
            model_name="eventregistration",
            name="ticket_code",
            field=models.CharField(
                blank=True, db_index=True, max_length=10, null=True, unique=True
            ),
        ),
    ]
