"""The "balance low" and "frozen for debt" SMS (owner, 2026-11-25): once per occurrence, to the parent's phone first.
Every date is fixed: ``today`` is passed in, never read from the clock."""

import itertools
from datetime import date, datetime
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from billing import ledger
from billing.models import Account, EntryKind, Seat, SeatState, Span, SpanRule
from sms import balance_warnings as bw
from sms.eskiz import FAILED
from sms.models import BalanceNotice, SmsMessage
from sms.testing import FakeEskiz, configure
from users import audience as A
from users.models import User

ON = dict(
    SMS_BALANCE_WARNINGS_ENABLED=True, BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False,
    BILLING_MODE="lesson", BILLING_LESSONS_PER_MONTH=13,
)
LOW_TEXT = "MASTER SAT: %w{1,4} hisobingizda %w{1,3} so'm qoldi."
FROZEN_TEXT = "MASTER SAT: %w{1,4} hisobingiz minusga tushdi."
D1, D2, D3 = date(2026, 11, 25), date(2026, 11, 26), date(2026, 11, 27)


def at(day, hour=10):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour, 0))


def seat_for(account, *, price=500_000, group=1, personal=None, span=True):
    seat = Seat.objects.create(
        account=account, group_name=f"G{group}", lcup_group_id=group, price=price, days=[1, 3, 5],
        state=SeatState.ACTIVE, personal_price=personal,
    )
    if span:
        Span.objects.create(seat=seat, start=date(2026, 11, 2), rule=SpanRule.LESSON)
    return seat


_keys = itertools.count(1)


def pay(account, amount, day=D1):
    """A ledger row of ``amount`` (a top-up, or a charge when negative)."""
    kind = EntryKind.PAYMENT if amount > 0 else EntryKind.CHARGE
    ledger.post(account, kind, amount, day, f"t:{account.pk}:{next(_keys)}")


