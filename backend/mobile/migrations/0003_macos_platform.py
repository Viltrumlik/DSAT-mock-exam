from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("mobile", "0002_windows_platform"),
    ]

    operations = [
        migrations.AlterField(
            model_name="appreleasepolicy",
            name="platform",
            field=models.CharField(
                choices=[("ios", "iOS"), ("windows", "Windows"), ("macos", "macOS")],
                max_length=16,
                unique=True,
            ),
        ),
        migrations.AlterField(
            model_name="clientdiagnostic",
            name="platform",
            field=models.CharField(
                choices=[("ios", "iOS"), ("windows", "Windows"), ("macos", "macOS")],
                default="ios",
                max_length=16,
            ),
        ),
    ]
