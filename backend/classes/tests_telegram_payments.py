"""lc-up payments announced in the class bot (plan 2026-10-16): new payments only, once each,
never a refund, never before the switch-on moment, and never from a dry-run sync."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from access import constants as C
from classes import telegram_texts as T
from classes.models import Classroom
from classes.telegram_payments import notify_new_payments
from classes.tests_telegram_group import CHAT, TOKEN, FakeTelegram
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupPayment, LcupStudentLink, LinkStatus
from users.models import User


def at(day, hour=9):
    return timezone.make_aware(datetime(2026, 10, day, hour, 0))


@override_settings(
    CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM="2026-10-15T00:00:00+05:00",
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_BROKER_URL="",
)
class PaymentMessageTests(TestCase):
    def setUp(self):
        cache.clear()
        self.tg = FakeTelegram()
        patch = self.tg.patches()
        patch.start()
        self.addCleanup(patch.stop)
        admin = User.objects.create_user("pm_admin@t.com", "x", role=C.ROLE_ADMIN)
        self.room = Classroom.objects.create(
            name="Junior G21 Math", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            created_by=admin, telegram_chat_id=CHAT,
        )
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=10, name="Junior G21 | Math | Vali", status=GroupLinkStatus.CONFIRMED,
            snapshot={}, classroom=self.room,
        )
        self.user = User.objects.create_user("pm_s@t.com", "x", telegram_bot_user_id=1001)
        self.link = LcupStudentLink.objects.create(
            lcup_student_id=101, name="Testov Aziz", user=self.user, status=LinkStatus.CONFIRMED,
            balance=Decimal(0),
        )

    def payment(self, pid, *, amount=500000, kind="payment", created=None, paid_on=date(2026, 10, 16)):
        created = created or at(16)
        return LcupPayment.objects.create(
            lcup_payment_id=pid, student=self.link, lcup_student_id=101, group=self.group,
            lcup_group_id=10, kind=kind, amount=amount, paid_on=paid_on, month="2026-10",
            created_in_lcup=created, synced_at=created,
        )

    def test_a_new_payment_is_announced_with_no_debt_left(self):
        self.payment(1)
        notify_new_payments(now=at(16, 12))
        self.assertEqual(
            self.tg.messages,
            [("1001", T.PAYMENT.format(group="Junior G21 Math", amount="500 000") + "\n" + T.PAYMENT_NO_DEBT)],
        )

    def test_the_debt_left_is_named(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=Decimal(-250000))
        self.payment(1, amount=250000)
        notify_new_payments(now=at(16, 12))
        self.assertTrue(self.tg.messages[-1][1].endswith(T.PAYMENT_DEBT_LEFT.format(debt="250 000")))

    def test_each_payment_is_announced_once(self):
        self.payment(1)
        notify_new_payments(now=at(16, 12))
        notify_new_payments(now=at(16, 13))
        self.assertEqual(len(self.tg.messages), 1)
        self.assertIsNotNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)

    def test_payments_from_before_the_switch_are_never_announced(self):
        self.payment(1, created=at(14))
        notify_new_payments(now=at(16, 12))
        self.assertEqual(self.tg.messages, [])

    def test_a_refund_is_not_announced(self):
        self.payment(1, kind="refund")
        notify_new_payments(now=at(16, 12))
        self.assertEqual(self.tg.messages, [])

    def test_a_student_without_the_bot_is_marked_and_skipped(self):
        User.objects.filter(pk=self.user.pk).update(telegram_bot_user_id=None)
        self.payment(1)
        notify_new_payments(now=at(16, 12))
        self.assertEqual(self.tg.messages, [])
        self.assertIsNotNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)

    def test_a_network_failure_is_tried_again_next_time(self):
        self.payment(1)
        self.tg.send_should_fail = True
        notify_new_payments(now=at(16, 12))
        self.assertIsNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)
        self.tg.send_should_fail = False
        notify_new_payments(now=at(16, 13))
        self.assertEqual(len(self.tg.messages), 1)

    def test_throttling_and_server_errors_are_tried_again_next_time(self):
        # 429 (slow down) and 5xx (Telegram's side) are passing; a message lost to either would
        # never be sent, because nothing re-reads a payment that is marked.
        for pid, code in ((1, 429), (2, 502)):
            self.payment(pid)
            self.tg.send_should_fail = True
            self.tg.send_error_code = code
            result = notify_new_payments(now=at(16, 12))
            self.assertEqual(result["failed"], 1, code)
            self.assertEqual(result["refused"], 0, code)
            self.assertIsNone(LcupPayment.objects.get(lcup_payment_id=pid).bot_notified_at, code)
            self.tg.send_should_fail = False
            result = notify_new_payments(now=at(16, 13))
            self.assertEqual(result["sent"], 1, code)
            self.assertIsNotNone(LcupPayment.objects.get(lcup_payment_id=pid).bot_notified_at, code)
        self.assertEqual(len(self.tg.messages), 2)

    def test_a_refused_send_is_marked_and_counted_not_retried(self):
        self.payment(1)
        self.tg.send_should_fail = True
        self.tg.send_error_code = 403  # the student blocked the bot
        with self.assertLogs("classes.telegram_payments", level="INFO") as logged:
            result = notify_new_payments(now=at(16, 12))
        self.assertEqual((result["sent"], result["skipped"], result["failed"], result["refused"]), (0, 0, 0, 1))
        self.assertIsNotNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)
        self.assertIn("refused=1", logged.output[0])
        self.tg.send_should_fail = False
        notify_new_payments(now=at(16, 13))
        self.assertEqual(self.tg.messages, [])

    def test_overlapping_runs_announce_a_payment_once(self):
        # The first run is inside its send for payment 1 when a second run starts.
        self.payment(1)
        real_send = self.tg.send_message
        entered = []
        inner = []

        def send(chat_id, text, reply_markup=None):
            if not entered:
                entered.append(True)
                inner.append(notify_new_payments(now=at(16, 13)))
            return real_send(chat_id, text, reply_markup)

        with mock.patch("classes.telegram_group_api.send_message", side_effect=send):
            notify_new_payments(now=at(16, 12))
        self.assertEqual(len(self.tg.messages), 1)
        self.assertEqual(inner[0]["sent"], 0)

    def test_a_payment_another_run_claimed_after_the_list_was_read_is_skipped(self):
        # The list this run reads holds payments 1 and 2; while 1 is being sent, another run
        # claims 2. This run must not send 2 as well.
        self.payment(1, created=at(16, 9))
        self.payment(2, created=at(16, 10))
        real_send = self.tg.send_message
        taken = []

        def send(chat_id, text, reply_markup=None):
            if not taken:
                taken.append(
                    LcupPayment.objects.filter(lcup_payment_id=2).update(bot_notified_at=at(16, 12))
                )
            return real_send(chat_id, text, reply_markup)

        with mock.patch("classes.telegram_group_api.send_message", side_effect=send):
            result = notify_new_payments(now=at(16, 12))
        self.assertEqual(taken, [1])
        self.assertEqual(len(self.tg.messages), 1)
        self.assertEqual(result["sent"], 1)

    def test_a_crash_while_sending_releases_the_claim(self):
        self.payment(1)
        with mock.patch("classes.telegram_group_api.send_message", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                notify_new_payments(now=at(16, 12))
        self.assertIsNone(LcupPayment.objects.get(lcup_payment_id=1).bot_notified_at)
        notify_new_payments(now=at(16, 13))
        self.assertEqual(len(self.tg.messages), 1)

    @override_settings(CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM="")
    def test_switched_off_nothing_is_sent(self):
        self.payment(1)
        self.assertEqual(notify_new_payments(now=at(16, 12))["status"], "off")
        self.assertEqual(self.tg.messages, [])


class SyncStageTests(TestCase):
    def test_a_dry_run_never_queues_the_messages(self):
        from lcup.sync import _queue_payment_messages

        run = mock.Mock(dry_run=True)
        with mock.patch("classes.telegram_group_hooks._dispatch") as dispatch:
            _queue_payment_messages(run)
        dispatch.assert_not_called()

    def test_a_real_run_queues_them(self):
        from classes.tasks import send_telegram_payment_messages
        from lcup.sync import _queue_payment_messages

        run = mock.Mock(dry_run=False)
        with mock.patch("classes.telegram_group_hooks._dispatch") as dispatch:
            _queue_payment_messages(run)
        dispatch.assert_called_once_with(send_telegram_payment_messages)
