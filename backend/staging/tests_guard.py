"""The toolbox lives only on the test copy: the env flag AND the copy's own database name (Part A, Task A1)."""

from django.core.mail import EmailMessage, send_mail
from django.db import connection
from django.test import TestCase, override_settings

from staging.guard import toolbox_on
from staging.mail import CaptureEmailBackend
from staging.models import CapturedMessage
from staging.outbound import capture, captured


def copy_on():
    """The test copy: the flag on, and the live connection's database is the one named."""
    return override_settings(STAGING_TOOLBOX=True, STAGING_DB_NAME=connection.settings_dict["NAME"])


class GuardTests(TestCase):
    def test_off_by_default(self):
        self.assertFalse(toolbox_on())
        self.assertFalse(captured())

    def test_the_flag_on_another_database_is_off(self):
        with override_settings(STAGING_TOOLBOX=True, STAGING_DB_NAME="mastersat_staging"):
            self.assertFalse(toolbox_on())

    def test_the_database_without_the_flag_is_off(self):
        with override_settings(STAGING_TOOLBOX=False, STAGING_DB_NAME=connection.settings_dict["NAME"]):
            self.assertFalse(toolbox_on())

    def test_an_empty_database_name_is_off(self):
        with override_settings(STAGING_TOOLBOX=True, STAGING_DB_NAME=""):
            self.assertFalse(toolbox_on())

    def test_the_flag_and_the_copys_database_is_on(self):
        with copy_on():
            self.assertTrue(toolbox_on())
            self.assertTrue(captured())


class CaptureTests(TestCase):
    def test_capture_writes_one_row(self):
        capture("sms", "998901234567", "Hisobingizda 38 500 so'm qoldi.", meta={"kind": "test"})
        row = CapturedMessage.objects.get()
        self.assertEqual(
            (row.channel, row.to, row.subject, row.body, row.meta),
            ("sms", "998901234567", "", "Hisobingizda 38 500 so'm qoldi.", {"kind": "test"}),
        )
        self.assertIsNotNone(row.created_at)

    def test_an_unknown_channel_is_refused(self):
        with self.assertRaises(ValueError):
            capture("fax", "1", "hello")
        self.assertFalse(CapturedMessage.objects.exists())


class CaptureEmailBackendTests(TestCase):
    def message(self):
        return EmailMessage(
            "Your code", "It is 1234.", "MasterSAT <support@mastersat.uz>", ["a@example.com"], cc=["b@example.com"]
        )

    def test_off_it_sends_nothing_and_says_so(self):
        with self.assertLogs("staging.mail", level="WARNING"):
            sent = CaptureEmailBackend().send_messages([self.message()])
        self.assertEqual(sent, 0)
        self.assertFalse(CapturedMessage.objects.exists())

    def test_on_it_writes_the_subject_recipients_and_body(self):
        with copy_on():
            sent = CaptureEmailBackend().send_messages([self.message()])
        self.assertEqual(sent, 1)
        row = CapturedMessage.objects.get()
        self.assertEqual(
            (row.channel, row.to, row.subject, row.body),
            ("email", "a@example.com, b@example.com", "Your code", "It is 1234."),
        )
        self.assertEqual(row.meta["from"], "MasterSAT <support@mastersat.uz>")

    def test_djangos_own_send_mail_lands_in_it(self):
        with copy_on(), override_settings(EMAIL_BACKEND="staging.mail.CaptureEmailBackend"):
            self.assertEqual(send_mail("Hi", "Body", None, ["x@example.com"]), 1)
        self.assertEqual(CapturedMessage.objects.get().to, "x@example.com")
