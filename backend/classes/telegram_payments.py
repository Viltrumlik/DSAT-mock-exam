"""lc-up payments, announced in the class bot (plan 2026-10-16).

"✅ <class> uchun 500 000 so'm to'lov qabul qilindi." and then either "Qarzingiz qolmadi." or
"Qolgan qarz: X so'm." The class comes from the payment's own lc-up group (every payment has
one); the debt is lc-up's overall balance, which the same sync refreshed a stage earlier —
lc-up keeps no balance per group (measured 2026-10-16), so the message does not pretend to.

Only payments lc-up created after ``CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM``: the copy holds
every payment since January, and switching this on must not replay them. A refund is not
announced. A student with no bot connection is marked done and skipped.

Each payment is claimed (``bot_notified_at`` set, conditional on it still being null) BEFORE its
message goes out, so two runs of the task that overlap — the sync's lock does not cover a queued
task — cannot both send it. A failure that may pass is released and left for the next run: no
answer at all, 429 (slow down) and 5xx (Telegram's side). One Telegram refused (the student
blocked the bot: 403, a bad chat: 400) stays marked and is counted as ``refused`` rather than
retried for ever. A payment whose message raises (building it, or the send) is released the same
way, logged by its id alone, and counted as ``failed``: the payments behind it still go out.

``created_before`` keeps a message from quoting the balance from before its own payment. The
sync reads the balances (students stage) before it reads the payments, so a payment lc-up
recorded in between is announced beside a balance that still counts it as unpaid — and it is
announced only once, so nothing would ever correct it. The sync therefore passes the moment it
began, less a margin: later payments are left unmarked and go out with the next sync, which
reads a balance that already includes them.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from lcup.models import LcupPayment

from . import telegram_group as tg
from . import telegram_texts as T

logger = logging.getLogger("classes.telegram_payments")

#: A payment older than this is history, not news, whatever its creation stamp says.
RECENT_DAYS = 7


def payment_messages_since():
    raw = str(getattr(settings, "CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM", "") or "").strip()
    parsed = parse_datetime(raw) if raw else None
    if parsed is not None and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def payment_text(payment: LcupPayment) -> str:
    group = payment.group
    name = ""
    if group is not None:
        name = group.classroom.name if group.classroom_id else group.name
    amount = T.som(payment.amount)
    head = (
        T.PAYMENT.format(group=tg.api.esc(name), amount=amount)
        if name
        else T.PAYMENT_NO_GROUP.format(amount=amount)
    )
    balance = payment.student.balance if payment.student_id else None
    if balance is None:
        return head
    if balance >= 0:
        return f"{head}\n{T.PAYMENT_NO_DEBT}"
    return f"{head}\n{T.PAYMENT_DEBT_LEFT.format(debt=T.som(-balance))}"


def _retryable(result) -> bool:
    """A failed send that may succeed later: it never got an answer, was throttled, or hit
    Telegram's own trouble. Everything else (403, 400…) is an answer, and asking again won't change it."""
    code = result.error_code
    return code is None or code == 429 or code >= 500


def notify_new_payments(now=None, created_before=None) -> dict:
    since = payment_messages_since()
    if since is None or not tg.api.is_configured():
        return {"status": "off"}
    now = now or timezone.now()
    rows = LcupPayment.objects.filter(
        kind="payment",
        bot_notified_at__isnull=True,
        created_in_lcup__gte=since,
        paid_on__gte=timezone.localdate(now) - timedelta(days=RECENT_DAYS),
    )
    if created_before is not None:
        rows = rows.filter(created_in_lcup__lt=created_before)
    rows = rows.select_related("student__user", "group__classroom").order_by("created_in_lcup", "pk")
    sent = skipped = failed = refused = 0
    for payment in rows:
        # Claim first. The list above was read a moment ago; another run may have taken this
        # payment since, and only the run whose UPDATE changes the row may send it.
        claimed = LcupPayment.objects.filter(pk=payment.pk, bot_notified_at__isnull=True).update(
            bot_notified_at=now
        )
        if claimed != 1:
            continue
        user = payment.student.user if payment.student_id and payment.student.user_id else None
        telegram_id = tg.bot_id_for(user) if user is not None else None
        if not telegram_id:
            skipped += 1  # nobody to tell: stays marked, so it is not looked at again
            continue
        try:
            result = tg.api.send_message(int(telegram_id), payment_text(payment))
        except Exception:
            # One payment that cannot be built or sent must not hold up the ones behind it, so
            # nothing propagates. The pk only: the text is the student's name and money.
            logger.exception("telegram payment %s could not be announced", payment.pk)
            _release(payment, now)  # the next run tries again
            failed += 1
            continue
        if result.ok:
            sent += 1
        elif _retryable(result):
            failed += 1
            _release(payment, now)  # the next run tries again
        else:
            refused += 1
    if sent or failed or refused:
        logger.info(
            "telegram payments sent=%s skipped=%s failed=%s refused=%s", sent, skipped, failed, refused
        )
    return {"status": "ok", "sent": sent, "skipped": skipped, "failed": failed, "refused": refused}


def _release(payment: LcupPayment, now) -> None:
    """Give back this run's claim (and only this run's) so a later run sends the payment."""
    LcupPayment.objects.filter(pk=payment.pk, bot_notified_at=now).update(bot_notified_at=None)
