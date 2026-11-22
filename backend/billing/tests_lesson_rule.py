"""Pay per lesson (owner, 2026-11-22): a new student's first month in full, then 38,500 a lesson from a balance
topped up by at least 160,000, frozen below zero. November 2026 on Mon/Wed/Fri: 2 4 6 9 11 13 16 18 20 23 25 27 30."""

import uuid
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from billing import ledger
from billing.lessons import add_one_month, lesson_days, seat_lesson_price
from billing.management.commands.billing_lessons_switch import switch
from billing.models import Account, BillingRun, BillingState, EndReason, Entry, EntryKind, Seat, SeatState, Span, SpanRule
from billing.tests_entries import EntryApiCase
from billing.tests_shadow import NOW
from lcup.models import LcupStudentLink
from users import audience as A

User = get_user_model()
MWF, TTS = [1, 3, 5], [2, 4, 6]
LESSON_MODE = override_settings(BILLING_MODE="lesson", BILLING_LESSON_PRICE=38_500, BILLING_MIN_TOPUP=160_000)


def seat_for(account, *, days=MWF, price=500_000, group=1, personal=None):
    return Seat.objects.create(
        account=account, group_name=f"G{group}", lcup_group_id=group, price=price, days=days, state=SeatState.ACTIVE,
        personal_price=personal,
    )


def student(username="ali"):
    user = User.objects.create_user(None, password=None, username=username, role="student")
    return user, Account.objects.create(name=username, user=user)


def rid():
    return uuid.uuid4()


class HelperTests(TestCase):
    def test_one_month_later_is_the_same_day_or_the_months_last(self):
        self.assertEqual(add_one_month(date(2026, 11, 22)), date(2026, 12, 22))
        self.assertEqual(add_one_month(date(2026, 1, 31)), date(2026, 2, 28))
        self.assertEqual(add_one_month(date(2026, 12, 15)), date(2027, 1, 15))

    def test_lesson_days_are_the_groups_weekdays_both_ends_included(self):
        days = lesson_days(MWF, date(2026, 11, 2), date(2026, 11, 9))
        self.assertEqual(days, [date(2026, 11, 2), date(2026, 11, 4), date(2026, 11, 6), date(2026, 11, 9)])
        self.assertEqual(lesson_days(MWF, date(2026, 11, 9), date(2026, 11, 2)), [])

    def test_a_personal_price_scales_the_lesson_and_a_grant_is_free(self):
        self.assertEqual(seat_lesson_price(38_500, 500_000, None), 38_500)
        self.assertEqual(seat_lesson_price(38_500, 500_000, 400_000), 31_000)
        self.assertEqual(seat_lesson_price(38_500, 500_000, 0), 0)


