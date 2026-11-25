"""The ledger: rows of money written when something happens to a seat (owner, 2026-11-04).

It knows seats, spans and rows, and nothing about where a change came from: during the shadow run
``shadow.watch`` tells it what lc-up changed, and after lc-up it will be the enrolment screens.

* A span is billed month by month: the whole price from the 1st, the lessons left in the month it began.
* Ending a span (leaving, a freeze) gives back the lessons not reached. Coming back is a new span.
* A date that turns out wrong voids the span's rows and writes them again, so both stay visible.
* Every row has a key and a key has one live row, so running any of this twice writes nothing twice.
* A person enters payments, refunds and adjustments with ``enter_money`` and takes them back with
  ``void_entered``. What the ledger wrote itself is never voided by hand.
* A span billed per lesson (``SpanRule.LESSON``, owner 2026-11-22) writes a new student's first month in full,
  then one row per lesson day; below zero the student is frozen (``apply_debt_freeze``). See ``_bill_lessons``.
"""

import logging
from collections.abc import Iterator
from datetime import date, timedelta

from django.db import IntegrityError, transaction
from django.db.models import F as models_F, Q, Sum
from django.utils import timezone

from . import conf
from .lessons import add_one_month, lesson_days, month_amount, seat_lesson_price
from .models import (
    Account,
    BillingRun,
    BillingState,
    EndReason,
    Entry,
    EntryKind,
    PaymentMethod,
    Seat,
    SeatPriceChange,
    SeatState,
    Span,
    SpanRule,
)

logger = logging.getLogger(__name__)

#: What the key of a row a person entered starts with: the only rows a person can void.
MANUAL_KEY = "manual:"
#: Stops a slip of the hand; a year of two groups is far below it.
MAX_AMOUNT = 50_000_000
#: A new student's first month (one per student) and each lesson of a span billed per lesson.
FIRST_KEY = "first:"
LESSON_KEY = "lesson:"
#: A lesson moved to another day (owner, 2026-11-25): charged once, on its new day, keyed by the day it left.
MOVED_KEY = "moved:"
#: The freeze's own words in the people's history (``users.RoleChange``).
REASON_DEBT = "billing_debt"
SOURCE_BILLING = "billing"
#: More freezes than this in one tick wait for a person (``own_tick(allow_mass=True)``): a wrong rule or price
#: must not lock out the whole centre at once.
MAX_FREEZES_PER_TICK = 40


class EntryRefused(ValueError):
    """Why this money cannot be entered, in words for the person at the form."""


