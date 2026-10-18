"""Claim → send → record, and eskiz's later word on whether it arrived.

``deliver`` writes the day's row before the request leaves. The unique (kind, day, key) is the
lock: a second run the same day — the beat firing twice, a person re-running — finds the row and
sends nothing, unless that SMS is FAILED: eskiz was never reached, so nothing left and it may go
again. SENT, UNCERTAIN (it may have left) and PENDING (being sent, or died mid-request) never do.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from . import eskiz
from .models import SmsMessage

#: eskiz keeps a request's status readable by its UUID for 30 days; two are enough to see an SMS arrive.
CHECK_WINDOW = timedelta(hours=48)
DELIVERED = frozenset({"DELIVERED", "DELIVRD"})
UNDELIVERED = frozenset({"UNDELIVERED", "UNDELIV", "UNDELIVERABLE", "EXPIRED", "REJECTED", "REJECTD", "DELETED"})

_STATUS_OF = {
    eskiz.ACCEPTED: SmsMessage.STATUS_SENT,
    eskiz.REJECTED: SmsMessage.STATUS_REJECTED,
    eskiz.FAILED: SmsMessage.STATUS_FAILED,
    eskiz.UNCERTAIN: SmsMessage.STATUS_UNCERTAIN,
}


def mask_phone(phone) -> str:
    phone = str(phone or "")
    return f"{phone[:5]}***{phone[-4:]}" if len(phone) >= 9 else "***"


def deliver(
    client, *, kind, run_on, dedupe_key, phone, text, user=None, lcup_student_id=None, campaign=None, created_by=None,
) -> SmsMessage | None:
    """The SMS, once. None when today's row for this key is already there and is not FAILED.
    ``campaign`` and ``created_by`` are recorded on a new row (a FAILED one re-claimed keeps its own)."""
    msg = _claim(kind, run_on, dedupe_key, phone, text, user, lcup_student_id, campaign, created_by)
    if msg is None:
        return None
    result = client.send(phone, text, user_sms_id=f"m{msg.pk}")
    msg.status = _STATUS_OF[result.outcome]
    msg.request_id = result.request_id
    msg.error = result.error[:400]
    msg.sent_at = timezone.now() if result.outcome == eskiz.ACCEPTED else None
    msg.save(update_fields=["status", "request_id", "error", "sent_at", "updated_at"])
    return msg


def _claim(kind, run_on, dedupe_key, phone, text, user, lcup_student_id, campaign, created_by) -> SmsMessage | None:
    try:
        with transaction.atomic():
            return SmsMessage.objects.create(
                kind=kind, run_on=run_on, dedupe_key=dedupe_key, phone=phone, text=text,
                user=user, lcup_student_id=lcup_student_id, campaign=campaign, created_by=created_by,
            )
    except IntegrityError:
        pass
    # One UPDATE, so of two runs re-claiming the same FAILED row exactly one wins.
    claimed = SmsMessage.objects.filter(
        kind=kind, run_on=run_on, dedupe_key=dedupe_key, status=SmsMessage.STATUS_FAILED
    ).update(
        status=SmsMessage.STATUS_PENDING, phone=phone, text=text, error="",
        attempts=F("attempts") + 1, updated_at=timezone.now(),
    )
    return SmsMessage.objects.get(kind=kind, run_on=run_on, dedupe_key=dedupe_key) if claimed else None


def check_statuses(client, now) -> dict:
    """Ask eskiz about what went out in the last CHECK_WINDOW and is not settled yet."""
    counts = defaultdict(int)
    rows = SmsMessage.objects.filter(
        status=SmsMessage.STATUS_SENT, sent_at__gte=now - CHECK_WINDOW
    ).exclude(request_id="")
    for msg in rows:
        result = client.status(msg.request_id)
        if not result.ok:
            counts["unanswered"] += 1
            continue
        msg.eskiz_status = result.status[:32]
        msg.parts = result.parts
        msg.checked_at = now
        if result.status in DELIVERED:
            msg.status = SmsMessage.STATUS_DELIVERED
        elif result.status in UNDELIVERED:
            msg.status = SmsMessage.STATUS_UNDELIVERED
        msg.save(update_fields=["status", "eskiz_status", "parts", "checked_at", "updated_at"])
        counts[msg.status.lower()] += 1
    return dict(counts)
