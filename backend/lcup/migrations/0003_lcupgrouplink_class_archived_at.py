from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("lcup", "0002_lcupstudentlink_balance"),
    ]

    operations = [
        migrations.AddField(
            model_name="lcupgrouplink",
            name="class_archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
