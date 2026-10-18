"""The SMS before the debt freeze (owner, 2026-10-18).

"oyning boshidan 5-chisigacha ogohlantirilsin 6-kun shunchaki muzlatilsin sms jo'natish shart emas
6-kuni. lekin 5kun yuborish kerak": on every day of the month before ``debt_freeze_day()`` (1–5),
at 10:00, everyone the freeze would take that day gets one SMS on the phone lc-up holds for them —
usually a parent's. On the freeze day and after: nothing.

Who: exactly :func:`lcup.finance.freezable` — a linked learner who owes, is not frozen (an
already-frozen student is not warned: owner), is not exempt and is still in lc-up. Nobody, when:

* the freeze is switched off — the SMS would promise a freeze that is not coming;
* there is no approved template yet (``sms.templates.DEBT_WARNING``);
* more than MAX_PER_RUN would get one — lc-up answering with wrong balances; a person looks first.

And not a student whose balance is older than STALE_AFTER: lc-up's sync stopped, and they may have
paid. One SMS per student per day; when the text names nobody, one per phone, so siblings sharing
a parent's phone do not get the same words twice.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta

from django.utils import timezone

from access import constants as C
from lcup.conf import debt_freeze_day, debt_freeze_enabled
from lcup.finance import freezable
from lcup.models import LcupStudentLink
from lcup.phones import normalize_phone, split_lcup_name

from . import templates as T
from .delivery import deliver
from .models import SmsMessage

logger = logging.getLogger("sms.debt_warnings")

STALE_AFTER = timedelta(hours=24)
#: 221 linked learners on 2026-10-18; more warnings than this in one morning means lc-up's numbers are wrong.
MAX_PER_RUN = 150


@dataclass
class Warning:
    link: LcupStudentLink
    phone: str
    text: str
    dedupe_key: str


@dataclass
class Plan:
    warnings: list = field(default_factory=list)
    skipped: dict = field(default_factory=dict)
    blocked: str = ""


def _values(link, today) -> dict:
    first, last = split_lcup_name(link.name)
    return {
        "first_name": first or link.user.first_name,
        "last_name": last or link.user.last_name,
        "debt": int(abs(link.balance)),
        "freeze_day": debt_freeze_day(),
        "days_left": debt_freeze_day() - today.day,
    }


def plan(now, *, today=None) -> Plan:
    """Who would be warned at ``now``. ``today`` previews another day's list (the report command);
    the balance's age is always measured from ``now``."""
    today = today or timezone.localdate(now)
    template = T.DEBT_WARNING
    if template is None:
        return Plan(blocked="no approved template yet")
    if not debt_freeze_enabled():
        return Plan(blocked="the debt freeze is switched off")
    if today.day >= debt_freeze_day():
        return Plan(blocked="not a warning day")
    links = (
        LcupStudentLink.objects.filter(user__isnull=False, user__role__in=C.LEARNER_ROLES, balance__lt=0)
        .select_related("user")
        .order_by("lcup_student_id")
    )
    warnings, skipped, taken = [], defaultdict(int), set()
    for link in links:
        if not freezable(link):
            skipped["not_freezable"] += 1
            continue
        if int(abs(link.balance)) == 0:  # -0.40 would read "0 so'm qarz"
            skipped["under_one_sum"] += 1
            continue
        if link.balance_seen_at is None or link.balance_seen_at < now - STALE_AFTER:
            skipped["stale_balance"] += 1
            continue
        phone = normalize_phone(link.phone)
        if not phone:
            skipped["no_phone"] += 1
            continue
        key = f"student:{link.lcup_student_id}" if template.names_a_student else f"phone:{phone}"
        if key in taken:
            skipped["same_phone"] += 1
            continue
        try:
            text = T.render(template, _values(link, today))
        except T.TemplateError:
            logger.warning("debt warning for lc-up student %s: the text could not be filled", link.lcup_student_id)
            skipped["bad_text"] += 1
            continue
        taken.add(key)
        warnings.append(Warning(link, phone, text, key))
    result = Plan(warnings, dict(skipped))
    if len(warnings) > MAX_PER_RUN:
        result.blocked = f"{len(warnings)} warnings is more than {MAX_PER_RUN}: a person checks lc-up's balances first"
    return result


def send(client, now, *, retry_only: bool = False) -> dict:
    """``retry_only`` is the 11:00 and 12:00 runs: only the warnings an earlier run today could not
    get out (FAILED — eskiz unreachable, a refused login) go again; never a new one, never one that
    may have left. One student going wrong (the database, the cache) does not stop the rest."""
    run_on = timezone.localdate(now)
    retry = None
    if retry_only:
        retry = set(
            SmsMessage.objects.filter(
                kind=SmsMessage.KIND_DEBT_WARNING, run_on=run_on, status=SmsMessage.STATUS_FAILED
            ).values_list("dedupe_key", flat=True)
        )
        if not retry:
            return {"skipped": {}, "blocked": "nothing to retry"}
    planned = plan(now)
    counts = {"skipped": planned.skipped}
    if planned.blocked:
        if planned.warnings:
            logger.warning("debt warnings held back: %s", planned.blocked)
        counts["blocked"] = planned.blocked
        return counts
    for warning in planned.warnings:
        if retry is not None and warning.dedupe_key not in retry:
            continue
        try:
            msg = deliver(
                client, kind=SmsMessage.KIND_DEBT_WARNING, run_on=run_on, dedupe_key=warning.dedupe_key,
                phone=warning.phone, text=warning.text, user=warning.link.user,
                lcup_student_id=warning.link.lcup_student_id,
            )
        except Exception as exc:  # the type only: the message may quote the phone
            logger.warning(
                "debt warning for lc-up student %s went wrong: %s", warning.link.lcup_student_id, type(exc).__name__
            )
            counts["error"] = counts.get("error", 0) + 1
            continue
        outcome = "already_sent" if msg is None else msg.status.lower()
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts
