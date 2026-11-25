"""What a lesson cancelled or moved does to the money (owner, 2026-11-25), called by ``classes.lesson_changes`` inside
the change's own transaction.

* Only spans paid per lesson are touched. A month's price does not change for a lesson called off (lc-up's rule,
  ``billing.lessons``), so a seat billed by the month moves no money here.
* A day called off is not charged: its lesson already written is voided here with the reason, never deleted, and
  ``ledger._bill_lessons`` skips the day, so the 15-minute tick never writes it again.
* A moved lesson is charged once, on its new day, by ``_bill_lessons`` (``ledger.MOVED_KEY``): ``bill_span`` writes it
  now when that day has come, else the tick on that day does.
* An undo voids the moved lesson and lets ``bill_span`` write the day again: a new row, the voided one stays.
* A new student's first month is flat (owner, 2026-11-22), so a change inside it finds nothing to void or write.

Each ends with the debt-freeze check for every student it touched, as after a payment (``billing.views._after_money``:
``ledger.apply_debt_freeze``, only when the ledger is ours and students pay per lesson): back to zero or above lifts a
debt freeze at once, and below zero (an undo charging the day again) freezes.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction
from django.db.models import F, Q

from . import conf, ledger
from .models import Entry, Span, SpanRule


def _running_on(days) -> Q:
    covers = Q()
    for day in days:
        covers |= Q(start__lte=day) & (Q(end__isnull=True) | Q(end__gte=day))
    return covers


def _spans(change) -> list[Span]:
    """The spans paid per lesson that the change touches: running on its day or its new day, in its class — or, for a
    centre holiday, every seat with a lesson that weekday whose class has no change of its own that day."""
    from classes.models_lesson_changes import LessonChange  # here, not at the top: classes imports billing

    days = [day for day in (change.day, change.new_day) if day is not None]
    spans = (
        Span.objects.filter(rule=SpanRule.LESSON)
        .filter(_running_on(days))
        .exclude(end__lt=F("start"))
        .select_related("seat__account__user")
        .order_by("pk")
    )
    if change.classroom_id is not None:
        return list(spans.filter(seat__classroom_id=change.classroom_id))
    own = set(
        LessonChange.objects.filter(undone_at__isnull=True, classroom__isnull=False, day=change.day)
        .values_list("classroom_id", flat=True)
    )
    weekday = change.day.isoweekday()
    # A seat with no class is billed by its own weekdays (``day_changes(None, …)`` gives it the holidays), so it is
    # given its lesson back too.
    return [span for span in spans if span.seat.classroom_id not in own and weekday in (span.seat.days or [])]


def _void_live(key: str, reason: str, by) -> Entry | None:
    row = Entry.objects.select_for_update().filter(key=key, voided_at__isnull=True).first()
    if row is not None:
        ledger.void(row, reason, by=by)
    return row


def _summary(spans, voided) -> dict:
    """What moved: the rows voided, for how many students and how much came back, and the debt freezes lifted or
    put on by the check after it."""
    done = []
    if conf.lesson_billing() and conf.ledger_is_ours():
        accounts = {span.seat.account_id: span.seat.account for span in spans}
        done = [ledger.apply_debt_freeze(account) for account in accounts.values()]
    return {
        "voided": len(voided),
        "students": len({row.account_id for row in voided}),
        "amount": sum(-row.amount for row in voided),
        "unfrozen": done.count("unfrozen"),
        "frozen": done.count("frozen"),
    }


def apply(change, *, today: date, by) -> dict:
    """The change's day is not charged: its lesson already written is voided with the reason. A move's lesson is
    charged on its new day once that day has come. Returns ``{"voided", "students", "amount", "unfrozen", "frozen"}``."""
    words = (
        f"Lesson moved to {change.new_day}: {change.reason}" if change.new_day else f"Lesson cancelled: {change.reason}"
    )
    with transaction.atomic():
        spans = _spans(change)
        voided = []
        for span in spans:
            row = _void_live(f"{ledger.LESSON_KEY}{span.pk}:{change.day.isoformat()}", words, by)
            if row is not None:
                voided.append(row)
        if change.new_day is not None:
            for span in spans:
                ledger.bill_span(span, today)
        return _summary(spans, voided)


def revert(change, *, today: date, by) -> dict:
    """An undone change: a move's lesson on its new day is voided, then the day is charged again (``bill_span``, for
    a day that has come; the tick writes one still ahead on its day). ``change`` is already undone."""
    with transaction.atomic():
        spans = _spans(change)
        voided = []
        if change.new_day is not None:
            for span in spans:
                row = _void_live(f"{ledger.MOVED_KEY}{span.pk}:{change.day.isoformat()}", f"Move undone: {change.reason}", by)
                if row is not None:
                    voided.append(row)
        for span in spans:
            ledger.bill_span(span, today)
        return _summary(spans, voided)
