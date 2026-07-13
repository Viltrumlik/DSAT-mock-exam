"""Reactivate every account: the "deactivate" (``is_active=False``) capability was
removed in favour of "freeze" as the single account restriction. Any account that
was previously deactivated is flipped back to active so it can log in again — a
frozen account then lands on the dashboard behind the non-dismissible overlay with
every other API blocked, which is the intended lockdown going forward.

Irreversible by design: the prior ``is_active=False`` state is not recorded, so the
reverse is a no-op.
"""
from __future__ import annotations

from django.db import migrations


def reactivate_all(apps, schema_editor):
    User = apps.get_model("users", "User")
    User.objects.filter(is_active=False).update(is_active=True)


def noop_reverse(apps, schema_editor):
    # Cannot restore which accounts were deactivated — the feature is gone.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0019_user_target_english_user_target_math"),
    ]

    operations = [
        migrations.RunPython(reactivate_all, noop_reverse),
    ]
