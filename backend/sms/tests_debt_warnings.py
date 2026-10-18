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
from sms.models import EskizTemplate, SmsMessage
from sms.templates import SmsTemplate
from sms.testing import FakeEskiz, configure
from users.models import User

WARN = SmsTemplate(
    "debt_warning", "Hurmatli ota-ona, %w{1,4} farzandingizning %d so'm qarzi bor.", ("student", "debt"),
)
NO_NAME = SmsTemplate("debt_warning", "Markazga qarzingiz bor. To'lovni amalga oshiring.", ())
AZIZ_TEXT = "Hurmatli ota-ona, Testov Aziz, farzandingizning 150000 so'm qarzi bor."


def use(template, *, last_day=None, **extra):
    """The panel's settings naming ``template`` (and ``last_day``, else the same) for the debt warning."""
    last_day = last_day or template
    return configure(
        warning_pattern=template.text, warning_slots=list(template.slots),
        last_day_pattern=last_day.text, last_day_slots=list(last_day.slots), **extra,
    )


def at(day, month=11, hour=10):
    return timezone.make_aware(datetime(2026, month, day, hour, 0))


@override_settings(LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6, SMS_DEBT_WARNINGS_ENABLED=True)
class DebtWarningTests(TestCase):
    def setUp(self):
        use(WARN)

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
        configure(warning_pattern="", warning_slots=[])
        self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "no approved template yet")
        self.assertEqual(fake.sent, [])

    def test_nothing_while_the_panel_switch_is_off_but_the_list_still_shows(self):
        self.learner(101, "aziz", balance=-150000)
        configure(debt_enabled=False)
        fake = FakeEskiz()
        self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "the debt warning is switched off")
        self.assertEqual(fake.sent, [])
        self.assertEqual(len(debt_warnings.plan(at(1)).warnings), 1)

    @override_settings(SMS_DEBT_WARNINGS_ENABLED=False)
    def test_nothing_while_the_env_master_switch_is_off(self):
        self.learner(101, "aziz", balance=-150000)
        fake = FakeEskiz()
        self.assertEqual(debt_warnings.send(fake, at(1))["blocked"], "the debt warning is switched off")
        self.assertEqual(fake.sent, [])

    def test_a_template_with_a_typed_text_slot_is_refused(self):
        self.learner(101, "aziz", balance=-150000)
        use(SmsTemplate("debt_warning", "Salom %w{1,4} %w", ("student", "text")))
        fake = FakeEskiz()
        self.assertIn("only the student's name and debt", debt_warnings.send(fake, at(1))["blocked"])
        self.assertEqual(fake.sent, [])

    def test_slots_that_do_not_fit_the_pattern_are_refused(self):
        self.learner(101, "aziz", balance=-150000)
        configure(warning_pattern="Salom %w{1,4} %d", warning_slots=["student"])
        self.assertIn("do not fit", debt_warnings.send(FakeEskiz(), at(1))["blocked"])

    def test_the_name_takes_the_punctuation_of_the_cached_original(self):
        self.learner(101, "aziz", balance=-150000)
        EskizTemplate.objects.create(
            eskiz_id=64942, pattern=WARN.text, original="Hurmatli ota-ona, (STUDENT)! farzandingizning (SUM) so'm qarzi bor.",
            status="service", synced_at=at(1),
        )
        fake = FakeEskiz()
        debt_warnings.send(fake, at(1))
        self.assertEqual(fake.sent[0][1], "Hurmatli ota-ona, Testov Aziz! farzandingizning 150000 so'm qarzi bor.")

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
        use(NO_NAME)
        counts = debt_warnings.send(fake, at(1))
        self.assertEqual(fake.sent, [("998901234567", "Markazga qarzingiz bor. To'lovni amalga oshiring.", mock.ANY)])
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


    def test_the_last_day_gets_its_own_template(self):
        self.learner(101, "aziz", balance=-150000, seen=at(5, hour=9))
        use(WARN, last_day=SmsTemplate("debt_last_day", "Bugun oxirgi kun! %w{1,4} %d so'm.", ("student", "debt")))
        fake = FakeEskiz()
        debt_warnings.send(fake, at(5))
        self.assertEqual(fake.sent[0][1], "Bugun oxirgi kun! Testov Aziz, 150000 so'm.")


class RunsTests(TestCase):
    def msg(self, run_on, key, status, *, kind=SmsMessage.KIND_DEBT_WARNING, text="x", parts=None):
        return SmsMessage.objects.create(
            kind=kind, run_on=run_on, dedupe_key=key, phone="998901234567", text=text, status=status, parts=parts,
        )

    @override_settings(SMS_PRICE_PER_PART=170)
    def test_one_row_per_day_newest_first_with_the_billed_parts(self):
        self.msg(date(2026, 10, 1), "student:1", SmsMessage.STATUS_DELIVERED)
        self.msg(date(2026, 10, 1), "student:2", SmsMessage.STATUS_UNDELIVERED, parts=2)
        self.msg(date(2026, 10, 1), "student:3", SmsMessage.STATUS_FAILED)  # never left: not billed
        self.msg(date(2026, 10, 2), "student:1", SmsMessage.STATUS_DELIVERED)
        self.msg(date(2026, 10, 2), "test:1", SmsMessage.STATUS_DELIVERED, kind=SmsMessage.KIND_TEST)
        self.msg(date(2026, 7, 1), "student:1", SmsMessage.STATUS_DELIVERED)  # older than 60 days
        rows = debt_warnings.runs(now=at(18, month=10))
        self.assertEqual(rows, [
            {"run_on": "2026-10-02", "total": 1, "by_status": {"DELIVERED": 1}, "parts": 1, "cost": 170},
            {"run_on": "2026-10-01", "total": 3, "by_status": {"DELIVERED": 1, "UNDELIVERED": 1, "FAILED": 1},
             "parts": 3, "cost": 510},
        ])


@override_settings(LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6, SMS_DEBT_WARNINGS_ENABLED=True)
class ApprovedTextTests(TestCase):
    """Owner, 2026-10-18: days 1–4 #64942, day 5 #52393 ("Bugun oxirgi kun!"); the name as lc-up holds it."""

    def setUp(self):
        user = User.objects.create_user(
            None, password=None, username="malika", role="student", first_name="Malika", last_name="Karimova"
        )
        LcupStudentLink.objects.create(
            lcup_student_id=101, name="Karimova Malika", user=user, status=LinkStatus.CONFIRMED, phone="998901234567",
            balance=Decimal(-150000), balance_seen_at=at(1, hour=9),
        )

    def sent_text(self, day):
        LcupStudentLink.objects.update(balance_seen_at=at(day, hour=9))
        fake = FakeEskiz()
        debt_warnings.send(fake, at(day))
        return fake.sent[0][1]

    def test_days_1_to_4_get_the_warning(self):
        for day in (1, 4):
            self.assertEqual(self.sent_text(day), "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!")

    def test_day_5_gets_the_last_day(self):
        self.assertEqual(
            self.sent_text(5),
            "Bugun oxirgi kun! MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. Guruhdan chetlatilishingiz mumkin. To'lovni amalga oshirish uchun zudlik bilan administratsiyaga uchrang!",
        )

    def test_a_long_name_keeps_four_words_and_the_comma(self):
        LcupStudentLink.objects.update(name="Abdulloh Ali o\u2019g\u2019li Karimov Bek")
        self.assertIn("yozyabmiz. Abdulloh Ali o'g'li Karimov, sizda", self.sent_text(1))
