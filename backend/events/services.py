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
