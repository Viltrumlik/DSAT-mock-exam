from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sms", "0003_message_template_price"),
    ]

    operations = [
        migrations.AddField(
            model_name="eskiztemplate",
            name="alias",
            field=models.CharField(blank=True, db_default="", default="", max_length=80),
        ),
        migrations.AddField(
            model_name="smscampaign",
            name="audience_filter",
            field=models.JSONField(blank=True, db_default={}, default=dict),
        ),
        migrations.AddField(
            model_name="smscampaign",
            name="excluded_user_ids",
            field=models.JSONField(blank=True, db_default=[], default=list),
        ),
        migrations.AlterField(
            model_name="smscampaign",
            name="audience",
            field=models.CharField(
                choices=[("student", "Students"), ("group", "Group"), ("debtors", "Debtors"), ("filter", "Filter")],
                max_length=10,
            ),
        ),
    ]
