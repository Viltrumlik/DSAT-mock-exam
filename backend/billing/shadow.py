"""The ledger beside lc-up, until the owner cuts over (owner, 2026-11-04).

lc-up stays the master: admins enter payments there, and balances, the debt freeze and the SMS keep reading
lc-up's numbers. Nothing here calls lc-up or touches anything but the billing tables: it reads what the sync
and the archive already keep, and this module goes away with lc-up.

* ``open_ledger`` opens one account per person with a live seat or money in lc-up, from lc-up's balance.
* ``mirror_payments`` copies payments made after that.
* ``watch`` compares each seat with what it saw last and tells ``ledger`` what happened. lc-up gives state,
  not events, and no date for a freeze, so a freeze counts from the day it is first seen.
* ``compare`` puts the two balances side by side each day. The ledger writes its own charges, so a match is
  evidence it is right.

A failed sync is never believed: lc-up answering nothing must not read as everyone leaving.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupPayment, LcupStudentLink, LcupSyncRun
from lcup.models_archive import ArchiveEntity, LcupArchiveRecord
from lcup.seats import differences as seat_differences

from . import conf, ledger
from .models import Account, BillingRun, BillingState, EndReason, Entry, EntryKind, Seat, SeatState

logger = logging.getLogger(__name__)

#: A sync older than this is not believed; it runs every 15 minutes.
SYNC_MAX_AGE = timedelta(minutes=45)
#: More seats ending than this in one tick wait for a person (lc-up answering with something wrong).
MAX_ENDS_PER_TICK = 40
#: Up to this far apart, in so'm, two balances are a rounding matter.
SMALL_DIFFERENCE = 1000
_PAYMENT_KEY = "lcup-payment:"
_STATES = {"active": SeatState.ACTIVE, "trial": SeatState.TRIAL, "frozen": SeatState.FROZEN}


class NotReady(Exception):
    """The ledger cannot open now; the message says why."""


@dataclass
class Result:
    counts: Counter = field(default_factory=Counter)
    errors: list = field(default_factory=list)
    alerts: list = field(default_factory=list)

    def fail(self, where: str, exc: Exception) -> None:
        logger.exception("billing: %s failed", where)
        self.errors.append(f"{where}: {type(exc).__name__}: {exc}"[:300])


@dataclass
class Person:
    lcup_id: int
    name: str = ""
    phone: str = ""
    user_id: int | None = None
    balance: int | None = None


def sync_healthy(now) -> bool:
    run = LcupSyncRun.objects.filter(dry_run=False).order_by("-started_at").first()
    return bool(run and run.ok and run.finished_at and run.finished_at >= now - SYNC_MAX_AGE)


def _money(value) -> int | None:
    try:
        return round(float(value))
    except (TypeError, ValueError):
        return None


def lcup_people() -> dict[int, Person]:
    """Everyone lc-up knows and their balance. The sync's is fresher, except for someone lc-up dropped from
    its list: only the archive still asks for those, one by one."""
    people = {}
    rows = LcupArchiveRecord.objects.filter(entity=ArchiveEntity.STUDENT).values_list("lcup_id", "payload")
    for lcup_id, payload in rows.iterator():
        people[int(lcup_id)] = Person(
            int(lcup_id), str(payload.get("name") or "").strip(), str(payload.get("phone") or ""), None,
            _money(payload.get("balance")),
        )
    for link in LcupStudentLink.objects.all().iterator():
        person = people.setdefault(link.lcup_student_id, Person(link.lcup_student_id))
        person.name, person.phone = link.name.strip() or person.name, link.phone or person.phone
        person.user_id = link.user_id
        if link.balance is not None and (not link.deleted_in_lcup or person.balance is None):
            person.balance = _money(link.balance)
    return people


def _new_account(person: Person) -> Account:
    if person.user_id:
        Account.objects.filter(user_id=person.user_id).update(user=None)
    return Account.objects.create(
        lcup_student_id=person.lcup_id, user_id=person.user_id,
        name=person.name[:200] or f"lc-up {person.lcup_id}", phone=person.phone[:20],
    )


def _account_of(lcup_id: int) -> Account:
    account = Account.objects.filter(lcup_student_id=lcup_id).first()
    return account or _new_account(lcup_people().get(lcup_id, Person(lcup_id)))


def _refresh_accounts() -> None:
    """A learner's name, phone and linked user follow lc-up's link; the money does not depend on them."""
    links = {link.lcup_student_id: link for link in LcupStudentLink.objects.all().iterator()}
    for account in Account.objects.filter(lcup_student_id__isnull=False).iterator():
        link = links.get(account.lcup_student_id)
        if link is None:
            continue
        name, phone = link.name.strip()[:200] or account.name, link.phone[:20] or account.phone
        if (account.user_id, account.name, account.phone) == (link.user_id, name, phone):
            continue
        if link.user_id:
            Account.objects.filter(user_id=link.user_id).exclude(pk=account.pk).update(user=None)
        account.user_id, account.name, account.phone = link.user_id, name, phone
        account.save(update_fields=["user", "name", "phone"])


def link_seats_to_classes(result: Result) -> None:
    """Each seat's class, from its group's pairing, so the seats are already linked on the day lc-up goes. A seat
    of our own has no group and is none of this pass's business."""
    paired = dict(
        LcupGroupLink.objects.filter(status=GroupLinkStatus.CONFIRMED, classroom__isnull=False)
        .values_list("lcup_group_id", "classroom_id")
    )
    seats = list(Seat.objects.filter(lcup_group_id__isnull=False))
    # Off first: a class passed from one group to another must not meet itself on the way.
    stale = [seat.pk for seat in seats if seat.classroom_id and seat.classroom_id != paired.get(seat.lcup_group_id)]
    Seat.objects.filter(pk__in=stale).update(classroom=None)
    for seat in seats:
        wanted = paired.get(seat.lcup_group_id)
        if not wanted or seat.classroom_id == wanted:
            continue
        try:
            with transaction.atomic():
                Seat.objects.filter(pk=seat.pk).update(classroom_id=wanted)
            result.counts["seats_linked"] += 1
        except IntegrityError as exc:  # the account already has a seat of our own in that class
            result.fail(f"seat {seat.pk}", exc)


