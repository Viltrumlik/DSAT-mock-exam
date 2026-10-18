from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from sms import tasks

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
