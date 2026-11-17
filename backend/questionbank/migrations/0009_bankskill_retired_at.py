"""A level topic an admin retires from the builder's Topics page.

A nullable column with no default: an instant metadata change on Postgres, and the code
running before this release never reads it.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("questionbank", "0008_foundation_math_topics"),
    ]

    operations = [
        migrations.AddField(
            model_name="bankskill",
            name="retired_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