def _group_details(group) -> tuple[str, int, list[int]]:
    snapshot = group.snapshot or {}
    try:
        price = int(float(snapshot.get("cost") or 0))
    except (TypeError, ValueError):
        price = 0
    return group.name[:200], price, [int(day) for day in (snapshot.get("days") or [])]


def _state_of(membership) -> str | None:
    if membership.left_at or membership.group.deleted_in_lcup_at:
        return SeatState.LEFT
    return _STATES.get(membership.lcup_status)


def _left_on(membership):
    return timezone.localdate(membership.left_at or membership.group.deleted_in_lcup_at)


def _first_day(membership, today):
    if membership.start_date:
        return membership.start_date
    return timezone.localdate(membership.joined_at) if membership.joined_at else today


def open_ledger(now, *, apply: bool) -> dict:
    """Open every account once. Without ``apply`` it does all of it and rolls it back, so the report is
    exactly what opening would write."""
    state = BillingState.get()
    if state.opened_at:
        raise NotReady("The ledger is already open.")
    if not sync_healthy(now):
        raise NotReady("The last lc-up sync failed or is too old.")
    today, report = timezone.localdate(now), Counter()
    month = ledger.month_of(today)
    with transaction.atomic():
        people = lcup_people()
        live = list(
            LcupMembership.objects.filter(left_at__isnull=True, group__deleted_in_lcup_at__isnull=True)
            .select_related("group", "student")
        )
        in_a_group = {membership.student.lcup_student_id for membership in live}
        accounts = {}
        for lcup_id, person in people.items():
            balance = person.balance or 0
            if lcup_id not in in_a_group and not balance:
                continue
            accounts[lcup_id] = _new_account(person)
            report["accounts"] += 1
            report["live" if lcup_id in in_a_group else "former"] += 1
            if balance:
                ledger.post(accounts[lcup_id], EntryKind.OPENING, balance, today, f"opening:{lcup_id}")
                report["owed_count" if balance < 0 else "credit_count"] += 1
                report["owed_total" if balance < 0 else "credit_total"] += balance
            else:
                report["zero"] += 1
        for membership in live:
            seat_state = _state_of(membership)
            if seat_state is None:
                report["unknown_status"] += 1
                continue
            name, price, days = _group_details(membership.group)
            seat = Seat.objects.create(
                account=accounts[membership.student.lcup_student_id], group_name=name,
                lcup_group_id=membership.group.lcup_group_id, price=price, days=days, state=seat_state,
                lcup_start_date=membership.start_date,
            )
            report["seats"] += 1
            if seat_state == SeatState.ACTIVE:
                ledger.start_span(seat, _first_day(membership, today), today=today, opening_month=month)
                report["spans"] += 1
                report["no_price_or_days"] += not (price and days)
        link_seats_to_classes(Result())
        state.opened_at = now
        state.opening_max_payment_id = LcupPayment.objects.aggregate(top=Max("lcup_payment_id"))["top"] or 0
        state.save(update_fields=["opened_at", "opening_max_payment_id"])
        if not apply:
            transaction.set_rollback(True)
    counts = dict(report)
    BillingRun.objects.create(kind=BillingRun.Kind.OPEN, day=today, finished_at=timezone.now(), counts=dict(counts, applied=apply))
    return counts


