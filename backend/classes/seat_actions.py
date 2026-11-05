"""A student's seat in a group, as an admin moves it once the centre has left lc-up (owner, 2026-11-04).

Add, activate, freeze, return, move, leave, fix a date: each writes the membership and the ledger in one
transaction, so a seat and its money cannot disagree.

* Joining and leaving go through ``ClassroomMembership.save()``, never ``.update()``, so the audit row and the
  class's Telegram group hear about them. The rest of a seat is not a join or a leave: its event is written here.
* An action that does not fit the seat is refused in words (``SeatRefused``). The row is locked first and what it
  says decides, so a second click is refused rather than done twice.
* While lc-up runs all of it is locked (``SeatsLocked``): lc-up is the master and the ledger follows it, so a seat
  moved here on any class, paired or not, would be money lc-up never heard of.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from access import constants as acc_const
from access.models import UserAccess
from billing import ledger
from billing.models import Account, EndReason, Seat, SeatPriceChange, SeatState
from users import audience as A
from users.people_detail import display_name
from users.phone_utils import clean_parent_phone

from .models import Classroom, ClassroomMembership as M
from .models_membership_audit import ClassroomMembershipEvent as Event

_STUDENT, _ACTIVE, _REMOVED = M.ROLE_STUDENT, M.STATUS_ACTIVE, M.STATUS_REMOVED
_WEEKDAYS = {Classroom.DAYS_ODD: [1, 3, 5], Classroom.DAYS_EVEN: [2, 4, 6]}
_LEDGER_STATE = {M.SEAT_ACTIVE: SeatState.ACTIVE, M.SEAT_TRIAL: SeatState.TRIAL}
#: Stops a slip of the hand: every month between a date and today is a row of money.
_MAX_DAYS_AWAY = 366


class SeatRefused(ValueError):
    """Why this cannot be done to this seat, in words for the admin."""


class SeatsLocked(Exception):
    """lc-up still runs, so seats are moved there."""


def weekdays_of(room) -> list[int]:
    """The ledger's ISO weekdays for the class's ODD or EVEN (``classes.lesson_schedule``); [] for neither."""
    return list(_WEEKDAYS.get(room.lesson_days, []))


def _check_open() -> None:
    from lcup.guards import seats_locked

    if seats_locked():
        raise SeatsLocked


def _check_day(day: date, today: date) -> None:
    if abs((day - today).days) > _MAX_DAYS_AWAY:
        raise SeatRefused(f"{day.isoformat()} is more than a year away. Check the date.")


def _check_not_later_than_today(day: date, today: date) -> None:
    if day > today:
        raise SeatRefused("The seat changes now, so this date cannot be later than today. Do it on that day.")


def _check_takes_seats(room) -> None:
    if not room.is_active:
        raise SeatRefused(f"{room.name} is archived.")


def _check_billable(room) -> None:
    """A paid seat in a class with no price or no days would bill nothing, and nobody would notice."""
    if not room.monthly_price:
        raise SeatRefused(f"{room.name} has no monthly price. Set it on the class first, or take them on trial.")
    if not weekdays_of(room):
        raise SeatRefused(f"{room.name} has no lesson days. Set them on the class first, or take them on trial.")


def enrol_refusal(user) -> str | None:
    """Why this account cannot simply be given a seat, or None."""
    role = str(user.role or "").strip().lower()
    if role == acc_const.ROLE_PUBLIC_STUDENT:
        # Owner, 2026-10-13: a first enrolment is always a new account; only someone coming back keeps theirs.
        if not (M.objects.filter(user=user, role=_STUDENT).exists() or Account.objects.filter(user=user).exists()):
            return (
                f"{display_name(user)} has a public account and was never at the centre. A first enrolment is a "
                "new account: use New student with their phone."
            )
    elif role != acc_const.ROLE_STUDENT:
        return "Only a student account can take a seat."
    return None


def _seated(room, user) -> M:
    row = M.objects.select_for_update().filter(classroom=room, user=user, role=_STUDENT).first()
    if row is None:
        raise SeatRefused(f"{display_name(user)} is not in this group.")
    if row.status != _ACTIVE:
        raise SeatRefused(f"{display_name(user)} has left this group.")
    return row


def _find_seat(room, user) -> Seat | None:
    return Seat.objects.select_for_update().filter(account__user=user, classroom=room).first()


def _seat_in(room, user, state) -> Seat:
    """The ledger's seat for this class, with the class's price and days as they are now."""
    seat = _find_seat(room, user)
    if seat is None:
        account, _ = Account.objects.get_or_create(
            user=user, defaults={"name": display_name(user)[:200], "phone": (user.phone_number or "")[:20]}
        )
        return Seat.objects.create(
            account=account, classroom=room, group_name=room.name[:200], price=room.monthly_price or 0,
            days=weekdays_of(room), state=state,
        )
    seat.group_name, seat.state = room.name[:200], state
    seat.price, seat.days = room.monthly_price or seat.price, weekdays_of(room) or seat.days
    seat.save(update_fields=["group_name", "state", "price", "days"])
    return seat


def _running(seat):
    return seat.spans.filter(end__isnull=True).order_by("-id").first()


def _check_after_last_span(seat, day: date) -> None:
    """Coming back on a day already paid for would charge its lesson twice."""
    last = seat.spans.filter(end__isnull=False).order_by("-end").first()
    if last and day <= last.end:
        raise SeatRefused(f"This date must be after {last.end.isoformat()}, the last day this seat was paid for.")


def _check_end(span, day: date, today: date) -> None:
    # A seat that has not begun yet may be called off before it does: it nets to nothing.
    if day < span.start and span.start <= today:
        raise SeatRefused(f"That date is before this seat began, on {span.start.isoformat()}.")


def _end_seat(seat, day: date, why: str, state, *, today: date) -> None:
    if seat is None:
        return  # a member the ledger never billed: no money to stop
    running = _running(seat)
    if running:
        _check_end(running, day, today)
        ledger.end_span(running, day, why, today=today)
    else:
        last = seat.spans.filter(end__isnull=False).order_by("-end").first()
        if last and day < last.end:
            raise SeatRefused(f"That date is before the freeze that began on {last.end.isoformat()}.")
    seat.state = state
    seat.save(update_fields=["state"])


def _note(row, text: str, by) -> None:
    """Who did this and when, in the class's and the person's History. A join or a leave gets its row from the
    membership signals; these changes are not a join or a leave, so the signals see nothing."""
    Event.objects.create(
        classroom=row.classroom, classroom_name=row.classroom.name[:200], student=row.user,
        student_name=display_name(row.user)[:200], actor=by, actor_name=display_name(by)[:200],
        action=Event.ACTION_STATUS_CHANGED, previous_role=row.role, new_role=row.role, previous_status=row.status,
        new_status=row.status, note=text[:240],
    )


def _join(room, user, status, day, *, today, by, personal_price=None, why="") -> M:
    if status not in _LEDGER_STATE:
        raise SeatRefused("A new seat is on trial or active.")
    _check_day(day, today)
    _check_takes_seats(room)
    if status == M.SEAT_ACTIVE:
        _check_billable(room)
    fields = {"status": _ACTIVE, "seat_status": status, "seat_start_date": day, "seat_left_on": None}
    row = M.objects.select_for_update().filter(classroom=room, user=user).first()
    if row is not None and row.role != _STUDENT:
        raise SeatRefused(f"{display_name(user)} is on this class's staff.")
    if row is not None and row.status == _ACTIVE:
        raise SeatRefused(f"{display_name(user)} is already in {room.name}.")
    if row is None:
        # As in the join-code flow: someone coming back is not a net-new seat, so only a new row meets the cap.
        taken = room.memberships.filter(role=_STUDENT).exclude(status=_REMOVED).count()
        if room.max_students is not None and taken >= room.max_students:
            raise SeatRefused(f"{room.name} is full.")
        row, created = M.objects.select_for_update().get_or_create(
            classroom=room, user=user, defaults={"role": _STUDENT, **fields}
        )
        if not created:
            raise SeatRefused(f"{display_name(user)} is already in {room.name}.")
    else:
        for name, value in fields.items():
            setattr(row, name, value)
        row.save(update_fields=list(fields))
    domain = acc_const.DOMAIN_MATH if room.subject == Classroom.SUBJECT_MATH else acc_const.DOMAIN_ENGLISH
    UserAccess.objects.get_or_create(user=user, subject=domain, classroom=room, defaults={"granted_by": by})
    seat = _seat_in(room, user, _LEDGER_STATE[status])
    stray = _running(seat)
    if stray:  # an old roster path took them out and left the ledger running: ended, not doubled
        ledger.end_span(stray, max(stray.start, day - timedelta(days=1)), EndReason.LEAVE, today=today)
    if personal_price is not None and seat.personal_price != personal_price:
        SeatPriceChange.objects.create(
            seat=seat, old_price=seat.personal_price, new_price=personal_price, reason=why[:300], changed_by=by
        )
        seat.personal_price = personal_price
        seat.save(update_fields=["personal_price"])
    if status == M.SEAT_ACTIVE:
        _check_after_last_span(seat, day)
        ledger.start_span(seat, day, today=today)
    if A.is_public_learner(user):
        A.make_centre(user, reason=A.REASON_JOINED, source=A.SOURCE_SEATS)
    return row


@transaction.atomic
def add_student(room, user, status, day, *, today, by) -> M:
    """``trial`` writes no money; ``active`` pays from ``day``."""
    _check_open()
    refusal = enrol_refusal(user)
    if refusal:
        raise SeatRefused(refusal)
    return _join(room, user, status, day, today=today, by=by)


@transaction.atomic
def new_student(room, *, full_name, phone, status, day, today, by, parent_name="", parent_phone="") -> M:
    """Someone new to the centre: a new account (``lcup.accounts.create_centre_account``) and their seat, together.
    A refused seat takes the account, and any phone it moved, back with it. ``PhoneTaken`` says whose phone it is."""
    from lcup.accounts import create_centre_account
    from lcup.phones import normalize_phone

    _check_open()
    full_name = " ".join(str(full_name or "").split())
    if not full_name:
        raise SeatRefused("Enter the student's full name.")
    login = normalize_phone(phone)
    if not login:
        raise SeatRefused("That is not an Uzbek phone number. They sign in with it, so it has to be one.")
    try:
        parent_phone = clean_parent_phone(parent_phone)
    except ValueError as refused:
        raise SeatRefused(f"Parent's phone: {refused}") from None
    user = create_centre_account(
        full_name[:200], login, now=timezone.now(), parent_name=str(parent_name or "").strip()[:200], parent_phone=parent_phone
    )
    return _join(room, user, status, day, today=today, by=by)


@transaction.atomic
def activate(room, user, day, *, today, by) -> M:
    """A trial starts paying. An admin does this, never the clock (owner, 2026-11-04)."""
    _check_open()
    row = _seated(room, user)
    if row.seat_status != M.SEAT_TRIAL:
        raise SeatRefused(f"{display_name(user)} is not on trial.")
    _check_day(day, today)
    _check_takes_seats(room)
    _check_billable(room)
    seat = _seat_in(room, user, SeatState.ACTIVE)
    _check_after_last_span(seat, day)
    ledger.start_span(seat, day, today=today)
    row.seat_status, row.seat_start_date = M.SEAT_ACTIVE, day
    row.save(update_fields=["seat_status", "seat_start_date"])
    _note(row, f"Activated from {day.isoformat()}", by)
    return row


@transaction.atomic
def freeze(room, user, day, *, today, by) -> M:
    """A holiday or an illness: the lessons up to ``day`` are paid, nothing after it until they return."""
    _check_open()
    row = _seated(room, user)
    if row.seat_status == M.SEAT_FROZEN:
        raise SeatRefused(f"{display_name(user)} is already frozen.")
    if row.seat_status == M.SEAT_TRIAL:
        raise SeatRefused(f"{display_name(user)} is on trial, so there is nothing to freeze.")
    _check_not_later_than_today(day, today)
    _check_day(day, today)
    _end_seat(_find_seat(room, user), day, EndReason.FREEZE, SeatState.FROZEN, today=today)
    row.seat_status = M.SEAT_FROZEN
    row.save(update_fields=["seat_status"])
    _note(row, f"Frozen from {day.isoformat()}", by)
    return row


@transaction.atomic
def return_seat(room, user, day, *, today, by) -> M:
    _check_open()
    row = _seated(room, user)
    if row.seat_status != M.SEAT_FROZEN:
        raise SeatRefused(f"{display_name(user)} is not frozen.")
    _check_day(day, today)
    _check_takes_seats(room)
    _check_billable(room)
    seat = _seat_in(room, user, SeatState.ACTIVE)
    _check_after_last_span(seat, day)
    ledger.start_span(seat, day, today=today)
    row.seat_status, row.seat_start_date = M.SEAT_ACTIVE, day
    row.save(update_fields=["seat_status", "seat_start_date"])
    _note(row, f"Back from {day.isoformat()}", by)
    return row


@transaction.atomic
def move(room, user, to_room, day, *, today, by) -> M:
    """Another group, one action (owner, 2026-11-04): the old seat ends as a leave and the new one starts, same
    date. A personal price is the student's, so it goes with them. Never the last group's rule: they have one."""
    _check_open()
    row = _seated(room, user)
    if to_room.pk == room.pk:
        raise SeatRefused(f"{display_name(user)} is already in that group.")
    if row.seat_status == M.SEAT_FROZEN:
        raise SeatRefused(f"{display_name(user)} is frozen. Return them first, then move them.")
    _check_not_later_than_today(day, today)
    _check_day(day, today)
    seat = _find_seat(room, user)
    status = row.seat_status
    last_paid = day
    running = _running(seat) if seat else None
    if running and day.isoweekday() in seat.days and day.isoweekday() in weekdays_of(to_room):
        # Both groups hold a lesson that day and they sit one of them, the new group's: it is paid once.
        last_paid = max(running.start, day - timedelta(days=1))
    _end_seat(seat, last_paid, EndReason.LEAVE, SeatState.LEFT, today=today)
    row.status, row.seat_left_on = _REMOVED, day
    row.save(update_fields=["status", "seat_left_on"])
    return _join(
        to_room, user, status, day, today=today, by=by, personal_price=seat.personal_price if seat else None,
        why=f"Moved from {room.name}",
    )


@transaction.atomic
def leave(room, user, day, *, today, by) -> M:
    _check_open()
    row = _seated(room, user)
    _check_not_later_than_today(day, today)
    _check_day(day, today)
    _end_seat(_find_seat(room, user), day, EndReason.LEAVE, SeatState.LEFT, today=today)
    row.status, row.seat_left_on = _REMOVED, day
    row.save(update_fields=["status", "seat_left_on"])
    _after_the_last_group(user, day, today=today)
    return row


def _after_the_last_group(user, day: date, *, today: date) -> None:
    """The seat rule (``users.audience.seat_plan``) for someone who just left, here because after lc-up nothing
    else runs it: no seat in an active class makes them public, frozen first if they owe. The balance is the
    ledger's, after the lessons given back. Seats left in archived classes go too, so their money stops first."""
    if not getattr(settings, "PUBLIC_SPLIT_ENABLED", False) or str(user.role or "").strip().lower() != acc_const.ROLE_STUDENT:
        return
    others = list(M.objects.filter(user=user, role=_STUDENT).exclude(status=_REMOVED).select_related("classroom"))
    if any(row.status == _ACTIVE and row.classroom.is_active for row in others):
        return
    for row in others:
        seat = _find_seat(row.classroom, user)
        running = _running(seat) if seat else None
        if running:
            ledger.end_span(running, max(day, running.start), EndReason.LEAVE, today=today)
        if seat:
            seat.state = SeatState.LEFT
            seat.save(update_fields=["state"])
    account = Account.objects.filter(user=user).first()
    owes = account is not None and ledger.balance(account) < 0
    A.make_public(
        user, reason=A.REASON_LEFT_WITH_DEBT if owes else A.REASON_LEFT, source=A.SOURCE_SEATS, freeze_for_debt=owes
    )
    M.objects.filter(pk__in=[row.pk for row in others]).update(seat_left_on=day)


