"""Leaving lc-up on the evening before 1 Dec (owner, 2026-11-22 "Leave lc-up"; 2026-11-23 "Yes, part C")."""

import uuid
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from billing import cutover, ledger
from billing.models import Account, BillingRun, EndReason, Entry, EntryKind, Span, SpanRule
from billing.tests_shadow import Opened
from lcup.models import LcupStudentLink

User = get_user_model()
EVE, FIRST = date(2026, 11, 30), date(2026, 12, 1)
LEFT = override_settings(**cutover.LEFT_LCUP)
BACK = override_settings(**{**cutover.LEFT_LCUP, **cutover.WITH_LCUP})


class Base(Opened, TestCase):
    def lcup_says(self, balance, lcup_id=1):
        LcupStudentLink.objects.filter(lcup_student_id=lcup_id).update(balance=balance)

    def balance(self):
        return ledger.balance(self.account())


class PrepareTests(Base):
    def test_a_dry_run_lists_the_differences_and_keeps_nothing(self):
        self.lcup_says(-600_000)
        report = cutover.prepare(FIRST, today=EVE, apply=False, pull=False)
        self.assertEqual((report["differences"], report["adjustments"], report["net_moved"]), (1, 1, -100_000))
        self.assertEqual(report["biggest"][0]["diff"], 100_000)
        self.assertEqual(self.balance(), -500_000)
        self.assertEqual(BillingRun.objects.filter(kind=BillingRun.Kind.CUTOVER).count(), 1)  # the report is kept

    def test_applied_every_account_ends_at_lc_ups_balance_on_the_eve(self):
        self.lcup_says(-600_000)
        self.archived_student(77, 200_000, name="Paid ahead")  # lc-up holds money for someone with no account here
        cutover.prepare(FIRST, today=EVE, apply=True, pull=False)
        self.assertEqual(self.balance(), -600_000)
        row = self.account().entries.get(kind=EntryKind.ADJUST)
        self.assertEqual((row.day, row.amount), (EVE, -100_000))
        self.assertIn("lc-up's balance on 2026-11-30", row.note)
        self.assertEqual(ledger.balance(Account.objects.get(lcup_student_id=77)), 200_000)
        again = cutover.prepare(FIRST, today=EVE, apply=True, pull=False)
        self.assertEqual((again["differences"], again["adjustments"]), (0, 0))

    def test_only_on_the_day_or_the_evening_before(self):
        with self.assertRaises(cutover.CutoverRefused):
            cutover.prepare(date(2026, 12, 5), today=EVE, apply=False, pull=False)

    def test_the_pull_needs_lc_up(self):
        with override_settings(LCUP_ENABLED=False), self.assertRaises(cutover.CutoverRefused):
            cutover.prepare(FIRST, today=EVE, apply=False)


class FinishTests(Base):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(None, password=None, username="ali", role="student")
        Account.objects.filter(pk=self.account().pk).update(user=self.user)

    def test_refused_until_the_environment_is_switched(self):
        with self.assertRaises(cutover.CutoverRefused) as refused:
            cutover.finish(FIRST, today=EVE, apply=True)
        self.assertIn("BILLING_MODE", str(refused.exception))

    @LEFT
    def test_a_dry_run_keeps_nothing(self):
        report = cutover.finish(FIRST, today=EVE, apply=False)
        self.assertEqual(report["switch"]["counts"]["switched"], 1)
        self.assertEqual(report["owing_unfrozen"], 1)
        self.assertFalse(Span.objects.filter(rule=SpanRule.LESSON).exists())
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_frozen)

    @LEFT
    def test_on_the_eve_the_month_ends_whole_and_lessons_begin_on_the_first_day(self):
        cutover.finish(FIRST, today=EVE, apply=True)
        old = Span.objects.get(rule=SpanRule.MONTH)
        self.assertEqual((old.end, old.ended_by), (EVE, EndReason.SWITCH))
        new = Span.objects.get(rule=SpanRule.LESSON)
        self.assertEqual(new.start, FIRST)
        self.assertEqual(self.balance(), -500_000)  # nothing of November comes back, nothing of December charged yet
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_frozen)  # they owe, and that is the rule now
        ledger.own_tick(date(2026, 12, 2))  # Wednesday, a lesson day of Mon/Wed/Fri
        self.assertEqual(self.balance(), -538_500)

    @LEFT
    def test_too_many_freezes_wait_for_a_person(self):
        with mock.patch.object(ledger, "MAX_FREEZES_PER_TICK", 0):
            report = cutover.finish(FIRST, today=EVE, apply=True)
            self.assertTrue(any("held" in alert for alert in report["alerts"]))
            self.user.refresh_from_db()
            self.assertFalse(self.user.is_frozen)
            self.assertEqual(report["freeze_list"][0]["balance"], -500_000)
            ledger.own_tick(EVE, allow_mass=True)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_frozen)


class ReverseTests(Base):
    @LEFT
    def go_out(self):
        cutover.finish(FIRST, today=EVE, apply=True)
        ledger.enter_money(
            self.account(), EntryKind.PAYMENT, 200_000, date(2026, 12, 3), request_id=uuid.uuid4(), today=date(2026, 12, 3),
            method="Naqd pul",
        )

    def test_refused_until_lc_up_is_the_master_again(self):
        with LEFT, self.assertRaises(cutover.CutoverRefused):
            cutover.reverse(date(2026, 12, 5), since=FIRST, today=date(2026, 12, 5), apply=True)

    def test_money_entered_here_is_listed_and_voided_and_seats_go_back_to_the_month(self):
        self.go_out()
        with BACK:
            report = cutover.reverse(date(2026, 12, 5), since=FIRST, today=date(2026, 12, 5), apply=True)
        self.assertEqual([(r["kind"], r["amount"]) for r in report["enter_in_lcup"]], [("payment", 200_000)])
        self.assertFalse(Entry.objects.filter(key__startswith=ledger.MANUAL_KEY, voided_at__isnull=True).exists())
        back = Span.objects.get(rule=SpanRule.MONTH, end__isnull=True)
        self.assertEqual((back.start, back.opening_month), (date(2026, 12, 5), "2026-12"))
        self.assertFalse(back.entries.exists())  # December is lc-up's: no month charged here


class OwnTickWaitsTests(Base):
    @LEFT
    def test_the_beat_tick_waits_for_finish_and_stops_again_after_a_reverse(self):
        from billing.tasks import own_tick

        self.assertIn("has not finished", own_tick()["skipped"])
        with mock.patch("billing.cutover.timezone.localdate", return_value=EVE):
            cutover.finish(FIRST, today=EVE, apply=True)
        self.assertTrue(cutover.finished())
        self.assertNotIn("skipped", own_tick())
        cutover.finish(FIRST, today=EVE, apply=False)  # a dry run changes nothing
        self.assertTrue(cutover.finished())
        BillingRun.objects.create(kind=BillingRun.Kind.CUTOVER, counts={"step": "reverse", "applied": True})
        self.assertFalse(cutover.finished())


class CommandTests(Base):
    def test_check_says_what_is_left_to_switch(self):
        report = cutover.status()
        self.assertFalse(report["left_lcup"])
        self.assertIn("BILLING_PAYMENTS_OPEN is False, needs True", report["missing_to_leave"])

    def test_a_refusal_is_a_command_error(self):
        with self.assertRaises(CommandError):
            call_command("billing_cutover", "finish", "--day", "2026-12-01")
        with self.assertRaises(CommandError):
            call_command("billing_cutover", "prepare", "--day", "not-a-day")