@LESSON_MODE
class NewStudentTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="New")
        self.seat = seat_for(self.account)

    def test_a_new_seat_takes_the_rule_from_the_switch(self):
        span = ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 11, 2))
        self.assertEqual(span.rule, SpanRule.LESSON)

    def test_the_first_month_is_the_whole_price_and_covers_a_month_of_lessons(self):
        ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 11, 30))
        row = self.account.entries.get()
        self.assertEqual(
            (row.amount, row.day, row.key, row.seat_id), (-500_000, date(2026, 11, 2), f"first:{self.account.pk}", self.seat.pk)
        )
        self.assertEqual(ledger.balance(self.account), -500_000)

    def test_after_the_first_month_each_lesson_is_charged_on_its_day(self):
        ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 12, 9))
        lessons = self.account.entries.filter(key__startswith="lesson:").order_by("day")
        self.assertEqual(
            [(row.day, row.amount) for row in lessons],
            [(date(2026, 12, d), -38_500) for d in (2, 4, 7, 9)],
        )
        self.assertEqual(ledger.balance(self.account), -500_000 - 4 * 38_500)

    def test_billing_twice_writes_nothing_twice(self):
        span = ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 12, 9))
        ledger.bill_span(span, date(2026, 12, 9))
        ledger.bill_open_spans(date(2026, 12, 9))
        self.assertEqual(self.account.entries.count(), 5)

    def test_a_seat_that_has_not_begun_writes_nothing_yet(self):
        span = ledger.start_span(self.seat, date(2026, 11, 30), today=date(2026, 11, 25))
        self.assertEqual(self.account.entries.count(), 0)
        ledger.bill_span(span, date(2026, 11, 30))
        self.assertEqual(ledger.balance(self.account), -500_000)

    def test_a_second_group_pays_per_lesson_from_its_first_day(self):
        ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 11, 7))
        other = seat_for(self.account, days=TTS, group=2)
        ledger.start_span(other, date(2026, 11, 3), today=date(2026, 11, 7))
        self.assertEqual(
            sorted(other.entries.values_list("day", "amount")),
            [(date(2026, 11, 3), -38_500), (date(2026, 11, 5), -38_500), (date(2026, 11, 7), -38_500)],
        )

    def test_coming_back_from_a_freeze_inside_the_first_month_is_still_covered(self):
        span = ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 11, 9))
        ledger.end_span(span, date(2026, 11, 9), EndReason.FREEZE, today=date(2026, 11, 9))
        ledger.start_span(self.seat, date(2026, 11, 23), today=date(2026, 12, 4))
        lessons = self.account.entries.filter(key__startswith="lesson:", voided_at__isnull=True)
        self.assertEqual(sorted(lessons.values_list("day", flat=True)), [date(2026, 12, 2), date(2026, 12, 4)])

    def test_leaving_takes_back_the_lessons_after_it_but_not_the_first_month(self):
        span = ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 12, 9))
        ledger.end_span(span, date(2026, 12, 4), EndReason.LEAVE, today=date(2026, 12, 9))
        self.assertEqual(ledger.balance(self.account), -500_000 - 2 * 38_500)

    def test_a_seat_called_off_before_it_began_leaves_nothing(self):
        span = ledger.start_span(self.seat, date(2026, 11, 11), today=date(2026, 11, 13))
        ledger.end_span(span, date(2026, 11, 10), EndReason.LEAVE, today=date(2026, 11, 13))
        self.assertEqual(ledger.balance(self.account), 0)

    def test_a_date_fixed_writes_the_first_month_again_from_the_new_day(self):
        span = ledger.start_span(self.seat, date(2026, 11, 9), today=date(2026, 11, 13))
        ledger.move_span(span, start=date(2026, 11, 4), today=date(2026, 11, 13), reason="typed wrong")
        row = self.account.entries.get(voided_at__isnull=True)
        self.assertEqual((row.day, row.amount), (date(2026, 11, 4), -500_000))

    def test_a_personal_price_keeps_the_lessons_already_written(self):
        account = Account.objects.create(name="Old")
        Entry.objects.create(account=account, kind=EntryKind.OPENING, amount=0, day=date(2026, 11, 1), key="open:x")
        seat = seat_for(account)
        ledger.start_span(seat, date(2026, 11, 2), today=date(2026, 11, 4))
        ledger.set_personal_price(seat, 400_000, reason="sibling", by=None, today=date(2026, 11, 4))
        ledger.bill_open_spans(date(2026, 11, 6))
        self.assertEqual(
            sorted(seat.entries.filter(voided_at__isnull=True).values_list("day", "amount")),
            [(date(2026, 11, 2), -38_500), (date(2026, 11, 4), -38_500), (date(2026, 11, 6), -31_000)],
        )


@LESSON_MODE
class ExistingStudentTests(TestCase):
    def test_someone_with_an_opening_balance_pays_per_lesson_from_day_one(self):
        account = Account.objects.create(name="Old")
        Entry.objects.create(account=account, kind=EntryKind.OPENING, amount=-100_000, day=date(2026, 11, 1), key="open:1")
        ledger.start_span(seat_for(account), date(2026, 11, 2), today=date(2026, 11, 9))
        self.assertEqual(ledger.balance(account), -100_000 - 4 * 38_500)
        self.assertFalse(account.entries.filter(key__startswith="first:").exists())


class MonthModeUnchangedTests(TestCase):
    def test_without_the_switch_a_seat_is_billed_by_the_month(self):
        account = Account.objects.create(name="Old")
        span = ledger.start_span(seat_for(account), date(2026, 11, 2), today=date(2026, 11, 9))
        self.assertEqual(span.rule, SpanRule.MONTH)
        self.assertEqual(ledger.balance(account), -500_000)


