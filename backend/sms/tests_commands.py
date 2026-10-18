from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.models import LcupStudentLink, LinkStatus
from sms.models import SmsMessage
from sms.templates import SmsTemplate
from sms.testing import FakeEskiz, configure
from users.models import User

WARN = SmsTemplate("debt_warning", "Hurmatli ota-ona, %w{1,4} farzandingizning %d so'm qarzi bor.", ("student", "debt"))


def use_warn():
    configure(warning_pattern=WARN.text, warning_slots=list(WARN.slots))
CONFIGURED = {"ESKIZ_EMAIL": "ops@example.uz", "ESKIZ_SECRET_KEY": "key"}


def run(*args):
    out = StringIO()
    call_command(*args, stdout=out)
    return out.getvalue()


class FakeAccount(FakeEskiz):
    def balance(self):
        return 125000

    def nicks(self):
        return ["MasterSAT"]

    def templates(self):
        return [
            {"id": 7, "original_text": "Qarz (SUM) so'm", "template": "Qarz %w so'm", "status": "service"},
            {"id": 8, "original_text": "Qarz (SUM) soʻm", "template": "Qarz %w soʻm", "status": "service"},
        ]


@override_settings(**CONFIGURED)
class EskizAccountTests(TestCase):
    def test_prints_balance_names_and_templates_verbatim(self):
        with mock.patch("sms.management.commands.eskiz_account.default_client", return_value=FakeAccount()):
            out = run("eskiz_account")
        self.assertIn("balance: 125000", out)
        self.assertIn("MasterSAT", out)
        self.assertIn('#7 [service]\n  pattern:  "Qarz %w so\'m"\n  original: "Qarz (SUM) so\'m"', out)
        self.assertIn("#8 [service]  ! not plain ASCII", out)

    @override_settings(ESKIZ_EMAIL="")
    def test_refuses_without_credentials(self):
        with self.assertRaises(CommandError):
            run("eskiz_account")


@override_settings(**CONFIGURED)
class SmsTestTests(TestCase):
    def test_the_live_text_until_the_panel_changes_it(self):
        self.assertIn("MASTER SAT'dan yozyabmiz. Test Testov, sizda", run("sms_test", "--phone", "998901234567"))
        out = run("sms_test", "--phone", "998901234567", "--last-day")
        self.assertIn("Bugun oxirgi kun! MASTER SAT'dan yozyabmiz. Test Testov, sizda", out)

    def test_without_send_only_prints(self):
        use_warn()
        fake = FakeEskiz()
        with mock.patch("sms.management.commands.sms_test.default_client", return_value=fake):
            out = run("sms_test", "--phone", "+998 90 123 45 67")
        self.assertIn("Hurmatli ota-ona, Test Testov, farzandingizning 100000 so'm qarzi bor.", out)
        self.assertIn("not sent", out)
        self.assertEqual(fake.sent, [])

    def test_send_sends_one_test_sms(self):
        use_warn()
        fake = FakeEskiz()
        with mock.patch("sms.management.commands.sms_test.default_client", return_value=fake):
            run("sms_test", "--phone", "998901234567", "--send")
        self.assertEqual(len(fake.sent), 1)
        msg = SmsMessage.objects.get()
        self.assertEqual(
            (msg.kind, msg.status, msg.phone), (SmsMessage.KIND_TEST, SmsMessage.STATUS_SENT, "998901234567")
        )

    def test_a_bad_phone_is_refused(self):
        with self.assertRaises(CommandError):
            run("sms_test", "--phone", "12345")


@override_settings(LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6, SMS_DEBT_WARNINGS_ENABLED=True)
class ReportTests(TestCase):
    def test_lists_who_would_be_warned_masked_and_changes_nothing(self):
        use_warn()
        user = User.objects.create_user(None, password=None, username="aziz", role="student", first_name="Aziz")
        LcupStudentLink.objects.create(
            lcup_student_id=101, name="Testov Aziz", user=user, status=LinkStatus.CONFIRMED, phone="998901234567",
            balance=Decimal(-150000), balance_seen_at=timezone.now(),
        )
        out = run("sms_debt_warnings_report", "--day", "2026-11-01")
        self.assertIn("99890***4567", out)
        self.assertNotIn("998901234567", out)
        self.assertIn("Testov Aziz, farzandingizning 150000", out)
        self.assertEqual(SmsMessage.objects.count(), 0)
