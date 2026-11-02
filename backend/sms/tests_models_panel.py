"""The SMS panel's tables (plan 2026-10-18-sms-ops-panel, Task 1): the settings start as what is live."""

from datetime import date

from django.db import connection
from django.test import TestCase
from django.utils import timezone

from sms import templates as T
from sms.models import EskizTemplate, SmsCampaign, SmsMessage, SmsSettings


class SmsSettingsTests(TestCase):
    def test_the_defaults_are_the_live_behaviour(self):
        s = SmsSettings.get()
        self.assertTrue(s.debt_enabled)
        self.assertEqual(s.debt_hour, 10)
        self.assertEqual((s.warning_template_id, s.last_day_template_id), (64942, 52393))
        self.assertEqual(s.warning_pattern, T.DEBT_WARNING.text)
        self.assertEqual(s.last_day_pattern, T.DEBT_LAST_DAY.text)
        self.assertEqual((s.warning_slots, s.last_day_slots), (["student"], ["student"]))
        self.assertIsNone(s.updated_by)
        self.assertIsNone(s.updated_at)

    def test_the_singleton_stays_at_pk_1(self):
        first = SmsSettings.get()
        SmsSettings.get()
        stray = SmsSettings(debt_hour=12)
        stray.save()
        self.assertEqual((first.pk, stray.pk), (1, 1))
        self.assertEqual(SmsSettings.objects.count(), 1)
        self.assertEqual(SmsSettings.get().debt_hour, 12)


class EskizTemplateTests(TestCase):
    def test_usable_means_service_or_reklama(self):
        for status, usable in (("service", True), ("reklama", True), ("moderation", False), ("gone", False)):
            row = EskizTemplate(eskiz_id=1, pattern="x", status=status, synced_at=timezone.now())
            self.assertEqual(row.usable, usable, status)


class SmsCampaignTests(TestCase):
    def test_a_new_campaign_is_scheduled(self):
        campaign = SmsCampaign.objects.create(
            template_eskiz_id=64942, pattern="x %w", slot_roles=["student"], slot_texts=[""],
            audience=SmsCampaign.AUDIENCE_DEBTORS, scheduled_at=timezone.now(),
        )
        self.assertEqual(campaign.status, SmsCampaign.STATUS_SCHEDULED)
        self.assertEqual((campaign.result, campaign.audience_ids, campaign.error), ({}, [], ""))

    def test_a_message_can_belong_to_a_campaign(self):
        campaign = SmsCampaign.objects.create(
            template_eskiz_id=64942, pattern="x", audience=SmsCampaign.AUDIENCE_DEBTORS, scheduled_at=timezone.now(),
        )
        msg = SmsMessage.objects.create(
            kind=SmsMessage.KIND_CAMPAIGN, run_on=date(2026, 11, 1), dedupe_key=f"campaign:{campaign.pk}:student:1",
            phone="998901234567", text="x", campaign=campaign,
        )
        self.assertEqual(list(campaign.messages.all()), [msg])
        self.assertIn(("campaign", "Campaign"), SmsMessage.KIND_CHOICES)


class DeployWindowTests(TestCase):
    """The deploy migrates first while the old code still runs, and that code's INSERTs know nothing
    of the new columns: without a default kept on the column they would be refused."""

    def test_old_code_can_still_add_a_template(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO sms_eskiz_templates (eskiz_id, pattern, original, status, synced_at) VALUES (%s, %s, %s, %s, %s)",
                [1, "p", "o", "service", timezone.now()],
            )
        self.assertEqual(EskizTemplate.objects.get(eskiz_id=1).alias, "")

    def test_old_code_can_still_add_a_campaign(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO sms_campaigns (template_eskiz_id, pattern, original, slot_roles, slot_texts, audience,"
                " audience_ids, scheduled_at, status, result, error, created_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [1, "p", "o", "[]", "[]", "debtors", "[]", timezone.now(), "SCHEDULED", "{}", "", timezone.now()],
            )
        row = SmsCampaign.objects.get()
        self.assertEqual((row.audience_filter, row.excluded_user_ids), ({}, []))
