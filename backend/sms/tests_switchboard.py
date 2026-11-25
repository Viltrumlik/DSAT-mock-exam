"""The panel's knobs: the env master switch over the database switch, and the templates they name."""

from django.test import TestCase, override_settings
from django.utils import timezone

from sms import conf, switchboard
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


OPEN_LEDGER = {"BILLING_PAYMENTS_OPEN": True, "BILLING_SHADOW_ENABLED": False}
LESSON = {"BILLING_MODE": "lesson"}


class BalanceEnabledTests(TestCase):
    """The balance SMS has four switches: env, the panel, the ledger being ours and pay per lesson."""

    def test_new_settings_start_switched_off_and_without_templates(self):
        row = SmsSettings.get()
        self.assertEqual((row.balance_enabled, row.balance_hour), (False, 10))
        for prefix in ("low", "frozen"):
            self.assertEqual(
                (getattr(row, f"{prefix}_template_id"), getattr(row, f"{prefix}_pattern"), getattr(row, f"{prefix}_slots")),
                (None, "", []),
            )

    @override_settings(SMS_BALANCE_WARNINGS_ENABLED=True, **OPEN_LEDGER, **LESSON)
    def test_all_four_on(self):
        configure(balance_enabled=True)
        self.assertTrue(switchboard.balance_enabled())

    @override_settings(SMS_BALANCE_WARNINGS_ENABLED=True, **OPEN_LEDGER, **LESSON)
    def test_the_panel_off_by_default_is_off(self):
        self.assertFalse(switchboard.balance_enabled())

    @override_settings(SMS_BALANCE_WARNINGS_ENABLED=False, **OPEN_LEDGER, **LESSON)
    def test_env_off(self):
        configure(balance_enabled=True)
        self.assertFalse(switchboard.balance_enabled())

    @override_settings(SMS_BALANCE_WARNINGS_ENABLED=True, BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=True, **LESSON)
    def test_the_ledger_not_ours(self):
        configure(balance_enabled=True)
        self.assertFalse(switchboard.balance_enabled())

    @override_settings(SMS_BALANCE_WARNINGS_ENABLED=True, BILLING_MODE="month", **OPEN_LEDGER)
    def test_not_paying_per_lesson(self):
        configure(balance_enabled=True)
        self.assertFalse(switchboard.balance_enabled())

    def test_env_is_off_unless_set(self):
        self.assertFalse(conf.balance_warnings_enabled())
        with override_settings(SMS_BALANCE_WARNINGS_ENABLED=True):
            self.assertTrue(conf.balance_warnings_enabled())