def month_of(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def _first_day(month: str) -> date:
    year, number = (int(part) for part in month.split("-"))
    return date(year, number, 1)


def _months(first: str, last: str) -> Iterator[str]:
    year, number = (int(part) for part in first.split("-"))
    while (month := f"{year:04d}-{number:02d}") <= last:
        yield month
        year, number = (year + 1, 1) if number == 12 else (year, number + 1)


def balance(account) -> int:
    return account.entries.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"] or 0


def post(account, kind, amount, day, key, *, span=None, seat=None, month="", method="", note="", by=None) -> Entry | None:
    """Write one row; ``None`` when the key already has a live one."""
    if Entry.objects.filter(key=key, voided_at__isnull=True).exists():
        return None
    try:
        with transaction.atomic():
            return Entry.objects.create(
                account=account, span=span, seat=seat, kind=kind, amount=amount, day=day, month=month, key=key,
                method=method, note=note, created_by=by,
            )
    except IntegrityError:  # another writer got there first
        return None


def void(entry, reason: str, *, by=None) -> None:
    """A row is never deleted: it stops counting and says why."""
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("A voided row needs a reason.")
    entry.voided_at, entry.voided_by, entry.void_reason = timezone.now(), by, reason[:300]
    entry.save(update_fields=["voided_at", "voided_by", "void_reason"])


def was_entered_by_hand(entry) -> bool:
    return entry.key.startswith(MANUAL_KEY)


def _check_amount(amount) -> None:
    if type(amount) is not int or amount <= 0:
        raise EntryRefused("The amount must be a whole number of so'm above zero.")
    if amount > MAX_AMOUNT:
        raise EntryRefused(f"That amount is too large: the most is {MAX_AMOUNT:,} so'm at a time.")


def payment_seat(account, seat=None):
    """The group a payment or a refund is for: the one given (it must be this student's), else the student's only
    group. A student in two or more groups must be asked — lc-up asks too. ``None`` for a student in no group."""
    live = [s for s in account.seats.all() if s.state != SeatState.LEFT]
    if seat is not None:
        if seat.account_id != account.pk:
            raise EntryRefused("That group is not this student's.")
        return seat
    if len(live) == 1:
        return live[0]
    if len(live) > 1:
        raise EntryRefused("Choose the group this payment is for.")
    return None


def enter_money(account, kind, amount, day, *, request_id, today, method="", note="", by=None, seat=None) -> Entry:
    """A payment, a refund or an adjustment a person enters. ``request_id`` comes from the form, so a double
    click, or a retry after a lost answer, is the same row. An adjustment's amount carries its sign.

    A payment or a refund is for one group (``seat``): given, or the student's only one. An adjustment may name one."""
    key = f"{MANUAL_KEY}{request_id}"
    existing = Entry.objects.filter(key=key).order_by("id").first()
    if existing:
        if existing.account_id != account.pk:
            raise EntryRefused("This form was already used for another student. Reload the page.")
        return existing
    opened_at = BillingState.get().opened_at
    if opened_at is None:
        raise EntryRefused("The ledger is not open yet.")
    if day > today:
        raise EntryRefused("That day is in the future.")
    if day < timezone.localdate(opened_at):
        raise EntryRefused("That day is before the ledger's opening balance, which already carries that money.")
    note = (note or "").strip()[:300]
    if kind == EntryKind.ADJUST:
        _check_amount(abs(amount) if type(amount) is int else amount)
        if not note:
            raise EntryRefused("An adjustment needs a reason.")
        signed, method = amount, ""
    elif kind in (EntryKind.PAYMENT, EntryKind.REFUND):
        _check_amount(amount)
        if method not in PaymentMethod.values:
            raise EntryRefused("Choose a payment method.")
        if kind == EntryKind.PAYMENT and conf.lesson_billing():
            _check_least_payment(account, amount)
        signed = amount if kind == EntryKind.PAYMENT else -amount
        seat = payment_seat(account, seat)
    else:
        raise EntryRefused("Only a payment, a refund or an adjustment can be entered.")
    if seat is not None and seat.account_id != account.pk:
        raise EntryRefused("That group is not this student's.")
    row = post(account, kind, signed, day, key, seat=seat, method=method, note=note, by=by)
    return row or Entry.objects.get(key=key, voided_at__isnull=True)


def is_new_student(account) -> bool:
    """Someone who first came once students pay per lesson: no opening balance carried from lc-up and no seat ever
    billed by the month. Only they pay a first month in full (owner, 2026-11-22: "birinchi kelgan o'quvchi")."""
    if account.pk is None:
        return True
    if account.entries.filter(voided_at__isnull=True, kind=EntryKind.OPENING).exists():
        return False
    return not Span.objects.filter(seat__account=account, rule=SpanRule.MONTH).exists()


def first_month_fee(account) -> int | None:
    """What a new student's first month costs: the row once written, else the group price of their seat; None for
    someone who is not new."""
    if not is_new_student(account):
        return None
    row = Entry.objects.filter(key=f"{FIRST_KEY}{account.pk}", voided_at__isnull=True).first()
    if row is not None:
        return -row.amount
    prices = [seat.charge_price for seat in account.seats.all() if seat.state != SeatState.LEFT]
    return max(prices) if prices else None


def least_payment(account) -> int:
    """The least one payment may be while students pay per lesson: a new student's first payment is the first month
    in full ("birinchi to'lovda to'liq 500 ming"); every other top-up at least ``conf.min_topup()``."""
    least = conf.min_topup()
    if account.pk is None or not account.entries.filter(voided_at__isnull=True, kind=EntryKind.PAYMENT).exists():
        fee = first_month_fee(account)
        if fee:
            least = max(least, fee)
    return least


def _check_least_payment(account, amount: int) -> None:
    least = least_payment(account)
    if amount >= least:
        return
    if least > conf.min_topup():
        raise EntryRefused(f"A new student's first payment is the whole first month: at least {least:,} so'm.")
    raise EntryRefused(f"A top-up is at least {least:,} so'm.")


@transaction.atomic
def void_entered(entry, reason: str, *, by) -> None:
    """Take back money a person entered. Only that: a charge would be written again by the next tick, so a wrong
    one is put right with an adjustment."""
    row = Entry.objects.select_for_update().get(pk=entry.pk)
    if not was_entered_by_hand(row):
        raise EntryRefused("Only money entered by hand can be voided. Put anything else right with an adjustment.")
    if row.voided_at:
        raise EntryRefused("This row is already voided.")
    if not (reason or "").strip():
        raise EntryRefused("Say why this row is being voided.")
    void(row, reason, by=by)


def _give_back(span, month: str, charged: int, whole: int) -> None:
    """The lessons of the span's last month after its end. A whole-month charge is its own price, so a
    price changed since does not move what comes back."""
    seat = span.seat
    price = charged if whole == seat.charge_price else seat.charge_price
    kept = month_amount(price, seat.days, month, start=span.start, end=span.end)
    if charged > kept:
        post(seat.account, EntryKind.CREDIT, charged - kept, span.end, f"end:{span.pk}:{month}", span=span, month=month)


def bill_span(span, today: date) -> None:
    """Write whatever of this span's rows is missing, up to today's month (a lesson span: up to today)."""
    if span.rule == SpanRule.LESSON:
        _bill_lessons(span, today)
        return
    seat = span.seat
    first = month_of(span.start)
    end_month = max(first, month_of(span.end)) if span.end else None
    last = min(end_month, month_of(today)) if end_month else month_of(today)
    for month in _months(first, last):
        whole = month_amount(seat.charge_price, seat.days, month, start=span.start)
        if span.opening_month and month <= span.opening_month:
            charged = whole  # lc-up charged it; the opening balance carries it
        else:
            key = f"charge:{span.pk}:{month}"
            if whole:
                day = max(span.start, _first_day(month))
                post(seat.account, EntryKind.CHARGE, -whole, day, key, span=span, month=month)
            row = Entry.objects.filter(key=key, voided_at__isnull=True).first()
            charged = -row.amount if row else 0
        if month == end_month:
            _give_back(span, month, charged, whole)


def _first_paid_span(account):
    """A new student's first paid span, the one whose first month is paid in full; None for anyone else."""
    if not is_new_student(account):
        return None
    spans = Span.objects.filter(seat__account=account, rule=SpanRule.LESSON).exclude(end__lt=models_F("start"))
    return spans.order_by("start", "id").first()


def lesson_price(seat) -> int:
    return seat_lesson_price(seat.charge_price, conf.lessons_per_month())


def _write_first_fee(span, today: date) -> None:
    """The new student's first month, written once by their first paid span on its first day."""
    seat, account = span.seat, span.seat.account
    key = f"{FIRST_KEY}{account.pk}"
    if span.start > today or Entry.objects.filter(key=key, voided_at__isnull=True).exists():
        return
    first = _first_paid_span(account)
    if first is None or first.pk != span.pk:
        return
    post(
        account, EntryKind.CHARGE, -seat.charge_price, span.start, key, span=span, seat=seat,
        month=month_of(span.start), note=f"First month from {span.start.isoformat()}",
    )


def first_month_window(account) -> tuple[Entry, date, set[int]] | None:
    """A new student's first month: its row, the day after it ends, and the spans whose lessons it covers.

    One month of studying from the first day (owner, 2026-11-22). Days the seat is frozen inside it are added on
    ("ha"). A move to another group inside it takes the rest of the month along; a move after it does not, and a
    second group beside the first pays per lesson ("birinchi oyda guruh almashtirilsa qoladi, ikkinchi oydan
    boshqa guruhga o'tsa yo'q")."""
    row = Entry.objects.filter(key=f"{FIRST_KEY}{account.pk}", voided_at__isnull=True).first()
    if row is None or row.seat_id is None:
        return None
    end = add_one_month(row.day)
    seat_id, chain, last = row.seat_id, set(), None
    spans = (
        Span.objects.filter(seat__account=account, rule=SpanRule.LESSON, start__gte=row.day)
        .exclude(end__lt=models_F("start"))
        .order_by("start", "id")
    )
    for span in spans:
        if span.seat_id == seat_id:
            if last is not None and last.ended_by == EndReason.FREEZE and last.end is not None and last.end < end:
                end += timedelta(days=max((span.start - last.end).days - 1, 0))
        elif (
            last is not None and last.ended_by == EndReason.LEAVE and last.end is not None
            and last.end <= span.start <= last.end + timedelta(days=1) and span.start < end
        ):
            seat_id = span.seat_id
        else:
            continue
        chain.add(span.pk)
        last = span
    return row, end, chain


def _bill_lessons(span, today: date) -> None:
    """A span paid per lesson (owner, 2026-11-22): a new student's first month in full on its first day, then one
    lesson's price on each lesson day of the group, written on that day. Lessons after the span's end, or not yet
    come, are not written; an absence changes nothing, as with the monthly rule.

    A day the class called off or moved away, or a centre holiday (owner, 2026-11-25), is skipped here, so no tick
    charges it again once ``lesson_money`` voided it; a moved lesson is charged once, on its new day."""
    from classes.lesson_changes import day_changes  # here, not at the top: classes imports billing

    seat = span.seat
    if span.start > today or (span.end is not None and span.end < span.start):
        return  # not begun yet, or called off before it began
    _write_first_fee(span, today)
    window = first_month_window(seat.account)
    covered = (window[0].day, window[1]) if window and span.pk in window[2] else None
    price = lesson_price(seat)
    if not price:
        return  # a grant
    last = min(span.end, today) if span.end else today
    # The rows before the changes: a change commits together with its voids, so a row read here as voided always
    # has its change in the read below, and a tick running beside an admin never writes a voided day again.
    have = set(
        span.entries.filter(voided_at__isnull=True)
        .filter(Q(key__startswith=LESSON_KEY) | Q(key__startswith=MOVED_KEY))
        .values_list("key", flat=True)
    )
    changes = day_changes(seat.classroom_id, span.start, last)
    for day in lesson_days(seat.days, span.start, last):
        if day in changes.off:
            continue
        if covered and covered[0] <= day < covered[1]:
            continue
        key = f"{LESSON_KEY}{span.pk}:{day.isoformat()}"
        if key not in have:
            post(
                seat.account, EntryKind.CHARGE, -price, day, key, span=span, seat=seat, month=month_of(day),
                note=f"Lesson {day.isoformat()}",
            )
    for old, new in sorted(changes.moved.items()):
        # One lesson of the class on its new day, whether or not its old day was one of this span's: they attend it.
        if not (span.start <= new <= last) or (covered and covered[0] <= new < covered[1]):
            continue
        key = f"{MOVED_KEY}{span.pk}:{old.isoformat()}"
        if key not in have:
            post(
                seat.account, EntryKind.CHARGE, -price, new, key, span=span, seat=seat, month=month_of(new),
                note=f"Lesson {old.isoformat()} moved to {new.isoformat()}",
            )


def bill_open_spans(today: date) -> list[str]:
    """Each new month's charge, for every span still running in it. One span failing stops only itself."""
    errors = []
    running = Span.objects.filter(Q(end__isnull=True) | Q(end__gte=_first_day(month_of(today))))
    for span in running.select_related("seat__account"):
        try:
            with transaction.atomic():
                bill_span(span, today)
        except Exception as exc:  # noqa: BLE001 - the others still have to be billed
            logger.exception("billing: span %s failed", span.pk)
            errors.append(f"span {span.pk}: {type(exc).__name__}: {exc}"[:300])
    return errors


@transaction.atomic
def set_personal_price(seat, price: int | None, *, reason: str, by, today: date) -> None:
    """A price for this student alone, ``None`` for the group's again, 0 for a grant. This month's charge is
    voided and written again; earlier months stay as they were. Every change keeps who and why."""
    reason = (reason or "").strip()[:300]
    if not reason:
        raise EntryRefused("A personal price needs a reason.")
    if price is not None and (type(price) is not int or price < 0 or price > MAX_AMOUNT):
        raise EntryRefused("A personal price is a whole number of so'm, or nothing for the group's price.")
    seat = Seat.objects.select_for_update().get(pk=seat.pk)
    if seat.personal_price == price:
        return
    SeatPriceChange.objects.create(seat=seat, old_price=seat.personal_price, new_price=price, reason=reason, changed_by=by)
    seat.personal_price = price
    seat.save(update_fields=["personal_price"])
    month = month_of(today)
    # A lesson already written keeps its price; the next one is at the new price. A month is written again.
    for span in seat.spans.filter(end__isnull=True, rule=SpanRule.MONTH):
        for entry in span.entries.filter(voided_at__isnull=True, kind=EntryKind.CHARGE, month=month):
            void(entry, f"New personal price: {reason}", by=by)
        bill_span(span, today)


@transaction.atomic
def start_span(seat, day: date, *, today: date, opening_month: str = "", rule: str | None = None) -> Span:
    """``rule`` is the span's for good: ``conf.default_rule()`` unless told."""
    span = Span.objects.create(seat=seat, start=day, opening_month=opening_month, rule=rule or conf.default_rule())
    bill_span(span, today)
    return span


@transaction.atomic
def end_span(span, day: date, why: str, *, today: date) -> None:
    span.end, span.ended_by = day, why
    span.save(update_fields=["end", "ended_by"])
    if span.rule == SpanRule.LESSON:
        if day < span.start:  # called off before it began: nothing of it stands, the first month neither
            later = span.entries.filter(voided_at__isnull=True)
        else:  # the first month is paid in full and stays (owner: "to'liq 500 ming")
            # Every charge dated after the end: its lessons (LESSON_KEY), and the lessons moved to a day after it
            # (MOVED_KEY rows carry their new day), whatever day they were moved from.
            later = span.entries.filter(voided_at__isnull=True, kind=EntryKind.CHARGE, day__gt=day).exclude(
                key__startswith=FIRST_KEY
            )
    else:
        later = span.entries.filter(voided_at__isnull=True, kind=EntryKind.CHARGE, month__gt=month_of(day))
    for entry in later:
        void(entry, f"{why}: the seat ended on {day.isoformat()}")
    bill_span(span, today)


@transaction.atomic
def move_span(span, *, today: date, reason: str, start: date | None = None, end: date | None = None) -> None:
    """A date was wrong: void what the span wrote and write it again from the right dates."""
    start, end = start or span.start, end or span.end
    if start == span.start and end == span.end:
        return
    for entry in span.entries.filter(voided_at__isnull=True):
        void(entry, reason)
    span.start, span.end = start, end
    span.save(update_fields=["start", "end"])
    bill_span(span, today)


# ── The debt freeze and the tick, once the ledger is ours ────────────────────────────────────────────────


def _debt_exempt(user) -> bool:
    """An admin said never to freeze this student for debt (kept on lc-up's link until there is a place of ours)."""
    from lcup.models import LcupStudentLink

    return LcupStudentLink.objects.filter(user=user, debt_freeze_exempt_at__isnull=False).exists()


def apply_debt_freeze(account, *, freeze: bool = True) -> str | None:
    """Owner, 2026-11-22: "hisob minus bo'lganda muzlatiladi". Below zero, the student's account is frozen for debt;
    at zero or above, a debt freeze is lifted. An admin's own freeze is never touched. Returns "frozen",
    "unfrozen" or None. ``freeze=False`` only lifts."""
    from access import constants as C
    from users import audience as A

    user = account.user
    if user is None or str(user.role or "").strip().lower() not in C.LEARNER_ROLES:
        return None
    owes = balance(account) < 0
    debt_frozen = user.is_frozen and user.frozen_reason == A.FROZEN_LCUP_DEBT
    if owes and not user.is_frozen and freeze and not _debt_exempt(user):
        return "frozen" if A.freeze_for_debt(user, reason=REASON_DEBT, source=SOURCE_BILLING) else None
    if debt_frozen and (not owes or _debt_exempt(user)):
        return "unfrozen" if A.clear_debt_freeze(user, source=SOURCE_BILLING) else None
    return None


def own_tick(today: date, *, allow_mass: bool = False) -> dict:
    """Every 15 minutes once the ledger is ours: each running span's missing rows, then, while students pay per
    lesson, the debt freeze for everyone with an account. A tick that would freeze more than
    ``MAX_FREEZES_PER_TICK`` at once only lifts, and says so."""
    from collections import Counter

    counts, alerts = Counter(), []
    errors = bill_open_spans(today)
    if conf.lesson_billing():
        accounts = list(Account.objects.filter(user__isnull=False).select_related("user"))
        owing = {row["account_id"] for row in _owing_accounts()}
        to_freeze = [a for a in accounts if a.pk in owing and not a.user.is_frozen]
        freeze = allow_mass or len(to_freeze) <= MAX_FREEZES_PER_TICK
        if not freeze:
            alerts.append(f"debt freezes held: {len(to_freeze)} > {MAX_FREEZES_PER_TICK} in one tick")
            counts["debt_freezes_held"] = len(to_freeze)
        for account in accounts:
            try:
                done = apply_debt_freeze(account, freeze=freeze)
            except Exception as exc:  # noqa: BLE001 - one person failing must not stop the others
                logger.exception("billing: freeze of account %s failed", account.pk)
                errors.append(f"freeze {account.pk}: {type(exc).__name__}: {exc}"[:300])
                continue
            if done:
                counts[f"debt_{done}"] += 1
    state = BillingState.get()
    state.last_tick_at = timezone.now()
    state.save(update_fields=["last_tick_at"])
    if counts or errors or alerts:
        BillingRun.objects.create(
            kind=BillingRun.Kind.TICK, day=today, finished_at=timezone.now(), ok=not errors, counts=dict(counts),
            errors=errors[:50], alerts=alerts,
        )
    return {"counts": dict(counts), "errors": errors, "alerts": alerts}


def _owing_accounts():
    return (
        Entry.objects.filter(voided_at__isnull=True, account__user__isnull=False)
        .values("account_id")
        .annotate(total=Sum("amount"))
        .filter(total__lt=0)
    )
