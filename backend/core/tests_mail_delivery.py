"""PacedSender: stay under Mailgun's limit, and wait out the 421 when the limit is hit anyway.

The failures replayed here are prod's own, from the worker logs: a homework batch losing an
address to ``421 … recipient limit (26) exceeded, try again after <time>``, and the
2026-09-18 announcement where that 421 left a dead connection, and reconnecting on the spot
drew ``421 Authentication failure per IP limit exceeded``.
"""

from __future__ import annotations

import smtplib
import time
from email.utils import formatdate
from unittest.mock import patch

from django.core.mail import EmailMessage
from django.test import SimpleTestCase, override_settings

from core import mail_delivery
from core.mail_delivery import PacedSender, retry_wait


def _limit_421(seconds_from_now: float) -> smtplib.SMTPDataError:
    reopens = formatdate(time.time() + seconds_from_now, usegmt=True).replace("GMT", "UTC")
    return smtplib.SMTPDataError(
        421,
        f"Domain mg.mastersat.uz is not allowed to send: recipient limit (26) exceeded, "
        f"try again after {reopens}".encode(),
    )


_LOGIN_LIMIT_421 = smtplib.SMTPConnectError(421, b"Authentication failure per IP limit exceeded")


class FakeConnection:
    """A backend whose sends follow a shared script — one entry consumed per attempt."""

    def __init__(self, script, opened):
        self.script = script
        self.closed = False
        self.sent = []
        opened.append(self)

    def open(self):
        return True

    def close(self):
        self.closed = True

    def send_messages(self, messages):
        outcome = self.script.pop(0) if self.script else None
        if isinstance(outcome, BaseException):
            raise outcome
        self.sent.extend(messages)
        return len(messages)


