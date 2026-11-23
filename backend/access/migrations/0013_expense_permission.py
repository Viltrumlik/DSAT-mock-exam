"""The ``manage_expenses`` permission row (leaving lc-up, owner 2026-11-22: expenses move into the console too).

As in 0012, roles get their permissions from code (``access.services._role_permissions_map``); this row is what a
per-person tick on the Staff page points at. A new row only: nothing existing changes.
"""

from django.db import migrations

ROW = ("manage_expenses", "Manage expenses", "Enter and void the centre's expenses, and keep their categories.")


def add_row(apps, schema_editor):
    Permission = apps.get_model("access", "Permission")
    codename, name, description = ROW
    Permission.objects.get_or_create(codename=codename, defaults={"name": name, "description": description})


def remove_row(apps, schema_editor):
    apps.get_model("access", "Permission").objects.filter(codename=ROW[0]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("access", "0012_crm_permissions"),
    ]

    operations = [
        migrations.RunPython(add_row, remove_row),
    ]
