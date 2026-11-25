"""The "balance low" and "frozen for debt" SMS (owner, 2026-11-25), once per occurrence.

* Low: the balance is at or above zero but under two lessons' worth — twice the sum of one lesson's price over the
  account's running per-lesson seats (a grant, price 0, counts nothing). Told once per dip; armed again when the
  balance is back at or above that line.
* Frozen: the learner is frozen for debt. Told once per freeze; armed again when it is lifted.

To the parent's phone first, then the student's own, then the account's; nobody else. The state that makes it "once"
is ``BalanceNotice`` — the per-day uniqueness of ``SmsMessage`` only stops a doubled run. Everything goes out
through ``delivery.deliver``. Switched off (``switchboard.balance_off_reason``) nothing is sent and nothing is armed.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from access import constants as C
from billing import ledger
from billing.models import Account, Seat, Span, SpanRule
from lcup.phones import normalize_phone
from users import audience as A

from . import switchboard
from . import templates as T
from .delivery import deliver
from .models import BalanceNotice, SmsMessage

logger = logging.getLogger("sms.balance_warnings")

#: One run at a time: the beat and "Send now" from /ops/sms are never doubled.
RUNNING_KEY = "sms:balance-warnings-running"
#: How many lessons' worth is "low".
LINE_LESSONS = 2


@dataclass(frozen=True)
class Notice:
    kind: str
    account: Account
    user: object
    phone: str
    values: dict


@dataclass
class Plan:
    low: list = field(default_factory=list)
    frozen: list = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)


def threshold(account, today: date) -> int:
    """Two lessons' worth: 2 × the sum of one lesson's price over the seats with a per-lesson span running on
    ``today``. A seat at price 0 (a grant) counts 0, so an account of grants has no line."""
    spans = (
        Span.objects.filter(seat__account=account, rule=SpanRule.LESSON, start__lte=today)
        .filter(Q(end__isnull=True) | Q(end__gte=today))
        .select_related("seat")
    )
    seats = {span.seat_id: span.seat for span in spans}
    return LINE_LESSONS * sum(ledger.lesson_price(seat) for seat in seats.values() if seat.charge_price > 0)


def phone_of(account) -> str:
    """The first number that works of the parent's, the student's own, the account's; "" when none does."""
    user = account.user
    for raw in (user.parent_phone, user.phone_number, account.phone):
        if phone := normalize_phone(raw):
            return phone
    return ""


def _learner_accounts():
    return (
        Account.objects.filter(user__isnull=False, user__role__in=C.LEARNER_ROLES)
        .select_related("user")
        .order_by("pk")
    )


def _debt_frozen(user) -> bool:
    return bool(user.is_frozen and user.frozen_reason == A.FROZEN_LCUP_DEBT)


def _name_suffixes() -> tuple[str, str]:
    """What follows the student's name in each template ("," for "(STUDENT), hisobingizda"); "," when a template
    is not set or does not fit, which the send refuses anyway."""
    row = switchboard.current()
    try:
        low, frozen = switchboard.balance_templates(row)
    except T.TemplateError:
        return (switchboard.LIVE_NAME_SUFFIX,) * 2
    return tuple(
        switchboard.name_suffix(template_id, template) if template_id else switchboard.LIVE_NAME_SUFFIX
        for template_id, template in ((row.low_template_id, low), (row.frozen_template_id, frozen))
    )


def _values(account, balance: int, suffix: str) -> dict:
    name = account.name.split() or account.user.get_full_name().split()
    return {"student": " ".join(name[:4]) + suffix, "balance": f"{balance:,}".replace(",", " ")}


def plan(today: date) -> Plan:
    """Who would be told today, and why not the others. Writes nothing."""
    result = Plan()
    low_suffix, frozen_suffix = _name_suffixes()
    for account in _learner_accounts():
        try:
            line = threshold(account, today)
            if line <= 0:
                continue
            user, balance = account.user, ledger.balance(account)
            notice = BalanceNotice.objects.filter(account=account).first()
            low_armed = notice.low_armed if notice else True
            frozen_armed = notice.frozen_armed if notice else True
            wants_low = 0 <= balance < line and low_armed
            wants_frozen = _debt_frozen(user) and frozen_armed
            if not (wants_low or wants_frozen):
                continue
            phone = phone_of(account)
            if not phone:
                result.skipped["no_phone"] += 1
                continue
            if wants_low:
                result.low.append(
                    Notice(SmsMessage.KIND_BALANCE_LOW, account, user, phone, _values(account, balance, low_suffix))
                )
            if wants_frozen:
                result.frozen.append(
                    Notice(SmsMessage.KIND_BALANCE_FROZEN, account, user, phone, _values(account, balance, frozen_suffix))
                )
        except Exception as exc:  # the type only: the message may quote a phone
            logger.warning("balance plan for account %s went wrong: %s", account.pk, type(exc).__name__)
            result.skipped["error"] += 1
    return result


