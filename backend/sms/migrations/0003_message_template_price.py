"""Each SMS keeps the template it was filled from and the price per part when it was claimed.

The backfill names the template on the rows sent before this: a campaign's from its campaign, a
debt warning's from the settings row (the last-day template when the text is "Bugun oxirgi kun",
the warning otherwise; the panel has only ever used the two). ``unit_price`` stays empty on old
rows: the panel counts them at today's price.
"""

from django.db import migrations, models

LAST_DAY_MARK = "Bugun oxirgi kun"


def name_the_templates(apps, schema_editor):
    SmsMessage = apps.get_model("sms", "SmsMessage")
    SmsCampaign = apps.get_model("sms", "SmsCampaign")
    SmsSettings = apps.get_model("sms", "SmsSettings")
    for campaign_id, template_id in SmsCampaign.objects.values_list("pk", "template_eskiz_id"):
        SmsMessage.objects.filter(campaign_id=campaign_id, template_eskiz_id__isnull=True).update(
            template_eskiz_id=template_id
        )
    row = SmsSettings.objects.first()
    if row is None:
        return
    debt = SmsMessage.objects.filter(kind="debt_warning", template_eskiz_id__isnull=True)
    debt.filter(text__contains=LAST_DAY_MARK).update(template_eskiz_id=row.last_day_template_id)
    debt.exclude(text__contains=LAST_DAY_MARK).update(template_eskiz_id=row.warning_template_id)


class Migration(migrations.Migration):

    dependencies = [
        ("sms", "0002_sms_panel"),
    ]

    operations = [
        migrations.AddField(
            model_name="smsmessage",
            name="template_eskiz_id",
            field=models.PositiveIntegerField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="smsmessage",
            name="unit_price",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(name_the_templates, migrations.RunPython.noop),
    ]
