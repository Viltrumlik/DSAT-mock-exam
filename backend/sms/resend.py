"""Sending again, by hand, an SMS that did not arrive (/ops/sms: the overview's list, the journal's drawer).

Only RESENDABLE rows (UNDELIVERED, REJECTED, FAILED) ever go again; one that may have left never does.
A debt warning has two more rules (the 2026-11-02 review): it goes again only on its own day — its
text names the day ("Bugun oxirgi kun!") and a student may have paid since — and only while the
warning itself is switched on (env, panel and freeze; switchboard's master switch says nothing goes
out with it off, whatever the panel says). The text is checked with eskiz first, as the other sends
do: a word it forbids is dropped from the name, or the SMS is not sent.

The row is set FAILED in one conditional UPDATE and handed to ``deliver``, whose claim lets exactly
one of two concurrent resends through.
"""

from __future__ import annotations

import logging

from django.utils import timezone

from lcup.models import LcupStudentLink
from lcup.phones import normalize_phone

from . import debt_warnings as warnings
from . import forbidden
from .delivery import RESENDABLE, deliver
from .models import SmsMessage

logger = logging.getLogger("sms.resend")


def refusal(msg: SmsMessage, today, *, debt_on: bool | None = None) -> str | None:
    """Why ``msg`` may not go again now (``not_resendable``, ``stale``, ``switched_off``), or None.
    ``debt_on`` is ``warnings.switched_on()`` when a caller already asked it (a page of rows)."""
    if msg.status not in RESENDABLE:
        return "not_resendable"
    if msg.kind == SmsMessage.KIND_DEBT_WARNING:
        if msg.run_on != today:
            return "stale"
        if not (warnings.switched_on() if debt_on is None else debt_on):
            return "switched_off"
    return None


def _link(msg) -> LcupStudentLink | None:
    if msg.lcup_student_id:
        return LcupStudentLink.objects.filter(lcup_student_id=msg.lcup_student_id).first()
    if msg.user_id:
        return LcupStudentLink.objects.filter(user_id=msg.user_id).first()
    return None


def resend(client, msg_id: int, *, today=None) -> SmsMessage | None:
    """The SMS once more, under its own (kind, day, key), to the student's phone as lc-up has it now.
    None when there is no such row, it may not go again (``refusal``), or eskiz forbids its text."""
    msg = SmsMessage.objects.select_related("user", "campaign", "created_by").filter(pk=msg_id).first()
    if msg is None or refusal(msg, today or timezone.localdate()):
        return None
    link = _link(msg)
    name = (link.name if link else "") or (msg.user.get_full_name() if msg.user else "")
    text, flagged = forbidden.scrub(client, msg.text, name)
    if text is None:
        logger.warning("resend of SMS %s: eskiz forbids the text (%s)", msg.pk, flagged)
        return None
    flipped = SmsMessage.objects.filter(pk=msg.pk, status__in=RESENDABLE).update(
        status=SmsMessage.STATUS_FAILED, updated_at=timezone.now(),
    )
    if not flipped:
        return None
    phone = normalize_phone(link.phone) if link else ""
    return deliver(
        client, kind=msg.kind, run_on=msg.run_on, dedupe_key=msg.dedupe_key, phone=phone or msg.phone, text=text,
        user=msg.user, lcup_student_id=msg.lcup_student_id, campaign=msg.campaign, created_by=msg.created_by,
        template_eskiz_id=msg.template_eskiz_id,
    )