def rearm(today: date) -> int:
    """Arm again what has cleared: the low notice where the balance is back at or above the line, the frozen one
    where the learner is no longer frozen for debt. Missing notices are created armed. Returns how many changed."""
    changed = 0
    for account in _learner_accounts():
        try:
            notice, _ = BalanceNotice.objects.get_or_create(account=account)
            fields = []
            if not notice.low_armed and ledger.balance(account) >= threshold(account, today):
                notice.low_armed = True
                fields.append("low_armed")
            if not notice.frozen_armed and not _debt_frozen(account.user):
                notice.frozen_armed = True
                fields.append("frozen_armed")
            if fields:
                notice.save(update_fields=[*fields, "updated_at"])
                changed += 1
        except Exception as exc:
            logger.warning("balance rearm for account %s went wrong: %s", account.pk, type(exc).__name__)
    return changed


def _template_ids(row):
    return {SmsMessage.KIND_BALANCE_LOW: row.low_template_id, SmsMessage.KIND_BALANCE_FROZEN: row.frozen_template_id}


def send(client, now, *, today: date | None = None) -> dict:
    """Re-arm what cleared, then tell everyone the plan names. One account going wrong does not stop the rest.
    A row that exists disarms the notice — except one that never left (FAILED), which the next run tries again."""
    today = today or timezone.localdate(now)
    rearm(today)
    planned = plan(today)
    counts = {"skipped": dict(planned.skipped)}
    row = switchboard.current()
    low, frozen = switchboard.balance_templates(row)
    templates = {SmsMessage.KIND_BALANCE_LOW: low, SmsMessage.KIND_BALANCE_FROZEN: frozen}
    ids = _template_ids(row)
    for notice in [*planned.low, *planned.frozen]:
        try:
            msg = deliver(
                client, kind=notice.kind, run_on=today, dedupe_key=f"account:{notice.account.pk}", phone=notice.phone,
                text=T.render(templates[notice.kind], notice.values), user=notice.user,
                template_eskiz_id=ids[notice.kind],
            )
            if msg is None or msg.status != SmsMessage.STATUS_FAILED:
                _disarm(notice, now, sent=msg is not None)
        except Exception as exc:  # the type only: the message may quote the phone
            logger.warning("balance SMS for account %s went wrong: %s", notice.account.pk, type(exc).__name__)
            counts["error"] = counts.get("error", 0) + 1
            continue
        outcome = "already_sent" if msg is None else msg.status.lower()
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts


def _disarm(notice, now, *, sent: bool) -> None:
    low = notice.kind == SmsMessage.KIND_BALANCE_LOW
    state, _ = BalanceNotice.objects.get_or_create(account=notice.account)
    fields = {"low_armed" if low else "frozen_armed": False}
    if sent:
        fields["low_sent_at" if low else "frozen_sent_at"] = now
    for name, value in fields.items():
        setattr(state, name, value)
    state.save(update_fields=[*fields, "updated_at"])


def daily(now) -> dict:
    """The day's run, at once if every switch is on and both templates are set; ``{"skipped": why}`` otherwise.
    Returns ``send``'s counts, with ``sent`` always present."""
    if why := switchboard.balance_off_reason():
        return {"skipped": why}
    try:
        switchboard.balance_templates()
    except T.TemplateError:
        return {"skipped": "the balance templates do not fit their slots: pick them again in /ops/sms"}
    row = switchboard.current()
    if not (row.low_pattern.strip() and row.frozen_pattern.strip()):
        return {"skipped": "both balance templates must be picked in /ops/sms first"}
    if not cache.add(RUNNING_KEY, "1", timeout=30 * 60):
        return {"skipped": "already running"}
    try:
        from . import eskiz

        counts = send(eskiz.default_client(), now)
    finally:
        cache.delete(RUNNING_KEY)
    counts.setdefault("sent", 0)
    return counts