def _payment_kind(payment) -> str:
    return EntryKind.REFUND if payment.kind == "refund" else EntryKind.PAYMENT


def mirror_payments(result: Result) -> None:
    """Copy lc-up's payments made since the opening. One lc-up changed is voided and written again; one it
    deleted is voided. ``LcupPayment`` is complete for what the sync re-reads, so missing means deleted."""
    state = BillingState.get()
    live = {e.key: e for e in Entry.objects.filter(key__startswith=_PAYMENT_KEY, voided_at__isnull=True)}
    seen = set()
    for payment in LcupPayment.objects.filter(lcup_payment_id__gt=state.opening_max_payment_id).iterator():
        key = f"{_PAYMENT_KEY}{payment.lcup_payment_id}"
        seen.add(key)
        kind, method = _payment_kind(payment), payment.method[:60]
        entry = live.get(key)
        if entry and (entry.amount, entry.day, entry.kind, entry.method) == (payment.amount, payment.paid_on, kind, method):
            continue
        try:
            with transaction.atomic():
                if entry:
                    ledger.void(entry, "lc-up changed this payment")
                ledger.post(
                    _account_of(payment.lcup_student_id), kind, payment.amount, payment.paid_on, key,
                    method=method, note=payment.note[:300],
                )
            result.counts["payments"] += 1
        except Exception as exc:  # noqa: BLE001 - the other payments still have to be copied
            result.fail(f"payment {payment.lcup_payment_id}", exc)
    for key, entry in live.items():
        if key not in seen:
            ledger.void(entry, "lc-up deleted this payment")
            result.counts["payments_voided"] += 1


def _changed(seat, state, membership, details) -> bool:
    if (seat.group_name, seat.price, seat.days) != details or seat.state != state:
        return True
    if membership.start_date != seat.lcup_start_date:
        return True
    return state == SeatState.LEFT and _left_on(membership) != seat.lcup_left_on


def _apply(membership, seat, state, details, today, result: Result) -> None:
    name, price, days = details
    if seat is None:
        seat = Seat.objects.create(
            account=_account_of(membership.student.lcup_student_id), group_name=name,
            lcup_group_id=membership.group.lcup_group_id, price=price, days=days, state=state,
            lcup_start_date=membership.start_date,
        )
        if state == SeatState.ACTIVE:
            ledger.start_span(seat, _first_day(membership, today), today=today)
            result.counts["started"] += 1
        return
    was, start_moved = seat.state, membership.start_date != seat.lcup_start_date
    left_on = _left_on(membership) if state == SeatState.LEFT else None
    left_moved = was == SeatState.LEFT and state == SeatState.LEFT and seat.lcup_left_on != left_on
    seat.group_name, seat.price, seat.days, seat.state = name, price, days, state
    seat.lcup_start_date, seat.lcup_left_on = membership.start_date, left_on
    seat.save()
    running = seat.spans.filter(end__isnull=True).order_by("-id").first()
    if was == SeatState.ACTIVE and state != SeatState.ACTIVE:
        if running:
            if state == SeatState.LEFT:
                ledger.end_span(running, left_on, EndReason.LEAVE, today=today)
            else:
                ledger.end_span(running, today, EndReason.FREEZE, today=today)
            result.counts["ended"] += 1
    elif was != SeatState.ACTIVE and state == SeatState.ACTIVE:
        # After a trial lc-up moves the start date to the first paid day (19 of 19 on prod, 2026-11-04).
        day = membership.start_date if start_moved and membership.start_date else today
        ledger.start_span(seat, day, today=today)
        result.counts["started"] += 1
    elif state == SeatState.ACTIVE and start_moved and membership.start_date and running and seat.spans.count() == 1:
        ledger.move_span(running, start=membership.start_date, today=today, reason="lc-up changed the start date")
        result.counts["moved"] += 1
    elif left_moved:
        last = seat.spans.filter(ended_by=EndReason.LEAVE).order_by("-id").first()
        if last:
            ledger.move_span(last, end=left_on, today=today, reason="lc-up changed the leaving date")
            result.counts["moved"] += 1