@transaction.atomic
def fix_date(room, user, day, *, today, by) -> M:
    """A date typed wrong. The date in question is the one the seat is standing on: a running seat's start, a
    frozen seat's freeze, a left seat's leaving. Money the date moved is voided and written again."""
    _check_open()
    row = M.objects.select_for_update().filter(classroom=room, user=user, role=_STUDENT).first()
    if row is None:
        raise SeatRefused(f"{display_name(user)} is not in this group.")
    _check_day(day, today)
    seat = _find_seat(room, user)
    span = seat.spans.order_by("-id").first() if seat else None
    reason = f"{by.username} fixed the date to {day.isoformat()}"
    before = (row.seat_start_date, row.seat_left_on, span and span.start, span and span.end)
    if row.status == _REMOVED or row.seat_status == M.SEAT_FROZEN:
        why = EndReason.LEAVE if row.status == _REMOVED else EndReason.FREEZE
        if span and span.ended_by == why:
            _check_not_later_than_today(day, today)
            _check_end(span, day, today)
            ledger.move_span(span, end=day, today=today, reason=reason)
        if row.status == _REMOVED:
            row.seat_left_on = day
            row.save(update_fields=["seat_left_on"])
    else:
        if span and span.end is None:
            _check_after_last_span(seat, day)
            ledger.move_span(span, start=day, today=today, reason=reason)
        row.seat_start_date = day
        row.save(update_fields=["seat_start_date"])
    if before != (row.seat_start_date, row.seat_left_on, span and span.start, span and span.end):
        _note(row, f"Date fixed to {day.isoformat()}", by)
    return row


def class_terms_changed(room) -> None:
    """The class's price or days changed. The ledger reads the seat's when it writes a row, so rows already written
    keep theirs and the new price counts from the next 1st; a personal price still wins (``Seat.charge_price``).
    A seat that left keeps what it had, and a price taken away leaves the seats as they were."""
    fields = {}
    if room.monthly_price:
        fields["price"] = room.monthly_price
    if weekdays_of(room):
        fields["days"] = weekdays_of(room)
    if fields:
        Seat.objects.filter(classroom=room).exclude(state=SeatState.LEFT).update(**fields)
