"""The bell and the push for an event. One function per message.

Separate from `mail` because the two legs are not the same promise: the bell is written
synchronously, reaches students with no mailbox, and is not gated on EMAIL_SENDING_ENABLED —
the same split `classes/mail_homework.py` documents.
"""

from __future__ import annotations

from django.utils import timezone

from notifications import constants as note_const
from notifications.services import notify_many

#: Where every one of these lands. An event has no page of its own.
LINK = "/events"


def _when(event) -> str:
    """"Wed 18 Sep, 15:00" — the two facts a student plans around."""
    local = timezone.localtime(event.starts_at)
    return local.strftime("%a %d %b, %H:%M").replace(" 0", " ")


def _where(event) -> str:
    place = (event.location or "").strip()
    return f" · {place}" if place else ""


def announce_published(event, students) -> int:
    return notify_many(
        students,
        event=note_const.EVENT_EVENT_PUBLISHED,
        title=f"New event: {event.title}"[:160],
        body=f"{_when(event)}{_where(event)}. Sign up while there are seats."[:400],
        link_url=LINK,
        # One event is one piece of news; a re-publish cannot broadcast twice.
        dedupe_key=f"event-published:{event.pk}",
    )


def announce_changed(event, students) -> int:
    return notify_many(
        students,
        event=note_const.EVENT_EVENT_CHANGED,
        title=f"Changed: {event.title}"[:160],
        body=f"Now {_when(event)}{_where(event)}."[:400],
        link_url=LINK,
        # Keyed on the edit, so a second change is a second message.
        dedupe_key=f"event-changed:{event.pk}:{event.updated_at.isoformat()}",
    )


def announce_cancelled(event, students) -> int:
    return notify_many(
        students,
        event=note_const.EVENT_EVENT_CANCELLED,
        title=f"Cancelled: {event.title}"[:160],
        body=f"The event on {_when(event)} is off. Your seat has been closed."[:400],
        link_url=LINK,
        dedupe_key=f"event-cancelled:{event.pk}",
    )


def announce_reminder(event, students) -> int:
    return notify_many(
        students,
        event=note_const.EVENT_EVENT_REMINDER,
        title=f"Tomorrow: {event.title}"[:160],
        body=f"{_when(event)}{_where(event)}."[:400],
        link_url=LINK,
        # The start is in the key, so a reminder re-armed by a moved start is not swallowed
        # by the first one's.
        dedupe_key=f"event-reminder:{event.pk}:{event.starts_at.isoformat()}",
    )
