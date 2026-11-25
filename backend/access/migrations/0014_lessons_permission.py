"""The ``manage_lessons`` permission row (owner, 2026-11-25: an admin cancels or moves a lesson day and sets a centre
holiday).

As in 0012 and 0013, roles get their permissions from code (``access.services._role_permissions_map``: the
administrator holds it, the accountant does not, the owner holds everything); this row is what a per-person tick on
the Staff page points at. A new row only: nothing existing changes.
"""

from django.db import migrations

ROW = {
    "codename": "manage_lessons",
    "name": "Cancel and move lessons",
    "description": "Call off or move a lesson day, set a centre holiday, and undo them.",
}


def add_row(apps, schema_editor):
    Permission = apps.get_model("access", "Permission")
    Permission.objects.get_or_create(
        codename=ROW["codename"], defaults={"name": ROW["name"], "description": ROW["description"]}
    )


def remove_row(apps, schema_editor):
    apps.get_model("access", "Permission").objects.filter(codename=ROW["codename"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("access", "0013_expense_permission"),
    ]

    operations = [
        migrations.RunPython(add_row, remove_row),
    ]
