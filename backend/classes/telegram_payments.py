"""lc-up payments, announced in the class bot (plan 2026-10-16).

"✅ <class> uchun 500 000 so'm to'lov qabul qilindi." and then either "Qarzingiz qolmadi." or
"Qolgan qarz: X so'm." The class comes from the payment's own lc-up group (every payment has
one); the debt is lc-up's overall balance, which the same sync refreshed a stage earlier —
lc-up keeps no balance per group (measured 2026-10-16), so the message does not pretend to.

Only payments lc-up created after ``CLASSROOM_TELEGRAM_PAYMENT_MESSAGES_FROM``: the copy holds
every payment since January, and switching this on must not replay them. A refund is not
announced. A student with no bot connection is marked done and skipped. A send that failed
in transit is left for the next run, while one Telegram refused (the student blocked the bot)
is not retried for ever.
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


def notify_new_payments(now=None) -> dict:
    since = payment_messages_since()
    if since is None or not tg.api.is_configured():
        return {"status": "off"}
    now = now or timezone.now()
    rows = (
        LcupPayment.objects.filter(
            kind="payment",
            bot_notified_at__isnull=True,
            created_in_lcup__gte=since,
            paid_on__gte=timezone.localdate(now) - timedelta(days=RECENT_DAYS),
        )
        .select_related("student__user", "group__classroom")
        .order_by("created_in_lcup", "pk")
    )
    sent = skipped = failed = 0
    for payment in rows:
        user = payment.student.user if payment.student_id and payment.student.user_id else None
        telegram_id = tg.bot_id_for(user) if user is not None else None
        if not telegram_id:
            skipped += 1
        else:
            result = tg.api.send_message(int(telegram_id), payment_text(payment))
            if not result.ok and not result.error_code:
                failed += 1  # in transit: the next run tries again
                continue
            sent += int(result.ok)
        LcupPayment.objects.filter(pk=payment.pk).update(bot_notified_at=now)
    if sent or failed:
        logger.info("telegram payments sent=%s skipped=%s failed=%s", sent, skipped, failed)
    return {"status": "ok", "sent": sent, "skipped": skipped, "failed": failed}