class PaymentTests(TestCase):
    def setUp(self):
        state = BillingState.get()
        state.opened_at = NOW
        state.save()
        self.account = Account.objects.create(name="New")
        self.today = date(2026, 11, 10)

    def pay(self, amount, account=None):
        return ledger.enter_money(
            account or self.account, EntryKind.PAYMENT, amount, self.today, request_id=rid(), today=self.today,
            method="Naqd pul",
        )

    @LESSON_MODE
    def test_a_new_students_first_payment_is_the_whole_first_month(self):
        ledger.start_span(seat_for(self.account), date(2026, 11, 9), today=self.today)
        with self.assertRaisesMessage(ledger.EntryRefused, "at least 500,000 so'm"):
            self.pay(400_000)
        self.pay(500_000)
        self.assertEqual(ledger.balance(self.account), 0)

    @LESSON_MODE
    def test_after_that_a_top_up_is_at_least_160000(self):
        ledger.start_span(seat_for(self.account), date(2026, 11, 9), today=self.today)
        self.pay(500_000)
        with self.assertRaisesMessage(ledger.EntryRefused, "A top-up is at least 160,000 so'm."):
            self.pay(100_000)
        self.pay(160_000)

    @LESSON_MODE
    def test_someone_who_is_not_new_tops_up_160000_at_least(self):
        Entry.objects.create(account=self.account, kind=EntryKind.OPENING, amount=-50_000, day=date(2026, 11, 4), key="open:2")
        with self.assertRaisesMessage(ledger.EntryRefused, "160,000"):
            self.pay(159_000)
        self.pay(160_000)

    @LESSON_MODE
    def test_a_refund_has_no_minimum(self):
        Entry.objects.create(account=self.account, kind=EntryKind.OPENING, amount=200_000, day=date(2026, 11, 4), key="open:3")
        ledger.enter_money(
            self.account, EntryKind.REFUND, 10_000, self.today, request_id=rid(), today=self.today, method="Naqd pul"
        )
        self.assertEqual(ledger.balance(self.account), 190_000)

    def test_paying_by_the_month_has_no_minimum(self):
        self.pay(10_000)
        self.assertEqual(ledger.balance(self.account), 10_000)


@LESSON_MODE
class DebtFreezeTests(TestCase):
    def setUp(self):
        self.user, self.account = student()

    def fresh(self):
        self.user.refresh_from_db()
        return self.user

    def test_below_zero_freezes_and_paying_lifts_it(self):
        ledger.post(self.account, EntryKind.CHARGE, -38_500, date(2026, 11, 4), "c1")
        self.assertEqual(ledger.apply_debt_freeze(self.account), "frozen")
        self.assertEqual((self.fresh().is_frozen, self.fresh().frozen_reason), (True, A.FROZEN_LCUP_DEBT))
        ledger.post(self.account, EntryKind.PAYMENT, 160_000, date(2026, 11, 4), "p1")
        self.assertEqual(ledger.apply_debt_freeze(self.account), "unfrozen")
        self.assertFalse(self.fresh().is_frozen)

    def test_zero_is_not_debt(self):
        self.assertIsNone(ledger.apply_debt_freeze(self.account))
        self.assertFalse(self.fresh().is_frozen)

    def test_an_admins_own_freeze_is_never_lifted(self):
        self.user.is_frozen, self.user.frozen_reason = True, ""
        self.user.save()
        self.assertIsNone(ledger.apply_debt_freeze(self.account))
        self.assertTrue(self.fresh().is_frozen)

    def test_an_exempt_student_is_not_frozen(self):
        LcupStudentLink.objects.create(lcup_student_id=7, name="ali", user=self.user, debt_freeze_exempt_at=timezone.now())
        ledger.post(self.account, EntryKind.CHARGE, -38_500, date(2026, 11, 4), "c1")
        self.assertIsNone(ledger.apply_debt_freeze(self.account))
        self.assertFalse(self.fresh().is_frozen)

    def test_staff_are_never_frozen_for_debt(self):
        boss = User.objects.create_user(None, password=None, username="boss", role="admin")
        account = Account.objects.create(name="boss", user=boss)
        ledger.post(account, EntryKind.CHARGE, -38_500, date(2026, 11, 4), "c2")
        self.assertIsNone(ledger.apply_debt_freeze(account))


