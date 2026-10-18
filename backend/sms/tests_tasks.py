from datetime import datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from sms import tasks
from sms.testing import FakeEskiz, configure

CONFIGURED = {"ESKIZ_EMAIL": "ops@example.uz", "ESKIZ_SECRET_KEY": "key"}


class DebtWarningsTaskTests(TestCase):
    def setUp(self):
        cache.delete(tasks.RUNNING_KEY)

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=False, **CONFIGURED)
    def test_off_by_default(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "disabled"})
        send.assert_not_called()

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, ESKIZ_EMAIL="", ESKIZ_SECRET_KEY="")
    def test_on_but_without_credentials(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "eskiz is not configured"})
        send.assert_not_called()

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, **CONFIGURED)
    def test_on_runs_the_warnings(self):
        with mock.patch("sms.debt_warnings.send", return_value={"sent": 2}) as send:
            self.assertEqual(tasks.debt_warnings(), {"sent": 2})
        send.assert_called_once()

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, **CONFIGURED)
    def test_a_run_already_going_is_not_doubled(self):
        cache.add(tasks.RUNNING_KEY, "1")
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "already running"})
        send.assert_not_called()
        cache.delete(tasks.RUNNING_KEY)

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=True, **CONFIGURED)
    def test_the_retry_run_asks_for_failed_ones_only(self):
        with mock.patch("sms.debt_warnings.send", return_value={}) as send:
            tasks.retry_debt_warnings()
        self.assertEqual(send.call_args.kwargs, {"retry_only": True})

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=False, **CONFIGURED)
    def test_the_retry_run_is_off_with_the_switch(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.retry_debt_warnings(), {"skipped": "disabled"})
        send.assert_not_called()


class CheckStatusesTaskTests(TestCase):
    @override_settings(ESKIZ_EMAIL="", ESKIZ_SECRET_KEY="")
    def test_without_credentials(self):
        self.assertEqual(tasks.check_statuses(), {"skipped": "eskiz is not configured"})

    @override_settings(**CONFIGURED)
    def test_nothing_to_check_means_no_request(self):
        with mock.patch("sms.eskiz.default_client") as client:
            self.assertEqual(tasks.check_statuses(), {"skipped": "nothing to check"})
        client.assert_not_called()


def local(hour, day=1, month=11):
    return timezone.make_aware(datetime(2026, month, day, hour, 0))


@override_settings(SMS_DEBT_WARNINGS_ENABLED=True, LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6, **CONFIGURED)
class TickTests(TestCase):
    """The beat fires every hour at :00; the hour set in /ops/sms decides which one sends."""

    def setUp(self):
        cache.delete(tasks.RUNNING_KEY)

    def tick(self, hour):
        with mock.patch("sms.debt_warnings.send", return_value={"sent": 1}) as send:
            result = tasks._tick(local(hour))
        return result, send

    def test_the_hour_runs_normally_and_the_next_two_retry(self):
        for hour, retry_only in ((10, False), (11, True), (12, True)):
            result, send = self.tick(hour)
            self.assertEqual(result, {"sent": 1})
            self.assertEqual(send.call_args.kwargs, {"retry_only": retry_only}, hour)

    def test_any_other_hour_does_nothing(self):
        for hour in (9, 13, 0, 23):
            result, send = self.tick(hour)
            self.assertEqual(result, {"skipped": "not the hour"})
            send.assert_not_called()

    def test_a_changed_hour_is_honoured(self):
        configure(debt_hour=9)
        self.assertEqual(self.tick(9)[1].call_args.kwargs, {"retry_only": False})
        self.assertEqual(self.tick(10)[1].call_args.kwargs, {"retry_only": True})
        self.assertEqual(self.tick(12)[0], {"skipped": "not the hour"})

    def test_the_panel_switch_off_is_disabled(self):
        configure(debt_enabled=False)
        result, send = self.tick(10)
        self.assertEqual(result, {"skipped": "disabled"})
        send.assert_not_called()

    def test_the_old_tasks_follow_the_panel_switch_too(self):
        configure(debt_enabled=False)
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks.debt_warnings(), {"skipped": "disabled"})
        send.assert_not_called()


@override_settings(SMS_DEBT_WARNINGS_ENABLED=True, LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6, **CONFIGURED)
class SendNowTests(TestCase):
    def setUp(self):
        cache.delete(tasks.RUNNING_KEY)

    def test_a_warning_day_runs_normally(self):
        with mock.patch("sms.debt_warnings.send", return_value={"sent": 3}) as send:
            self.assertEqual(tasks._send_now(local(15, day=3)), {"sent": 3})
        self.assertEqual(send.call_args.kwargs, {"retry_only": False})

    def test_refused_on_any_other_day(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks._send_now(local(15, day=6)), {"skipped": "not a warning day"})
        send.assert_not_called()

    def test_refused_while_switched_off(self):
        configure(debt_enabled=False)
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks._send_now(local(15, day=3)), {"skipped": "disabled"})
        send.assert_not_called()

    @override_settings(LCUP_DEBT_FREEZE_ENABLED=False)
    def test_refused_while_the_freeze_is_off(self):
        with mock.patch("sms.debt_warnings.send") as send:
            self.assertEqual(tasks._send_now(local(15, day=3)), {"skipped": "disabled"})
        send.assert_not_called()


@override_settings(**CONFIGURED)
class SyncTemplatesTaskTests(TestCase):
    def test_syncs_from_eskiz(self):
        fake = FakeEskiz(template_rows=[{"id": 1, "template": "x", "original_text": "x", "status": "service"}])
        with mock.patch("sms.eskiz.default_client", return_value=fake):
            self.assertEqual(tasks.sync_templates(), {"added": 1, "updated": 0, "gone": 0, "total": 1})

    def test_an_eskiz_error_is_reported_not_raised(self):
        with mock.patch("sms.eskiz.default_client", return_value=FakeEskiz(account_error="HTTP 500")):
            self.assertEqual(tasks.sync_templates(), {"error": "HTTP 500"})

    @override_settings(ESKIZ_EMAIL="")
    def test_without_credentials(self):
        self.assertEqual(tasks.sync_templates(), {"skipped": "eskiz is not configured"})