def watch(now, *, allow_mass: bool = False) -> Result:
    """Turn what the sync sees into what happened. Every seat stands alone: one failing stops only itself,
    and comes back on the next tick because its state has still not been taken in."""
    today, result = timezone.localdate(now), Result()
    seats = {(s.account.lcup_student_id, s.lcup_group_id): s for s in Seat.objects.select_related("account")}
    plan = []
    for membership in LcupMembership.objects.select_related("group", "student").iterator():
        state = _state_of(membership)
        if state is None:
            result.alerts.append(f"Unknown lc-up status {membership.lcup_status!r} on membership {membership.pk}")
            continue
        seat = seats.get((membership.student.lcup_student_id, membership.group.lcup_group_id))
        if seat is None and state == SeatState.LEFT:
            continue  # left before the ledger knew them
        details = _group_details(membership.group)
        if seat is None or _changed(seat, state, membership, details):
            plan.append((membership, seat, state, details))
    ended = sum(1 for _, seat, state, _ in plan if seat and seat.state == SeatState.ACTIVE and state != SeatState.ACTIVE)
    if ended > MAX_ENDS_PER_TICK and not allow_mass:
        result.alerts.append(f"{ended} seats ended at once: waiting for a person (manage.py billing_tick --allow-mass)")
        return result
    for membership, seat, state, details in plan:
        try:
            with transaction.atomic():
                _apply(membership, seat, state, details, today, result)
        except Exception as exc:  # noqa: BLE001 - the other seats still have to be followed
            result.fail(f"membership {membership.pk}", exc)
    return result


def tick(now=None, *, allow_mass: bool = False) -> dict:
    now = now or timezone.now()
    if not conf.shadow_enabled():
        return {"skipped": "disabled"}
    state = BillingState.get()
    if state.opened_at is None:
        return {"skipped": "not opened"}
    if not sync_healthy(now):
        return {"skipped": "sync not healthy"}
    started_at, rows_before = timezone.now(), Entry.objects.count()
    result = Result()
    _refresh_accounts()
    mirror_payments(result)
    watched = watch(now, allow_mass=allow_mass)
    result.counts.update(watched.counts)
    result.errors += watched.errors
    result.alerts += watched.alerts
    link_seats_to_classes(result)
    result.errors += ledger.bill_open_spans(timezone.localdate(now))
    if written := Entry.objects.count() - rows_before:
        result.counts["rows"] = written
    state.last_tick_at = now
    state.save(update_fields=["last_tick_at"])
    if result.counts or result.errors or result.alerts:
        BillingRun.objects.create(
            kind=BillingRun.Kind.TICK, started_at=started_at, finished_at=timezone.now(), ok=not result.errors,
            counts=dict(result.counts), errors=result.errors, alerts=result.alerts,
        )
    return dict(result.counts)


def compare(now=None) -> BillingRun:
    """Each person's two balances. Someone lc-up holds money for and the ledger does not know is listed too."""
    now = now or timezone.now()
    today = timezone.localdate(now)
    if not sync_healthy(now):
        return BillingRun.objects.create(
            kind=BillingRun.Kind.COMPARE, day=today, finished_at=timezone.now(), ok=False,
            alerts=["The last lc-up sync failed or is too old, so nothing was compared."],
        )
    people = lcup_people()
    ours = dict(
        Entry.objects.filter(voided_at__isnull=True).values_list("account_id").annotate(total=Sum("amount"))
    )
    counts, rows, known = Counter({"matched": 0, "small": 0, "big": 0, "unknown": 0, "missing": 0}), [], set()
    for account in Account.objects.filter(lcup_student_id__isnull=False):
        known.add(account.lcup_student_id)
        person = people.get(account.lcup_student_id)
        if person is None or person.balance is None:
            counts["unknown"] += 1
            continue
        mine = ours.get(account.pk, 0)
        difference = mine - person.balance
        if not difference:
            counts["matched"] += 1
            continue
        counts["small" if abs(difference) <= SMALL_DIFFERENCE else "big"] += 1
        rows.append({"account_id": account.pk, "name": account.name, "ours": mine, "lcup": person.balance, "diff": difference})
    for lcup_id, person in people.items():
        if lcup_id not in known and person.balance:
            counts["missing"] += 1
            rows.append({"account_id": None, "name": person.name, "ours": 0, "lcup": person.balance, "diff": -person.balance})
    rows.sort(key=lambda row: -abs(row["diff"]))
    drift = seat_differences()
    alerts = [f"{len(drift)} seats differ from lc-up: " + "; ".join(drift[:5])[:400]] if drift else []
    return BillingRun.objects.create(
        kind=BillingRun.Kind.COMPARE, day=today, finished_at=timezone.now(), counts=dict(counts), rows=rows, alerts=alerts
    )
