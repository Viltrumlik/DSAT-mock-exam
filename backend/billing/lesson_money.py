"""What a lesson cancelled or moved does to the money (owner, 2026-11-25), called by ``classes.lesson_changes`` inside
the change's own transaction.

* Only spans paid per lesson are touched. A month's price does not change for a lesson called off (lc-up's rule,
  ``billing.lessons``), so a seat billed by the month moves no money here.
* A day called off is not charged: its lesson already written is voided here with the reason, never deleted, and
  ``ledger._bill_lessons`` skips the day, so the 15-minute tick never writes it again.
* A moved lesson is charged once, on its new day, by ``_bill_lessons`` (``ledger.MOVED_KEY``): ``bill_span`` writes it
  now when that day has come, else the tick on that day does.
* An undo voids the moved lesson and lets ``bill_span`` write the day again: a new row at the voided row's own amount
  (for a move, the moved lesson's), and the voided one stays.
* Each takes the spans' rows first (``_spans``), so the 15-minute tick billing the same span never interleaves with it.
* A new student's first month is flat (owner, 2026-11-22), so a change inside it finds nothing to void or write.

Each ends by lifting the debt freeze of every student it touched who is back to zero or above
(``ledger.apply_debt_freeze(account, freeze=False)``, only when the ledger is ours and students pay per lesson). It never
freezes: freezing stays the 15-minute tick's, with its guard against freezing more than ``ledger.MAX_FREEZES_PER_TICK``
people at once, so undoing a centre holiday cannot freeze a crowd in one click (ruling of 2026-11-25).
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
    centre holiday, every seat with a lesson that weekday whose class has no change of its own that day.

    Locked, in id order (so two changes never wait on each other in a circle): a tick billing one of them finishes
    first and this sees what it wrote, and a tick coming after waits and then sees this change (``ledger.lock_span``).
    Only the spans' own rows are locked (``of=("self",)``), not their students."""
    from classes.models_lesson_changes import LessonChange  # here, not at the top: classes imports billing

    days = [day for day in (change.day, change.new_day) if day is not None]
    spans = (
        Span.objects.filter(rule=SpanRule.LESSON)
        .filter(_running_on(days))
        .exclude(end__lt=F("start"))
        .select_related("seat__account__user")
        .select_for_update(of=("self",))
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


def _bill(spans, today: date, keys: set[str], *, prices: dict[str, int] | None = None) -> list[Entry]:
    """Bill the spans (``ledger.bill_span``); the rows written now under ``keys``, the change's own."""
    had = set(Entry.objects.filter(key__in=keys, voided_at__isnull=True).values_list("pk", flat=True))
    for span in spans:
        ledger.bill_span(span, today, prices=prices)
    return [row for row in Entry.objects.filter(key__in=keys, voided_at__isnull=True) if row.pk not in had]


def _summary(spans, voided, charged) -> dict:
    """What moved: the rows voided (for how many students, how much came back), the rows charged now and how much,
    and the debt freezes lifted. Only lifted: a change never freezes anyone (the tick does)."""
    unfrozen = 0
    if conf.lesson_billing() and conf.ledger_is_ours():
        accounts = {span.seat.account_id: span.seat.account for span in spans}
        for account in accounts.values():
            unfrozen += ledger.apply_debt_freeze(account, freeze=False) == "unfrozen"
    return {
        "voided": len(voided),
        "students": len({row.account_id for row in voided}),
        "amount": sum(-row.amount for row in voided),
        "charged": len(charged),
        "charged_amount": sum(-row.amount for row in charged),
        "unfrozen": unfrozen,
    }


def apply(change, *, today: date, by) -> dict:
    """The change's day is not charged: its lesson already written is voided with the reason. A move's lesson is
    charged on its new day once that day has come. Returns ``{"voided", "students", "amount", "charged",
    "charged_amount", "unfrozen"}``."""
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
        charged = []
        if change.new_day is not None:
            moved = {f"{ledger.MOVED_KEY}{span.pk}:{change.day.isoformat()}" for span in spans}
            charged = _bill(spans, today, moved)
        return _summary(spans, voided, charged)


def revert(change, *, today: date, by) -> dict:
    """An undone change: a move's lesson on its new day is voided, then the day is charged again (``bill_span``, for
    a day that has come; the tick writes one still ahead on its day), at what it was charged at before: the moved
    lesson's amount, or the day's own row the cancel voided. A lesson already written keeps its price
    (``ledger.set_personal_price``). ``change`` is already undone."""
    with transaction.atomic():
        spans = _spans(change)
        days = {span.pk: f"{ledger.LESSON_KEY}{span.pk}:{change.day.isoformat()}" for span in spans}
        prices = ledger.last_voided_amounts(days.values())
        voided = []
        if change.new_day is not None:
            words = f"Move undone: {change.reason}"
            for span in spans:
                row = _void_live(f"{ledger.MOVED_KEY}{span.pk}:{change.day.isoformat()}", words, by)
                if row is not None:
                    voided.append(row)
                    # Back to its old day at what it was charged on the new one, even when the old day was never
                    # charged (moved before it came).
                    prices[days[span.pk]] = row.amount
        charged = _bill(spans, today, set(days.values()), prices=prices)
        return _summary(spans, voided, charged)
