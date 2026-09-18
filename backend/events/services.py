"""Every rule an event has.

The server enforces all of them. A hidden button is not a rule, and the ops console, the
Django admin and a student's browser all reach these functions through different doors.

Refusals carry a CODE as well as a sentence. The student page renders `full`, `started` and
`cancel_window_closed` differently, and reading English back out of a `detail` string to tell
them apart is how a copy edit becomes a bug. The sentence is what a person sees; the code is
what the page branches on.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from access import constants as acc_const
from access.services import normalized_role

from .models import Event, EventRegistration

logger = logging.getLogger(__name__)

#: A student may give a seat back until this long before the start. After it the seat is
#: theirs whether they come or not — which is also the moment ops may start marking arrivals,
#: because the door opens before the event does.
CANCEL_CUTOFF = timedelta(hours=2)

#: How long before the start the reminder goes out.
REMINDER_LEAD = timedelta(hours=24)


class EventRefused(Exception):
    """A refusal with a code the page branches on and a sentence it can show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def is_signupable_student(user) -> bool:
    """Who may hold a seat: an active, unfrozen student account.

    Also the definition the publish broadcast uses for "all active students", so the people
    who are told about an event are exactly the people who can act on it.
    """
    return bool(
        user is not None
        and getattr(user, "pk", None)
        and getattr(user, "is_active", False)
        and not getattr(user, "is_frozen", False)
        and normalized_role(user) == acc_const.ROLE_STUDENT
    )


@transaction.atomic
def sign_up(event: Event, student, *, now=None) -> EventRegistration:
    """Claim a seat. Idempotent; raises `EventRefused` when it cannot be claimed."""
    now = now or timezone.now()
    # Re-read under the row lock, the lock support booking already uses: two students taking
    # the last seat in the same instant must not both win.
    event = Event.objects.select_for_update().get(pk=event.pk)

    if event.status != Event.STATUS_PUBLISHED:
        raise EventRefused("not_open", "That event isn't open for sign-ups.")
    if event.starts_at <= now:
        raise EventRefused("started", "That event has already started.")
    if not is_signupable_student(student):
        raise EventRefused("not_open", "Only students can sign up for events.")

    row = EventRegistration.objects.filter(event=event, student=student).first()
    if row is not None and row.status == EventRegistration.STATUS_REGISTERED:
        return row

    if event.seats_left <= 0:
        raise EventRefused("full", "That event is full. A seat opens if somebody cancels.")

    if row is None:
        return EventRegistration.objects.create(event=event, student=student)

    row.status = EventRegistration.STATUS_REGISTERED
    row.cancel_reason = ""
    row.cancelled_at = None
    row.save(update_fields=["status", "cancel_reason", "cancelled_at", "updated_at"])
    return row


def cancel_registration(registration: EventRegistration, *, now=None) -> EventRegistration:
    """Give the seat back, up to `CANCEL_CUTOFF` before the start."""
    now = now or timezone.now()
    if registration.status != EventRegistration.STATUS_REGISTERED:
        raise EventRefused("not_registered", "You don't hold a seat at that event.")
    if now >= registration.event.starts_at - CANCEL_CUTOFF:
        raise EventRefused(
            "cancel_window_closed",
            "It's too late to cancel — the event starts in less than two hours.",
        )

    registration.status = EventRegistration.STATUS_CANCELLED
    registration.cancel_reason = EventRegistration.REASON_STUDENT
    registration.cancelled_at = now
    registration.save(update_fields=["status", "cancel_reason", "cancelled_at", "updated_at"])
    return registration


#: A change to any of these is news to somebody who has planned their evening around it.
#: Everything else — the description, the picture, the seat count — is housekeeping.
MOVE_FIELDS = ("starts_at", "ends_at", "location")


def publish(event: Event, *, now=None) -> bool:
    """DRAFT → PUBLISHED. Returns True when THIS call claimed the announcement.

    The claim is a conditional UPDATE, not a read-then-save, so two admins pressing Publish
    in the same instant announce once between them. Every downstream leg — the bell, the
    push, roughly 370 emails — hangs off this return value.
    """
    now = now or timezone.now()
    if event.status == Event.STATUS_CANCELLED:
        raise EventRefused("cancelled", "That event was cancelled.")
    if event.starts_at <= now:
        raise EventRefused(
            "started",
            "That event has already started — publishing it would tell everybody too late.",
        )

    claimed = Event.objects.filter(pk=event.pk, status=Event.STATUS_DRAFT).update(
        status=Event.STATUS_PUBLISHED, published_at=now, updated_at=now
    )
    if not claimed:
        return False
    event.status = Event.STATUS_PUBLISHED
    event.published_at = now
    return True


def update_event(event: Event, fields: dict, *, now=None):
    """Edit an event. Returns ``(event, moved)`` — `moved` when the time or place changed."""
    now = now or timezone.now()
    if event.status == Event.STATUS_CANCELLED:
        raise EventRefused("cancelled", "That event was cancelled, so it cannot be edited.")

    starts_at = fields.get("starts_at", event.starts_at)
    ends_at = fields.get("ends_at", event.ends_at)
    if ends_at <= starts_at:
        raise EventRefused("ends_before_start", "The event would end before it started.")

    if "seats" in fields:
        seats = int(fields["seats"])
        taken = event.registered_count
        if seats < taken:
            raise EventRefused(
                "seats_below_registered",
                f"{taken} student{'' if taken == 1 else 's'} already hold a seat, so there "
                f"cannot be fewer than {taken}.",
            )

    moved = any(
        field in fields and fields[field] != getattr(event, field) for field in MOVE_FIELDS
    )
    start_moved = "starts_at" in fields and fields["starts_at"] != event.starts_at

    for field, value in fields.items():
        setattr(event, field, value)

    if start_moved:
        # Far enough away to be worth a reminder of its own → re-arm the sweep. Inside the
        # lead time → the change message has just told them, so count it as the reminder
        # rather than following it with a second message minutes later.
        event.reminder_sent_at = None if event.starts_at - REMINDER_LEAD > now else now

    event.save()
    return event, moved