@LESSON_MODE
class OwnTickTests(TestCase):
    def test_the_tick_bills_and_freezes(self):
        user, account = student()
        ledger.start_span(seat_for(account), date(2026, 11, 2), today=date(2026, 11, 2))
        result = ledger.own_tick(date(2026, 11, 4))
        self.assertEqual(result["counts"], {"debt_frozen": 1})
        user.refresh_from_db()
        self.assertTrue(user.is_frozen)
        self.assertEqual(BillingRun.objects.get().counts, {"debt_frozen": 1})

    def test_too_many_freezes_at_once_wait_for_a_person(self):
        for n in range(ledger.MAX_FREEZES_PER_TICK + 1):
            _, account = student(f"s{n}")
            ledger.post(account, EntryKind.CHARGE, -38_500, date(2026, 11, 4), f"c{n}")
        result = ledger.own_tick(date(2026, 11, 4))
        self.assertEqual(result["counts"], {"debt_freezes_held": ledger.MAX_FREEZES_PER_TICK + 1})
        self.assertFalse(User.objects.filter(is_frozen=True).exists())
        ledger.own_tick(date(2026, 11, 4), allow_mass=True)
        self.assertEqual(User.objects.filter(is_frozen=True).count(), ledger.MAX_FREEZES_PER_TICK + 1)

    @override_settings(BILLING_PAYMENTS_OPEN=False)
    def test_the_task_waits_while_the_ledger_follows_lc_up(self):
        from billing.tasks import own_tick

        self.assertEqual(own_tick(), {"skipped": "the ledger still follows lc-up"})


@LESSON_MODE
class SwitchTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="Old")
        Entry.objects.create(account=self.account, kind=EntryKind.OPENING, amount=0, day=date(2026, 10, 31), key="open:4")
        self.seat = seat_for(self.account)
        with override_settings(BILLING_MODE="month"):
            self.span = ledger.start_span(self.seat, date(2026, 11, 2), today=date(2026, 11, 22))

    def test_mid_month_the_rest_of_the_month_comes_back_and_lessons_are_charged(self):
        self.assertEqual(ledger.balance(self.account), -500_000)
        report = switch(date(2026, 11, 23), date(2026, 11, 23))
        self.assertEqual(report["counts"], {"switched": 1})
        # 9 of 13 lessons kept: 346,000; 154,000 comes back; Monday 23 is the first lesson paid per lesson.
        self.assertEqual(ledger.balance(self.account), -346_000 - 38_500)
        self.span.refresh_from_db()
        self.assertEqual((self.span.end, self.span.ended_by), (date(2026, 11, 22), EndReason.SWITCH))
        new = self.seat.spans.get(end__isnull=True)
        self.assertEqual(new.rule, SpanRule.LESSON)
        self.assertFalse(self.account.entries.filter(key__startswith="first:").exists())

    def test_switching_twice_changes_nothing_more(self):
        switch(date(2026, 11, 23), date(2026, 11, 23))
        report = switch(date(2026, 11, 23), date(2026, 11, 23))
        self.assertEqual((report["counts"], report["rows_written"]), ({}, 0))


@LESSON_MODE
@override_settings(BILLING_PAYMENTS_OPEN=True)
class LessonApiTests(EntryApiCase, TestCase):
    def test_a_top_up_below_the_minimum_is_refused_in_words(self):
        response = self.post(self.url(), self.body(amount=100_000))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "A top-up is at least 160,000 so'm.")
        self.assertEqual(self.post(self.url(), self.body(amount=160_000)).status_code, 201)

    def test_the_account_says_how_it_is_charged(self):
        rules = self.get(f"/api/billing/accounts/{self.account().pk}/").json()["rules"]
        self.assertEqual(
            (rules["mode"], rules["lesson_price"], rules["min_topup"], rules["least_payment"]),
            ("lesson", 38_500, 160_000, 160_000),
        )

    def test_a_payment_lifts_the_debt_freeze_at_once(self):
        user = User.objects.create_user(None, password=None, username="kid", role="student")
        user.is_frozen, user.frozen_reason = True, A.FROZEN_LCUP_DEBT
        user.save()
        account = Account.objects.create(name="kid", user=user)
        Entry.objects.create(account=account, kind=EntryKind.OPENING, amount=-100_000, day=date(2026, 11, 4), key="open:kid")
        url = f"/api/billing/accounts/{account.pk}/entries/"
        self.assertEqual(self.post(url, self.body(amount=160_000)).status_code, 201)
        user.refresh_from_db()
        self.assertFalse(user.is_frozen)

    def test_lesson_rows_say_lesson(self):
        account = self.account()
        span = Span.objects.filter(seat__account=account).first()
        ledger.post(account, EntryKind.CHARGE, -38_500, date.today() - timedelta(days=1), f"lesson:{span.pk}:x", span=span)
        rows = self.get(f"/api/billing/accounts/{account.pk}/").json()["rows"]
        self.assertIn("Lesson", [row["label"] for row in rows])
