"""The time machine's two commands: the day's work after each step, and the copy's seed (Part A, Task A5).

``staging_after_day`` runs under the copy's moved clock; here the clock's date is fixed by patching ``localdate()``
(called with no value) to 25 Nov 2026, a Wednesday — a lesson day for a Mon/Wed/Fri group."""

import importlib.util
import io
import json
from datetime import date
from unittest import mock, skipIf, skipUnless

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone

from billing.models import BillingRun, BillingState, Entry, EntryKind, Span, SpanRule
from billing.tests_lesson_rule import LESSON_MODE, MWF, seat_for, student
from billing.tests_shadow import NOW
from sms.models import EskizTemplate
from staging.management.commands import staging_seed
from staging.models import CapturedMessage
from staging.tests_guard import copy_on
from staging.tests_tools import LEFT_LCUP

TODAY = date(2026, 11, 25)
#: Part D (the balance SMS) is built on another branch; each half of the seed is tested where it can be.
PART_D = staging_seed.balance_warnings_installed()
BALANCE_WARNINGS = importlib.util.find_spec("sms.balance_warnings") is not None


def run(name) -> tuple[list[str], dict]:
    out = io.StringIO()
    call_command(name, "--json", stdout=out)
    lines = out.getvalue().strip().splitlines()
    return lines, json.loads(lines[-1])


def on_the_test_date():
    real = timezone.localdate

    def localdate(value=None, timezone=None):
        return TODAY if value is None else real(value, timezone)

    return mock.patch("django.utils.timezone.localdate", side_effect=localdate)


class OffTheCopyTests(TestCase):
    def test_every_command_refuses(self):
        for name in ("staging_check", "staging_after_day", "staging_seed"):
            with self.assertRaisesMessage(CommandError, "test copy"):
                call_command(name, "--json", stdout=io.StringIO())
        self.assertFalse(EskizTemplate.objects.exists())


class CheckTests(TestCase):
    """The time machine runs ``staging_check`` before its manage.py steps: a refusal (a non-zero exit) stops it."""

    def test_on_the_copy_it_names_the_database(self):
        with copy_on():
            lines, report = run("staging_check")
        self.assertEqual(len(lines), 1)
        self.assertEqual(report, {"database": connection.settings_dict["NAME"], "toolbox": True})

    def test_the_flag_with_another_database_is_refused_naming_both(self):
        with override_settings(STAGING_TOOLBOX=True, STAGING_DB_NAME="mastersat_staging"):
            with self.assertRaisesMessage(CommandError, f"{connection.settings_dict['NAME']!r}"):
                call_command("staging_check", "--json", stdout=io.StringIO())


