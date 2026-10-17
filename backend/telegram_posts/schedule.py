"""When a post goes out. Pure functions of the post, its event and `now` — no queries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional

from django.utils import timezone

from events.models import Event

from .models import GroupPost

#: A run further behind than this (the server was down) is recorded Missed and never sent on
#: its own: "tomorrow's mock" at 23:00 is worse than no message.
LATE_LIMIT = timedelta(minutes=60)
#: The event reminder goes out at this Tashkent wall-clock time, the day before the start.
REMINDER_TIME = time(18, 0)


@dataclass(frozen=True)
class Due:
    run_on: date
    scheduled_at: datetime
    late: bool


def _at(day: date, at: time) -> datetime:
    return timezone.make_aware(datetime.combine(day, at))


def reminder_at(event) -> datetime:
    return _at(timezone.localtime(event.starts_at).date() - timedelta(days=1), REMINDER_TIME)


def _live_event(post, now) -> Optional[Event]:
    event = post.event
    if event is None or event.status != Event.STATUS_PUBLISHED or event.starts_at <= now:
        return None
    return event


def _moment(post, now) -> Optional[datetime]:
    """The one scheduled moment that could be due at `now`."""
    if post.when in (GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE):
        return post.send_at
    if post.when == GroupPost.WHEN_WEEKLY:
        today = timezone.localtime(now).date()
        if post.time_of_day is None or today.weekday() not in (post.weekdays or []):
            return None
        return _at(today, post.time_of_day)
    if post.when == GroupPost.WHEN_EVENT:
        event = _live_event(post, now)
        return reminder_at(event) if event else None
    return None


def due(post, now) -> Optional[Due]:
    if post.deleted_at or post.is_paused:
        return None
    moment = _moment(post, now)
    if moment is None or moment > now or moment < post.active_from:
        return None
    run_on = timezone.localtime(moment).date()
    if post.last_run_on and post.last_run_on >= run_on:
        return None
    return Due(run_on=run_on, scheduled_at=moment, late=now - moment > LATE_LIMIT)


def next_at(post, now) -> Optional[datetime]:
    """When it next goes out, for the console. None when nothing more is scheduled."""
    if post.deleted_at or post.is_paused:
        return None
    if post.when in (GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE):
        return post.send_at if post.last_run_on is None else None
    if post.when == GroupPost.WHEN_WEEKLY:
        if post.time_of_day is None or not post.weekdays:
            return None
        today = timezone.localtime(now).date()
        for offset in range(8):
            day = today + timedelta(days=offset)
            if day.weekday() not in post.weekdays:
                continue
            moment = _at(day, post.time_of_day)
            if moment < post.active_from or (post.last_run_on and post.last_run_on >= day):
                continue
            if now - moment > LATE_LIMIT:
                continue
            return moment
        return None
    if post.when == GroupPost.WHEN_EVENT:
        event = _live_event(post, now)
        if event is None:
            return None
        moment = reminder_at(event)
        if moment < post.active_from or now - moment > LATE_LIMIT:
            return None
        if post.last_run_on and post.last_run_on >= timezone.localtime(moment).date():
            return None
        return moment
    return None