@override_settings(**ON)
class BalanceWarningsTests(TestCase):
    def setUp(self):
        cache.clear()
        configure(
            balance_enabled=True, low_template_id=1, low_pattern=LOW_TEXT, low_slots=["student", "balance"],
            frozen_template_id=2, frozen_pattern=FROZEN_TEXT, frozen_slots=["student"],
        )
        self.user, self.account = self.learner("ali", parent="998901112233", own="998909998877")
        self.seat = seat_for(self.account)

    def learner(self, username, *, parent="", own="", account_phone=""):
        user = User.objects.create_user(
            None, password=None, username=username, role="student", first_name=username.title(), last_name="Testov",
            phone_number=own, parent_phone=parent,
        )
        return user, Account.objects.create(name=f"Testov {username.title()}", user=user, phone=account_phone)

    def send(self, day, fake=None):
        fake = fake or FakeEskiz()
        return fake, bw.send(fake, at(day), today=day)

    def debt_freeze(self, user=None, reason=A.FROZEN_LCUP_DEBT):
        user = user or self.user
        User.objects.filter(pk=user.pk).update(is_frozen=True, frozen_reason=reason)

    def unfreeze(self, user=None):
        User.objects.filter(pk=(user or self.user).pk).update(is_frozen=False, frozen_reason="")

    # 1
    def test_the_line_is_two_lessons_of_one_group(self):
        self.assertEqual(bw.threshold(self.account, D1), 77_000)
        pay(self.account, 77_000)
        fake, _ = self.send(D1)
        self.assertEqual(fake.sent, [])

    # 2
    def test_just_under_the_line_goes_to_the_parents_phone(self):
        pay(self.account, 76_999)
        fake, counts = self.send(D1)
        self.assertEqual(
            [(phone, text) for phone, text, _ in fake.sent],
            [("998901112233", "MASTER SAT: Testov Ali, hisobingizda 76 999 so'm qoldi.")],
        )
        self.assertEqual(counts["sent"], 1)
        message = SmsMessage.objects.get()
        self.assertEqual(
            (message.kind, message.run_on, message.dedupe_key, message.user_id, message.template_eskiz_id),
            (SmsMessage.KIND_BALANCE_LOW, D1, f"account:{self.account.pk}", self.user.pk, 1),
        )

    def test_a_balance_of_zero_is_low_and_a_debt_is_not(self):
        fake, _ = self.send(D1)
        self.assertEqual(len(fake.sent), 1)
        _, other = self.learner("vali", parent="998901112244")
        seat_for(other)
        pay(other, -1)
        fake, _ = self.send(D2)
        self.assertEqual([p for p, _, _ in fake.sent if p == "998901112244"], [])

    # 3
    def test_still_low_the_next_day_is_not_told_again(self):
        pay(self.account, 50_000)
        fake = FakeEskiz()
        self.send(D1, fake)
        self.send(D2, fake)
        self.send(D3, fake)
        self.assertEqual(len(fake.sent), 1)
        notice = BalanceNotice.objects.get(account=self.account)
        self.assertFalse(notice.low_armed)
        self.assertIsNotNone(notice.low_sent_at)

    # 4
    def test_a_top_up_above_the_line_arms_it_again(self):
        pay(self.account, 50_000)
        fake = FakeEskiz()
        self.send(D1, fake)
        pay(self.account, 100_000, D2)
        self.send(D2, fake)
        self.assertTrue(BalanceNotice.objects.get(account=self.account).low_armed)
        pay(self.account, -100_000, D3)
        self.send(D3, fake)
        self.assertEqual(len(fake.sent), 2)
        self.assertEqual(SmsMessage.objects.filter(kind=SmsMessage.KIND_BALANCE_LOW).count(), 2)

    # 5
    def test_without_a_parent_phone_the_students_own(self):
        User.objects.filter(pk=self.user.pk).update(parent_phone="")
        self.user.refresh_from_db()
        self.assertEqual(bw.phone_of(self.account), "998909998877")
        pay(self.account, 10_000)
        fake, _ = self.send(D1)
        self.assertEqual([p for p, _, _ in fake.sent], ["998909998877"])

    def test_a_parent_phone_that_is_not_a_number_falls_through_to_the_accounts(self):
        user, account = self.learner("gul", parent="12345", own="", account_phone="+998 90 777 66 55")
        self.assertEqual(bw.phone_of(account), "998907776655")

    # 6
    def test_nobody_to_tell_is_skipped_and_counted(self):
        User.objects.filter(pk=self.user.pk).update(parent_phone="", phone_number="")
        pay(self.account, 10_000)
        fake, counts = self.send(D1)
        self.assertEqual(fake.sent, [])
        self.assertEqual(counts["skipped"], {"no_phone": 1})
        self.assertEqual(SmsMessage.objects.count(), 0)

    # 7
    def test_a_debt_freeze_is_told_once_and_again_after_the_next_one(self):
        pay(self.account, -5_000)
        self.debt_freeze()
        fake = FakeEskiz()
        self.send(D1, fake)
        self.send(D2, fake)
        self.assertEqual(
            [(phone, text) for phone, text, _ in fake.sent],
            [("998901112233", "MASTER SAT: Testov Ali, hisobingiz minusga tushdi.")],
        )
        self.assertEqual(SmsMessage.objects.get().kind, SmsMessage.KIND_BALANCE_FROZEN)
        self.unfreeze()
        self.send(D2, fake)
        self.debt_freeze()
        self.send(D3, fake)
        self.assertEqual(len(fake.sent), 2)

    # 8
    def test_an_admins_freeze_is_not_a_debt_freeze(self):
        pay(self.account, -5_000)
        self.debt_freeze(reason="admin")
        fake, _ = self.send(D1)
        self.assertEqual(fake.sent, [])

    # 9
    def test_a_grant_seat_has_no_line_and_is_never_told(self):
        _, grant = self.learner("grant", parent="998901112255")
        seat_for(grant, personal=0)
        self.assertEqual(bw.threshold(grant, D1), 0)
        fake, _ = self.send(D1)
        self.assertNotIn("998901112255", [p for p, _, _ in fake.sent])

    def test_a_seat_without_a_running_lesson_span_adds_nothing(self):
        seat_for(self.account, group=2, span=False)
        Span.objects.create(
            seat=seat_for(self.account, group=3, span=False), start=date(2026, 10, 1), end=date(2026, 11, 1),
            rule=SpanRule.LESSON,
        )
        Span.objects.create(seat=seat_for(self.account, group=4, span=False), start=date(2026, 10, 1), rule=SpanRule.MONTH)
        self.assertEqual(bw.threshold(self.account, D1), 77_000)

    # 10
    def test_two_groups_add_up(self):
        seat_for(self.account, price=400_000, group=2)
        self.assertEqual(bw.threshold(self.account, D1), 2 * (38_500 + 31_000))
        pay(self.account, 138_999)
        fake, _ = self.send(D1)
        self.assertEqual(len(fake.sent), 1)

    # 11
    def test_each_switch_off_says_why(self):
        pay(self.account, 10_000)
        cases = [
            ({"SMS_BALANCE_WARNINGS_ENABLED": False}, "SMS_BALANCE_WARNINGS_ENABLED"),
            ({"BILLING_PAYMENTS_OPEN": False}, "ledger"),
            ({"BILLING_SHADOW_ENABLED": True}, "ledger"),
            ({"BILLING_MODE": "month"}, "per lesson"),
        ]
        for change, why in cases:
            fake = FakeEskiz()
            with override_settings(**change), mock.patch("sms.eskiz.default_client", return_value=fake):
                result = bw.daily(at(D1))
            self.assertEqual(list(result), ["skipped"], change)
            self.assertIn(why, result["skipped"], change)
            self.assertEqual(fake.sent, [], change)
        configure(balance_enabled=False)
        with mock.patch("sms.eskiz.default_client", return_value=FakeEskiz()):
            self.assertIn("/ops/sms", bw.daily(at(D1))["skipped"])
        configure(balance_enabled=True, low_pattern="", low_template_id=None, low_slots=[])
        with mock.patch("sms.eskiz.default_client", return_value=FakeEskiz()):
            self.assertIn("template", bw.daily(at(D1))["skipped"])
        self.assertEqual(SmsMessage.objects.count(), 0)

    def test_daily_sends_when_everything_is_on(self):
        pay(self.account, 10_000)
        fake = FakeEskiz()
        with mock.patch("sms.eskiz.default_client", return_value=fake):
            result = bw.daily(at(D1))
        self.assertEqual(result["sent"], 1)
        self.assertEqual(len(fake.sent), 1)
        self.assertIsNone(cache.get(bw.RUNNING_KEY))

    def test_a_run_already_going_is_not_doubled(self):
        pay(self.account, 10_000)
        cache.set(bw.RUNNING_KEY, "1", 60)
        with mock.patch("sms.eskiz.default_client", return_value=FakeEskiz()):
            self.assertEqual(bw.daily(at(D1)), {"skipped": "already running"})

    # 12
    def test_one_account_raising_does_not_stop_the_others(self):
        pay(self.account, 10_000)
        _, other = self.learner("vali", parent="998901112244")
        seat_for(other)
        pay(other, 10_000)
        real = bw.deliver
        calls = []

        def flaky(client, **kwargs):
            calls.append(kwargs["phone"])
            if len(calls) == 1:
                raise RuntimeError("the database went away")
            return real(client, **kwargs)

        fake = FakeEskiz()
        with mock.patch.object(bw, "deliver", flaky), self.assertLogs("sms.balance_warnings", "WARNING") as logs:
            counts = bw.send(fake, at(D1), today=D1)
        self.assertIn("RuntimeError", logs.output[0])
        self.assertNotIn("998", logs.output[0])
        self.assertEqual((counts["error"], counts["sent"]), (1, 1))
        self.assertEqual(len(fake.sent), 1)

    def test_an_sms_that_never_left_stays_armed_for_the_next_run(self):
        pay(self.account, 10_000)
        self.send(D1, FakeEskiz(FAILED))
        self.assertTrue(BalanceNotice.objects.get(account=self.account).low_armed)
        fake, _ = self.send(D2)
        self.assertEqual(len(fake.sent), 1)
        self.assertFalse(BalanceNotice.objects.get(account=self.account).low_armed)

    def test_the_plan_lists_without_writing(self):
        pay(self.account, 10_000)
        planned = bw.plan(D1)
        self.assertEqual([(n.kind, n.phone, n.values["balance"]) for n in planned.low], [
            (SmsMessage.KIND_BALANCE_LOW, "998901112233", "10 000")
        ])
        self.assertEqual(planned.frozen, [])
        self.assertEqual(SmsMessage.objects.count(), 0)
        self.assertFalse(BalanceNotice.objects.filter(low_sent_at__isnull=False).exists())

    def test_people_without_an_account_user_or_a_learner_role_are_left_out(self):
        Account.objects.create(name="No user", phone="998901000000")
        teacher = User.objects.create_user(None, password=None, username="boss", role="admin")
        seat_for(Account.objects.create(name="T", user=teacher, phone="998901000001"))
        self.assertEqual({n.account.pk for n in bw.plan(D1).low}, {self.account.pk})
