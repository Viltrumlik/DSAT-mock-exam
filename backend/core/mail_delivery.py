"""Bulk mail that stays under Mailgun's sending limit instead of tripping it.

Mailgun throttles ``mg.mastersat.uz`` to roughly 26 recipients per 30-second window. Over it,
the relay answers ``421 … recipient limit (26) exceeded, try again after <time>`` and hangs
up; prod's logs show those ``<time>`` values stepping exactly 30 s apart. Until this module,
every fan-out sent as fast as SMTP allowed and treated that 421 as a final failure:

* homework and midterm lost the few addresses that landed inside a throttled window
  (26 homework emails on 2026-08-19 alone, across five assignments set a minute apart), and
* the 2026-09-18 event announcement lost 242 of 372 — after the 421 the shared connection
  was dead, and reconnecting on the spot drew ``421 Authentication failure per IP limit
  exceeded`` on top.

``PacedSender`` does two things about it:

* **Pace.** Each process waits ``EMAIL_SEND_INTERVAL_SECONDS`` between messages — 24 per
  30 s at the default, under the limit on its own. The gap is per process, not per batch,
  so five homeworks set back to back share one budget instead of each starting fresh.
* **Wait out a 421.** A temporary (4xx) refusal or a dropped connection is retried on a
  fresh connection after the wait Mailgun named, or a stepped backoff when it named none.
  A permanent (5xx) refusal — a bad address, a rejected login — is raised at once: waiting
  cannot fix it.

Two workers sending at once can still overshoot the window together; the 421 retry is what
covers that. The interval is off under tests (see settings), so a suite never sleeps.
"""

from __future__ import annotations

import logging
import re
import smtplib
import threading
import time
from email.utils import parsedate_to_datetime

from django.conf import settings
from django.core.mail import get_connection

logger = logging.getLogger(__name__)

#: "try again after Mon, 19 Oct 2026 15:49:10 UTC" — the instant Mailgun's window reopens.
_TRY_AGAIN_AFTER = re.compile(r"try again after ([^)']+?UTC)")

#: Waits, in seconds, for a temporary failure that names no time of its own: a dropped
#: connection, or the per-IP login limit. The last is the most any single wait may take.
_FALLBACK_WAITS = (5, 15, 30, 60)
_MAX_WAIT = 60

_pace_lock = threading.Lock()
_last_send_at = 0.0


def _pause(seconds: float) -> None:
    """The one place this module sleeps — tests patch it."""
    time.sleep(seconds)


def _pace() -> None:
    """Hold this message until the process's previous one is far enough behind it.

    The lock is held through the sleep on purpose: the threads that send inline (no broker)
    then queue behind one another instead of all waking at once.
    """
    global _last_send_at
    interval = float(getattr(settings, "EMAIL_SEND_INTERVAL_SECONDS", 0) or 0)
    if interval <= 0:
        return
    with _pace_lock:
        wait = _last_send_at + interval - time.monotonic()
        if wait > 0:
            _pause(wait)
        _last_send_at = time.monotonic()


def _named_wait(reply) -> float | None:
    """Seconds until the time a 421 says to come back, or None when it names none."""
    text = reply.decode("utf-8", "replace") if isinstance(reply, bytes) else str(reply or "")
    match = _TRY_AGAIN_AFTER.search(text)
    if not match:
        return None
    try:
        reopens = parsedate_to_datetime(match.group(1)).timestamp()
    except (TypeError, ValueError):
        return None
    # A second past the named instant: it is rounded to the second, and arriving on it
    # exactly can still land in the closing window.
    return min(max(reopens - time.time() + 1, 1), _MAX_WAIT)


def _fallback_wait(attempt: int) -> float:
    return _FALLBACK_WAITS[min(attempt, len(_FALLBACK_WAITS)) - 1]


def retry_wait(exc: BaseException, attempt: int) -> float | None:
    """How long to wait before sending again after ``exc``, or None if it is final.

    ``attempt`` counts from 1 and only picks the fallback step. Order matters below:
    every ``SMTPException`` is also an ``OSError``.
    """
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        replies = list(exc.recipients.values())
        if replies and all(400 <= code < 500 for code, _ in replies):
            return _named_wait(replies[0][1]) or _fallback_wait(attempt)
        return None
    if isinstance(exc, smtplib.SMTPResponseException):
        if 400 <= exc.smtp_code < 500:
            return _named_wait(exc.smtp_error) or _fallback_wait(attempt)
        return None
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return _fallback_wait(attempt)
    if isinstance(exc, smtplib.SMTPException):
        return None
    if isinstance(exc, OSError):
        # A socket error or timeout before SMTP said anything — the network, not the message.
        return _fallback_wait(attempt)
    return None


class PacedSender:
    """Send messages one at a time over one reused connection, paced and retried.

    Use it as a context manager around a fan-out. ``send`` returns once the message is
    delivered, or raises the last error once it is final — so the caller's existing
    per-address ``try/except`` still decides what one failure costs.
    """

    def __init__(self, log_label: str):
        self.log_label = log_label
        self._connection = None

    def __enter__(self) -> "PacedSender":
        return self

    def __exit__(self, *exc_info) -> None:
        self._drop()

    def _drop(self) -> None:
        # Close and forget. Django's backend keeps a dead socket otherwise, and its `open()`
        # is a no-op while it holds one — so every later message would fail on it.
        if self._connection is None:
            return
        try:
            self._connection.close()
        except Exception:
            pass
        self._connection = None

    def send(self, message) -> None:
        attempts = max(1, int(getattr(settings, "EMAIL_SEND_MAX_ATTEMPTS", 5)))
        for attempt in range(1, attempts + 1):
            _pace()
            try:
                if self._connection is None:
                    self._connection = get_connection(fail_silently=False)
                    self._connection.open()
                message.connection = self._connection
                message.send(fail_silently=False)
                return
            except Exception as exc:
                # Mailgun hangs up after a 421, so the next attempt needs a new connection
                # whatever went wrong.
                self._drop()
                wait = retry_wait(exc, attempt)
                if wait is None or attempt == attempts:
                    raise
                logger.warning(
                    "%s send deferred %.0fs (attempt %s/%s): %s",
                    self.log_label, wait, attempt, attempts, exc,
                )
                _pause(wait)
