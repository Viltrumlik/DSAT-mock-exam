"""What a post says when it is sent: text (HTML), picture, button.

Built at send time, never stored, so an event's reminder carries the event as it is that
evening — its current time, place and seats — not as it was when it was published.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any, Optional

from django.conf import settings
from django.utils import timezone

from classes.telegram_group_api import esc
from events.models import Event

from . import texts as T
from .models import GroupPost

#: Telegram's limits, in characters as the reader sees them (entities parsed).
CAPTION_MAX = 1024
TEXT_MAX = 4096


@dataclass(frozen=True)
class Rendered:
    text: str
    #: A FieldFile, or None for a text message.
    image: Any = None
    button: Optional[tuple[str, str]] = None


def when_uz(starts_at, ends_at=None) -> str:
    """"Shanba, 25-oktabr, 12:30–14:00" in Tashkent time."""
    start = timezone.localtime(starts_at)
    out = f"{T.WEEKDAYS[start.weekday()]}, {start.day}-{T.MONTHS[start.month - 1]}, {start:%H:%M}"
    if ends_at:
        end = timezone.localtime(ends_at)
        if end.date() == start.date():
            out += f"–{end:%H:%M}"
        else:
            out += f" – {end.day}-{T.MONTHS[end.month - 1]}, {end:%H:%M}"
    return out


def visible_len(markup: str) -> int:
    """How long Telegram counts this: tags dropped, entities as one character each."""
    return len(html.unescape(re.sub(r"<[^>]+>", "", markup)))


def _fit(head: str, body: str, limit: int) -> str:
    """``head + esc(body)``, with `body` cut so the whole fits `limit`.

    The cut is made on the RAW text, before escaping: cutting the escaped text could split
    "&amp;" into "&am", and Telegram rejects the whole message over one broken entity.
    """
    whole = head + esc(body)
    if visible_len(whole) <= limit:
        return whole
    budget = limit - visible_len(head) - visible_len(T.MORE_ON_SITE)
    return head + esc(body[: max(0, budget)].rstrip()) + T.MORE_ON_SITE


def events_url() -> str:
    site = str(getattr(settings, "EMAIL_SITE_URL", "https://mastersat.uz")).rstrip("/")
    return f"{site}/events"


def _when_and_place(event) -> list[str]:
    lines = [T.WHEN_LINE.format(when=when_uz(event.starts_at, event.ends_at))]
    if event.location:
        lines.append(T.PLACE_LINE.format(place=esc(event.location)))
    return lines


def event_announcement(event) -> Rendered:
    image = event.cover_image if event.cover_image else None
    head = "\n".join(
        [T.ANNOUNCE_HEAD.format(title=esc(event.title)), ""]
        + _when_and_place(event)
        + [T.SEATS_LINE.format(seats=event.seats)]
    )
    description = (event.description or "").strip()
    limit = CAPTION_MAX if image else TEXT_MAX
    text = _fit(head + "\n\n", description, limit) if description else head
    return Rendered(text=text, image=image, button=(T.SIGN_UP_BUTTON, events_url()))


def event_reminder(event) -> Optional[Rendered]:
    if event.status != Event.STATUS_PUBLISHED:
        return None
    left = event.seats_left
    lines = [T.REMINDER_HEAD.format(title=esc(event.title)), ""] + _when_and_place(event)
    lines.append(T.SEATS_LEFT.format(n=left) if left > 0 else T.SEATS_FULL)
    # A full event's button would open a page that says "full": the line says it already.
    button = (T.SIGN_UP_BUTTON, events_url()) if left > 0 else None
    return Rendered(text="\n".join(lines), button=button)


def manual(post) -> Rendered:
    image = post.image if post.image else None
    text = _fit("", (post.text or "").strip(), CAPTION_MAX if image else TEXT_MAX)
    button = (post.button_text, post.button_url) if post.button_text and post.button_url else None
    return Rendered(text=text, image=image, button=button)


def render(post) -> Optional[Rendered]:
    """None means there is nothing true left to say (the event behind it is not published)."""
    if post.kind == GroupPost.KIND_EVENT_ANNOUNCE:
        event = post.event if post.event_id else None
        if event is None or event.status != Event.STATUS_PUBLISHED:
            return None
        return event_announcement(event)
    if post.kind == GroupPost.KIND_EVENT_REMINDER:
        return event_reminder(post.event) if post.event_id else None
    return manual(post)