class _SenderTestCase(SimpleTestCase):
    def setUp(self):
        mail_delivery._last_send_at = 0.0
        self.opened = []
        self.script = []
        self.pauses = []
        patches = [
            patch.object(
                mail_delivery, "get_connection",
                side_effect=lambda **kw: FakeConnection(self.script, self.opened),
            ),
            patch.object(mail_delivery, "_pause", side_effect=self.pauses.append),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _message(self, to="student@example.com"):
        return EmailMessage(subject="New homework", body="Hi", to=[to])

    def _delivered(self):
        return [m.to[0] for c in self.opened for m in c.sent]


class RetryWaitTests(SimpleTestCase):
    def test_a_recipient_limit_421_waits_until_the_time_mailgun_names(self):
        wait = retry_wait(_limit_421(10), attempt=1)
        # One second past the named instant, which is itself rounded to the second.
        self.assertGreaterEqual(wait, 9)
        self.assertLessEqual(wait, 12)

    def test_a_named_time_already_past_still_waits_a_second(self):
        self.assertEqual(retry_wait(_limit_421(-30), attempt=1), 1)

    def test_no_single_wait_exceeds_a_minute(self):
        self.assertEqual(retry_wait(_limit_421(600), attempt=1), 60)

    def test_a_421_with_no_time_steps_through_the_backoff(self):
        self.assertEqual(
            [retry_wait(_LOGIN_LIMIT_421, attempt=n) for n in (1, 2, 3, 4, 5, 9)],
            [5, 15, 30, 60, 60, 60],
        )

    def test_a_dropped_connection_or_network_error_is_temporary(self):
        for exc in (
            smtplib.SMTPServerDisconnected("Connection unexpectedly closed"),
            ConnectionResetError(104, "Connection reset by peer"),
            TimeoutError("timed out"),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.assertEqual(retry_wait(exc, attempt=1), 5)

    def test_a_temporary_recipient_refusal_is_waited_out(self):
        exc = smtplib.SMTPRecipientsRefused({"a@example.com": (421, b"try later")})
        self.assertEqual(retry_wait(exc, attempt=1), 5)

    def test_permanent_refusals_are_final(self):
        for exc in (
            smtplib.SMTPDataError(550, b"mailbox unavailable"),
            smtplib.SMTPRecipientsRefused({"a@example.com": (550, b"no such user")}),
            smtplib.SMTPAuthenticationError(535, b"bad credentials"),
            smtplib.SMTPNotSupportedError("SMTPUTF8 not supported"),
            ValueError("not a mail problem"),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.assertIsNone(retry_wait(exc, attempt=1))


@override_settings(EMAIL_SEND_INTERVAL_SECONDS=0, EMAIL_SEND_MAX_ATTEMPTS=5)
class RetryTests(_SenderTestCase):
    def test_a_421_is_waited_out_and_the_message_still_goes(self):
        self.script[:] = [_limit_421(8), None]

        with PacedSender("homework_email") as sender:
            sender.send(self._message())

        self.assertEqual(self._delivered(), ["student@example.com"])
        self.assertEqual(len(self.pauses), 1)
        self.assertGreaterEqual(self.pauses[0], 7)

    def test_the_retry_goes_out_on_a_fresh_connection(self):
        """Mailgun hangs up after a 421; reusing that socket is what lost 2026-09-18."""
        self.script[:] = [_limit_421(1), None]

        with PacedSender("event_email") as sender:
            sender.send(self._message())

        self.assertEqual(len(self.opened), 2)
        self.assertTrue(self.opened[0].closed)

    def test_the_announcement_cascade_now_delivers_everyone(self):
        """2026-09-18 replayed: a 421 mid-batch, the dead socket, then the per-IP login limit."""
        self.script[:] = [
            None,
            _limit_421(5),
            smtplib.SMTPServerDisconnected("please run connect() first"),
            _LOGIN_LIMIT_421,
            None,
            None,
        ]
        addresses = ["a@example.com", "b@example.com", "c@example.com"]

        with PacedSender("event_email") as sender:
            for address in addresses:
                sender.send(self._message(address))

        self.assertEqual(sorted(self._delivered()), addresses)

    def test_one_connection_carries_the_whole_batch_while_nothing_fails(self):
        with PacedSender("event_email") as sender:
            for address in ("a@example.com", "b@example.com", "c@example.com"):
                sender.send(self._message(address))

        self.assertEqual(len(self.opened), 1)
        self.assertTrue(self.opened[0].closed)  # closed on leaving the block

    def test_a_permanent_refusal_is_raised_at_once(self):
        self.script[:] = [smtplib.SMTPDataError(550, b"mailbox unavailable"), None]

        with PacedSender("homework_email") as sender:
            with self.assertRaises(smtplib.SMTPDataError):
                sender.send(self._message())

        self.assertEqual(self.pauses, [])
        self.assertEqual(self._delivered(), [])

    @override_settings(EMAIL_SEND_MAX_ATTEMPTS=3)
    def test_it_gives_up_after_the_last_attempt(self):
        self.script[:] = [_LOGIN_LIMIT_421] * 5

        with PacedSender("homework_email") as sender:
            with self.assertRaises(smtplib.SMTPConnectError):
                sender.send(self._message())

        self.assertEqual(len(self.opened), 3)
        self.assertEqual(self.pauses, [5, 15])


class PacingTests(_SenderTestCase):
    @override_settings(EMAIL_SEND_INTERVAL_SECONDS=1.25)
    def test_messages_are_spaced_by_the_interval(self):
        with PacedSender("homework_email") as sender:
            for address in ("a@example.com", "b@example.com", "c@example.com"):
                sender.send(self._message(address))

        # The first goes at once; the next two each wait out the gap.
        self.assertEqual(len(self.pauses), 2)
        for pause in self.pauses:
            self.assertAlmostEqual(pause, 1.25, delta=0.1)

    @override_settings(EMAIL_SEND_INTERVAL_SECONDS=1.25)
    def test_the_gap_carries_over_between_batches(self):
        """Five homeworks set a minute apart share one budget — 2026-08-19's burst."""
        with PacedSender("homework_email") as first:
            first.send(self._message("a@example.com"))
        with PacedSender("homework_email") as second:
            second.send(self._message("b@example.com"))

        self.assertEqual(len(self.pauses), 1)

    @override_settings(EMAIL_SEND_INTERVAL_SECONDS=0)
    def test_no_interval_means_no_wait(self):
        with PacedSender("homework_email") as sender:
            for address in ("a@example.com", "b@example.com"):
                sender.send(self._message(address))

        self.assertEqual(self.pauses, [])