def cancel_event(event: Event, *, actor=None, now=None) -> Event:
    """Call it off, before it starts, and close every seat with it."""
    now = now or timezone.now()
    if event.status == Event.STATUS_CANCELLED:
        return event
    if event.status != Event.STATUS_PUBLISHED:
        raise EventRefused("not_open", "Only a published event can be cancelled.")
    if event.starts_at <= now:
        # Attendance may already have paid, and there is no honest way to unwind that here.
        raise EventRefused("started", "That event has already started, so it cannot be called off.")

    with transaction.atomic():
        event.status = Event.STATUS_CANCELLED
        event.cancelled_at = now
        event.save(update_fields=["status", "cancelled_at", "updated_at"])
        EventRegistration.objects.filter(
            event=event, status=EventRegistration.STATUS_REGISTERED
        ).update(
            status=EventRegistration.STATUS_CANCELLED,
            cancel_reason=EventRegistration.REASON_EVENT_CANCELLED,
            cancelled_at=now,
        )
    logger.info("event_cancelled event=%s actor=%s", event.pk, getattr(actor, "pk", None))
    return event


def delete_draft(event: Event) -> None:
    """A draft nobody has seen is deleted; anything published is cancelled instead."""
    if event.status != Event.STATUS_DRAFT:
        raise EventRefused(
            "not_a_draft", "This event has been published — cancel it instead of deleting it."
        )
    event.delete()


def marking_opens_at(event: Event):
    """When ops may start marking arrivals: the moment the cancel window closes.

    The door opens before the event does, and a student standing at it has already lost the
    right to give the seat up — so the two moments are deliberately the same one.
    """
    return event.starts_at - CANCEL_CUTOFF


def mark_attendance(registration: EventRegistration, value, *, actor=None, now=None):
    """Record that a student came, or did not, and settle the reward either way."""
    from rewards import constants as reward_const
    from rewards.services import award, revoke

    now = now or timezone.now()
    allowed = (None, EventRegistration.ATTENDANCE_ATTENDED, EventRegistration.ATTENDANCE_MISSED)
    if value not in allowed:
        raise EventRefused("bad_value", "Mark a student as Attended or Missed.")

    event = registration.event
    if event.status != Event.STATUS_PUBLISHED:
        raise EventRefused("not_open", "That event isn't running.")
    if registration.status != EventRegistration.STATUS_REGISTERED:
        raise EventRefused("not_registered", "That student gave their seat back.")
    if now < marking_opens_at(event):
        opens = timezone.localtime(marking_opens_at(event)).strftime("%H:%M")
        raise EventRefused("too_early", f"You can mark arrivals from {opens}.")

    registration.attendance = value
    registration.marked_by = actor
    registration.marked_at = now
    registration.save(update_fields=["attendance", "marked_by", "marked_at", "updated_at"])

    key = reward_const.event_attendance_key(registration.pk)
    if value == EventRegistration.ATTENDANCE_ATTENDED:
        award(
            registration.student,
            reward_const.EVENT_ATTENDED,
            idempotency_key=key,
            # No classroom: an event is not a lesson, so the points count towards the
            # student's balance and the global board, never a class board.
            classroom=None,
            source_type="event_registration",
            source_id=registration.pk,
            actor=actor,
            reason=f"attended “{event.title}”"[:240],
        )
    else:
        revoke(key, reason="event attendance withdrawn", actor=actor)
    return registration


def active_students():
    """Every student who could act on an event: active, unfrozen, role student."""
    from django.contrib.auth import get_user_model

    users = get_user_model().objects.filter(is_active=True)
    return [u for u in users if is_signupable_student(u)]


def registered_students(event: Event):
    """The students holding a seat right now, skipping the frozen and the deactivated."""
    rows = EventRegistration.objects.filter(
        event=event, status=EventRegistration.STATUS_REGISTERED
    ).select_related("student")
    return [r.student for r in rows if is_signupable_student(r.student)]


def publish_and_announce(event: Event, *, now=None) -> bool:
    """Publish, and tell every active student — once. The entry point the API calls."""
    from . import notifications as event_notifications

    if not publish(event, now=now):
        return False
    event_notifications.announce_published(event, active_students())
    return True


def update_and_announce(event: Event, fields: dict, *, now=None):
    """Edit, and tell the students holding a seat when the time or place moved."""
    from . import notifications as event_notifications

    event, moved = update_event(event, fields, now=now)
    if moved and event.status == Event.STATUS_PUBLISHED:
        event_notifications.announce_changed(event, registered_students(event))
    return event, moved


def cancel_and_announce(event: Event, *, actor=None, now=None) -> Event:
    """Call it off, and tell the students who had a seat.

    The recipients are read BEFORE the seats are closed — afterwards there are none, and the
    message would reach nobody at all.
    """
    from . import notifications as event_notifications

    told = registered_students(event)
    event = cancel_event(event, actor=actor, now=now)
    event_notifications.announce_cancelled(event, told)
    return event
