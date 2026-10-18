"""The SMS before the debt freeze. Owner, 2026-10-18: days 1–5 every day, nothing on the 6th. Every
date is fixed: the rule reads the day of the month, so a test must never read the clock."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from lcup.models import LcupStudentLink, LinkStatus
from sms import debt_warnings
from sms.eskiz import FAILED
from sms.models import SmsMessage
from sms.templates import SmsTemplate
from sms.testing import FakeEskiz
from users.models import User

WARN = SmsTemplate(
    "debt_warning",
    "Hurmatli ota-ona, %w ning %d so'm qarzi bor. %d-sanada akkaunt muzlatiladi.",
    ("first_name", "debt", "freeze_day"),
)
NO_NAME = SmsTemplate("debt_warning", "Markazga qarzingiz bor. %d-sanagacha to'lang.", ("freeze_day",))
AZIZ_TEXT = "Hurmatli ota-ona, Aziz ning 150000 so'm qarzi bor. 6-sanada akkaunt muzlatiladi."


def at(day, month=11, hour=10):
    return timezone.make_aware(datetime(2026, month, day, hour, 0))


@override_settings(LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6)
@mock.patch("sms.templates.DEBT_WARNING", WARN)
class DebtWarningTests(TestCase):
    def learner(self, lcup_id, username, *, balance, phone="998901234567", seen=None, **link_extra):
        user = User.objects.create_user(
            None, password=None, username=username, role="student", first_name=username.title(), last_name="Testov"
        )
        link = LcupStudentLink.objects.create(
            lcup_student_id=lcup_id, name=f"Testov {username.title()}", user=user, status=LinkStatus.CONFIRMED,
            phone=phone, balance=Decimal(balance), balance_seen_at=seen or at(1, hour=9), **link_extra,
        )
        return user, link

    def test_a_debtor_is_warned_every_day_from_the_1st_to_the_5th(self):
        _, link = self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        for day in range(1, 6):
            LcupStudentLink.objects.filter(pk=link.pk).update(balance_seen_at=at(day, hour=9))
            debt_warnings.send(fake, at(day))
        self.assertEqual([(phone, text) for phone, text, _ in fake.sent], [("998901234567", AZIZ_TEXT)] * 5)
        self.assertEqual(SmsMessage.objects.filter(status=SmsMessage.STATUS_SENT).count(), 5)

    def test_nothing_on_the_freeze_day_or_after(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        for day in (6, 7, 28):
            self.assertEqual(debt_warnings.send(fake, at(day))["blocked"], "not a warning day")
        self.assertEqual(fake.sent, [])

    def test_once_a_day(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        debt_warnings.send(fake, at(1))
        counts = debt_warnings.send(fake, at(1, hour=11))
        self.assertEqual(len(fake.sent), 1)
        self.assertEqual(counts["already_sent"], 1)

    def test_who_is_not_warned(self):
        self.learner(101, "paid", balance=0)
        frozen, _ = self.learner(102, "frozen", balance=-1000)
        User.objects.filter(pk=frozen.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.learner(103, "exempt", balance=-1000, debt_freeze_exempt_at=at(1, month=10))
        self.learner(104, "left", balance=-1000, deleted_in_lcup=True)
        self.learner(105, "stale", balance=-1000, seen=at(1) - timedelta(hours=25))
        self.learner(106, "nophone", balance=-1000, phone="")
        LcupStudentLink.objects.create(lcup_student_id=107, name="No Account", phone="998907777777", balance=Decimal(-1000))
        fake = FakeEskiz()
        counts = debt_warnings.send(fake, at(1))
        self.assertEqual(fake.sent, [])
        self.assertEqual(counts["skipped"], {"not_freezable": 3, "stale_balance": 1, "no_phone": 1})

    @override_settings(LCUP_DEBT_FREEZE_ENABLED=False)
    def test_nothing_while_the_freeze_is_off(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "the debt freeze is switched off")
        self.assertEqual(fake.sent, [])

    def test_nothing_without_an_approved_template(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        with mock.patch("sms.templates.DEBT_WARNING", None):
            self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "no approved template yet")
        self.assertEqual(fake.sent, [])

    def test_siblings_on_one_phone_get_one_each_when_the_text_names_them(self):
        self.learner(101, "aziz", balance=-150000)
        self.learner(102, "malika", balance=-90000)
        fake = FakeEskiz()
        debt_warnings.send(fake, at(1))
        self.assertEqual(len(fake.sent), 2)

    def test_siblings_on_one_phone_get_one_between_them_when_it_does_not(self):
        self.learner(101, "aziz", balance=-150000)
        self.learner(102, "malika", balance=-90000)
        fake = FakeEskiz()
        with mock.patch("sms.templates.DEBT_WARNING", NO_NAME):
            counts = debt_warnings.send(fake, at(1))
        self.assertEqual(fake.sent, [("998901234567", "Markazga qarzingiz bor. 6-sanagacha to'lang.", mock.ANY)])
        self.assertEqual(counts["skipped"], {"same_phone": 1})

    def test_too_many_at_once_wait_for_a_person(self):
        self.learner(101, "aziz", balance=-150000, phone="998901111111")
        self.learner(102, "malika", balance=-90000, phone="998902222222")
        fake = FakeEskiz()
        with mock.patch("sms.debt_warnings.MAX_PER_RUN", 1):
            counts = debt_warnings.send(fake, at(1))
        self.assertIn("more than 1", counts["blocked"])
        self.assertEqual(fake.sent, [])

    def test_a_preview_of_another_day(self):
        self.learner(101, "aziz", balance=-150000, seen=at(18, month=10, hour=9))
        planned = debt_warnings.plan(at(18, month=10), today=date(2026, 11, 1))
        self.assertEqual(planned.blocked, "")
        self.assertEqual([w.link.lcup_student_id for w in planned.warnings], [101])

    def test_the_retry_run_sends_only_what_never_left(self):
        self.learner(101, "aziz", balance=-150000, phone="998901111111")
        debt_warnings.send(FakeEskiz(FAILED), at(1))
        self.learner(102, "malika", balance=-90000, phone="998902222222")
        fake = FakeEskiz()
        counts = debt_warnings.send(fake, at(1, hour=11), retry_only=True)
        self.assertEqual([phone for phone, _, _ in fake.sent], ["998901111111"])
        self.assertEqual(counts["sent"], 1)

    def test_the_retry_run_with_nothing_failed_sends_nothing(self):
        self.learner(101, "aziz", balance=-150000)
        debt_warnings.send(FakeEskiz(), at(1))
        fake = FakeEskiz()
        self.assertEqual(debt_warnings.send(fake, at(1, hour=11), retry_only=True)["blocked"], "nothing to retry")
        self.assertEqual(fake.sent, [])

    def test_one_student_going_wrong_does_not_stop_the_rest(self):
        self.learner(101, "aziz", balance=-150000, phone="998901111111")
        self.learner(102, "malika", balance=-90000, phone="998902222222")
        fake = FakeEskiz()
        real = debt_warnings.deliver

        def flaky(client, **fields):
            if fields["lcup_student_id"] == 101:
                raise RuntimeError("the database went away")
            return real(client, **fields)

        with mock.patch("sms.debt_warnings.deliver", side_effect=flaky):
            counts = debt_warnings.send(fake, at(1))
        self.assertEqual(counts["error"], 1)
        self.assertEqual([phone for phone, _, _ in fake.sent], ["998902222222"])

    def test_less_than_one_sum_is_not_a_debt_to_warn_about(self):
        self.learner(101, "aziz", balance="-0.40")
        counts = debt_warnings.send(FakeEskiz(), at(1))
        self.assertEqual(counts["skipped"], {"under_one_sum": 1})