@LESSON_MODE
@LEFT_LCUP
class AfterDayTests(TestCase):
    def setUp(self):
        state = BillingState.get()
        state.opened_at = NOW
        state.save()
        BillingRun.objects.create(
            kind=BillingRun.Kind.CUTOVER, day=date(2026, 11, 24), finished_at=NOW, ok=True,
            counts={"applied": True, "step": "finish", "mass_until": "2026-11-30"},
        )
        self.user, self.account = student()
        # Not a new student (an opening balance), so a lesson is charged, not a first month.
        Entry.objects.create(account=self.account, kind=EntryKind.OPENING, amount=0, day=date(2026, 11, 3), key="open:1")
        Span.objects.create(seat=seat_for(self.account, days=MWF, price=500_000), start=TODAY, rule=SpanRule.LESSON)

    def test_the_days_lesson_is_charged_and_reported_in_one_json_line(self):
        with copy_on(), on_the_test_date():
            lines, report = run("staging_after_day")
        self.assertEqual(len(lines), 1)
        self.assertEqual(report["test_date"], "2026-11-25")
        self.assertEqual(report["lessons"], {"count": 1, "amount": 38_500})
        self.assertEqual((report["frozen"], report["unfrozen"]), (1, 0))  # 0 − 38,500 is a debt
        self.assertEqual(report["messages"], {"sms": 0, "telegram": 0, "email": 0, "push": 0})
        self.assertEqual(report["errors"], [])
        if not BALANCE_WARNINGS:
            self.assertIn("balance warnings: not installed", report["alerts"])

    def test_a_second_run_on_the_same_day_charges_nothing_again(self):
        with copy_on(), on_the_test_date():
            run("staging_after_day")
            _, again = run("staging_after_day")
        self.assertEqual((again["lessons"], again["frozen"]), ({"count": 0, "amount": 0}, 0))

    def test_what_was_captured_on_the_day_is_counted_and_the_ticks_alerts_and_errors_kept(self):
        CapturedMessage.objects.create(channel="sms", to="998900000001", body="before the day")

        def tick():  # the day's work sends one SMS and reports trouble
            CapturedMessage.objects.create(channel="sms", to="998900000002", body="on the day")
            return mock.Mock(get=lambda: {"counts": {}, "errors": ["span 9: boom"], "alerts": ["held"]})

        with copy_on(), on_the_test_date(), mock.patch("billing.tasks.own_tick.apply", side_effect=tick):
            _, report = run("staging_after_day")
        self.assertEqual(report["messages"]["sms"], 1)
        self.assertEqual((report["errors"], report["alerts"][0]), (["span 9: boom"], "held"))

    def test_a_tick_that_waits_says_why(self):
        with copy_on(), on_the_test_date(), mock.patch(
            "billing.tasks.own_tick.apply", return_value=mock.Mock(get=lambda: {"skipped": "not opened"})
        ):
            _, report = run("staging_after_day")
        self.assertIn("lesson charges: skipped (not opened)", report["alerts"])


class SeedTests(TestCase):
    def test_the_two_templates_twice_are_the_same_two_rows(self):
        staging_seed.ensure_templates()
        staging_seed.ensure_templates()
        self.assertEqual(
            list(EskizTemplate.objects.order_by("eskiz_id").values_list("eskiz_id", "status", "pattern")),
            [
                (staging_seed.LOW_TEMPLATE_ID, "service", staging_seed.LOW_PATTERN),
                (staging_seed.FROZEN_TEMPLATE_ID, "service", staging_seed.FROZEN_PATTERN),
            ],
        )

    def test_each_template_names_one_role_a_slot(self):
        self.assertEqual(staging_seed.slots_for(staging_seed.LOW_PATTERN), ["student", "balance"])
        self.assertEqual(staging_seed.slots_for(staging_seed.FROZEN_PATTERN), ["student"])

    @skipIf(PART_D, "the balance warnings are installed here")
    def test_without_the_balance_warnings_it_says_so_and_changes_nothing(self):
        with copy_on():
            lines, report = run("staging_seed")
        self.assertEqual(len(lines), 1)
        self.assertEqual((report["templates"], report["balance_enabled"]), ([], None))
        self.assertIn("not installed", report["skipped"])
        self.assertFalse(EskizTemplate.objects.exists())

    @skipUnless(PART_D, "the balance warnings (Part D) are on another branch")
    def test_with_the_balance_warnings_twice_is_the_same(self):
        from sms.models import SmsSettings

        with copy_on():
            run("staging_seed")
            _, report = run("staging_seed")
        ids = [staging_seed.LOW_TEMPLATE_ID, staging_seed.FROZEN_TEMPLATE_ID]
        self.assertEqual(report, {"templates": ids, "balance_enabled": True})
        self.assertEqual(EskizTemplate.objects.count(), 2)
        row = SmsSettings.get()
        self.assertEqual((row.low_template_id, row.frozen_template_id, row.balance_enabled), (*ids, True))
        self.assertEqual((row.low_pattern, row.frozen_pattern), (staging_seed.LOW_PATTERN, staging_seed.FROZEN_PATTERN))
        self.assertEqual((row.low_slots, row.frozen_slots), (["student", "balance"], ["student"]))
