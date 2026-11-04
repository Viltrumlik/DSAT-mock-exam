"""The ledger: rows of money written when something happens to a seat (owner, 2026-11-04).

It knows seats, spans and rows, and nothing about where a change came from: during the shadow run
``shadow.watch`` tells it what lc-up changed, and after lc-up it will be the enrolment screens.

* A span is billed month by month: the whole price from the 1st, the lessons left in the month it began.
* Ending a span (leaving, a freeze) gives back the lessons not reached. Coming back is a new span.
* A date that turns out wrong voids the span's rows and writes them again, so both stay visible.
* Every row has a key and a key has one live row, so running any of this twice writes nothing twice.
"""

import logging
from collections.abc import Iterator
from datetime import date

from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .lessons import month_amount
from .models import Entry, EntryKind, Span

logger = logging.getLogger(__name__)


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


def post(account, kind, amount, day, key, *, span=None, month="", method="", note="", by=None) -> Entry | None:
    """Write one row; ``None`` when the key already has a live one."""
    if Entry.objects.filter(key=key, voided_at__isnull=True).exists():
        return None
    try:
        with transaction.atomic():
            return Entry.objects.create(
                account=account, span=span, kind=kind, amount=amount, day=day, month=month, key=key,
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


def _give_back(span, month: str, charged: int, whole: int) -> None:
    """The lessons of the span's last month after its end. A whole-month charge is its own price, so a
    price changed since does not move what comes back."""
    seat = span.seat
    price = charged if whole == seat.price else seat.price
    kept = month_amount(price, seat.days, month, start=span.start, end=span.end)
    if charged > kept:
        post(seat.account, EntryKind.CREDIT, charged - kept, span.end, f"end:{span.pk}:{month}", span=span, month=month)


def bill_span(span, today: date) -> None:
    """Write whatever of this span's rows is missing, up to today's month."""
    seat = span.seat
    first = month_of(span.start)
    end_month = max(first, month_of(span.end)) if span.end else None
    last = min(end_month, month_of(today)) if end_month else month_of(today)
    for month in _months(first, last):
        whole = month_amount(seat.price, seat.days, month, start=span.start)
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
def start_span(seat, day: date, *, today: date, opening_month: str = "") -> Span:
    span = Span.objects.create(seat=seat, start=day, opening_month=opening_month)
    bill_span(span, today)
    return span


@transaction.atomic
def end_span(span, day: date, why: str, *, today: date) -> None:
    span.end, span.ended_by = day, why
    span.save(update_fields=["end", "ended_by"])
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
