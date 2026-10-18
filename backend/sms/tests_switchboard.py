"""The panel's knobs: the env master switch over the database switch, and the templates they name."""

from django.test import TestCase, override_settings
from django.utils import timezone

from sms import switchboard
from sms import templates as T
from sms.models import EskizTemplate, SmsSettings
from sms.testing import configure


class DebtEnabledTests(TestCase):
    @override_settings(SMS_DEBT_WARNINGS_ENABLED=False)
    def test_env_off_beats_the_database_on(self):
        self.assertTrue(SmsSettings.get().debt_enabled)
        self.assertFalse(switchboard.debt_enabled())

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True)
    def test_the_database_off_beats_env_on(self):
        configure(debt_enabled=False)
        self.assertFalse(switchboard.debt_enabled())

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True)
    def test_both_on(self):
        self.assertTrue(switchboard.debt_enabled())


class DebtTemplatesTests(TestCase):
    def test_the_live_templates_by_default(self):
        warning, last_day = switchboard.debt_templates()
        self.assertEqual((warning.text, warning.slots), (T.DEBT_WARNING.text, ("student",)))
        self.assertEqual((last_day.text, last_day.slots), (T.DEBT_LAST_DAY.text, ("student",)))

    def test_the_templates_follow_the_settings(self):
        configure(
            warning_pattern="Qarz %d so'm, %w{1,4}", warning_slots=["debt", "student"],
            last_day_pattern="Bugun oxirgi kun", last_day_slots=[],
        )
        warning, last_day = switchboard.debt_templates()
        self.assertEqual((warning.key, warning.text, warning.slots), ("debt_warning", "Qarz %d so'm, %w{1,4}", ("debt", "student")))
        self.assertEqual((last_day.key, last_day.text, last_day.slots), ("debt_last_day", "Bugun oxirgi kun", ()))


class NameSuffixTests(TestCase):
    def test_the_live_comma_while_the_template_is_not_cached(self):
        self.assertEqual(switchboard.name_suffix(64942, T.DEBT_WARNING), ",")

    def test_read_from_the_cached_original(self):
        EskizTemplate.objects.create(
            eskiz_id=94973, pattern="Tabriklaymiz, %w{1,4} Siz o'tdingiz.", original="Tabriklaymiz, (STUDENT)! Siz o'tdingiz.",
            status="service", synced_at=timezone.now(),
        )
        template = T.SmsTemplate("debt_warning", "Tabriklaymiz, %w{1,4} Siz o'tdingiz.", ("student",))
        self.assertEqual(switchboard.name_suffix(94973, template), "!")


class PriceTests(TestCase):
    def test_the_measured_default(self):
        with self.settings(SMS_PRICE_PER_PART=None):
            self.assertEqual(switchboard.price_per_part(), 170)

    @override_settings(SMS_PRICE_PER_PART=195)
    def test_from_the_environment(self):
        self.assertEqual(switchboard.price_per_part(), 195)
