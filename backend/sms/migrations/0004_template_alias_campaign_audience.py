from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sms", "0003_message_template_price"),
    ]

    operations = [
        migrations.AddField(
            model_name="eskiztemplate",
            name="alias",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
    ]
