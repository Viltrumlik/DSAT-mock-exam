"""The one supported way to notify somebody.

Every caller is a hook or a view somewhere else in the codebase, so the same two rules the
reward service lives by apply here, for the same reasons:

1. **Notifying must never raise into the caller.** Nobody's grade should fail to save because
   a bell failed to ring.
2. **A failure must not poison the caller's transaction.** The write runs inside its own
   ``transaction.atomic()`` — a savepoint when nested — with the ``except`` outside it, so
   Postgres rolls the savepoint back cleanly instead of leaving the outer transaction
   unusable.

Delivery is three things in a fixed order, and only the first is guaranteed: the row is
written, an open tab is hinted at over the realtime bus, and a push is queued for the devices
that asked for one. A student who is looking at the page gets it instantly; a student who is
not gets it on their phone; a student with neither finds it in the bell later.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import constants
from .models import Notification, NotificationPreference, PushSubscription

logger = logging.getLogger(__name__)

#: How long a `dedupe_key` collapses repeats for. A re-grade three days later is news again.
DEDUPE_WINDOW_MINUTES = 60


def _prefs(user) -> NotificationPreference:
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def notify(
    user,
    *,
    event: str,
    title: str,
    body: str = "",
    link_url: str = "",
    dedupe_key: str = "",
    push: bool | None = None,
) -> Notification | None:
    """Tell one person one thing. Returns the row, or ``None`` if nothing was written.

    ``None`` is an ordinary outcome, not an error: the student muted the category, or an
    identical notification arrived a minute ago.
    """
    if user is None or not event or not title:
        return None
    try:
        category = constants.category_for(event)
        with transaction.atomic():
            prefs = _prefs(user)
            if prefs.is_muted(category):
                return None

            if dedupe_key:
                since = timezone.now() - timedelta(minutes=DEDUPE_WINDOW_MINUTES)
                existing = Notification.objects.filter(
                    recipient=user, dedupe_key=dedupe_key, created_at__gte=since
                ).first()
                if existing is not None:
                    # Refresh it rather than adding a second row: the newest wording wins and
                    # it returns to the top of the inbox, but the student is not told twice.
                    Notification.objects.filter(pk=existing.pk).update(
                        title=title, body=body, link_url=link_url,
                        read_at=None, created_at=timezone.now(),
                    )
                    existing.refresh_from_db()
                    _hint(user)
                    return existing

            notification = Notification.objects.create(
                recipient=user, category=category, event=event,
                title=title, body=body, link_url=link_url, dedupe_key=dedupe_key,
            )

        # Outside the atomic block: neither of these is part of the write, and a Redis blip
        # must not roll back a notification that has already been stored.
        _hint(user)
        should_push = push if push is not None else event in constants.PUSH_EVENTS
        if should_push and prefs.push_enabled:
            queue_push(notification)
        return notification
    except Exception:
        logger.exception("notify_failed event=%s user=%s", event, getattr(user, "id", None))
        return None


def notify_many(users, **kwargs) -> int:
    """Notify a group. Returns how many were actually written.

    A plain loop rather than a bulk insert: each recipient has their own preferences and their
    own dedupe window, and a bulk path would have to re-implement both.
    """
    written = 0
    for user in users:
        if notify(user, **kwargs) is not None:
            written += 1
    return written


def _hint(user) -> None:
    """Tell an open tab to refetch. Best-effort by design — the row is already saved.

    `notifications.updated` is not a new event name: `realtime.services` already maps it to
    `refresh: ["notifications"]` and the browser client already listens for it.
    """
    try:
        from realtime.services import emit_to_user

        emit_to_user(
            user_id=user.pk,
            event_type="notifications.updated",
            payload={"reason": "created"},
        )
    except Exception:
        logger.warning("notification_hint_failed user=%s", getattr(user, "id", None))


def queue_push(notification: Notification) -> None:
    """Hand the fan-out to Celery.

    Never sent inline. Gunicorn runs three *sync* workers, so N sequential HTTPS requests to a
    push service inside a request handler is the same worker-starvation problem that keeps SSE
    capped at 25 seconds per connection in this codebase. If Celery is not configured the send
    is skipped rather than attempted — an unqueued push is a missed buzz; an inline one is an
    outage.
    """
    try:
        from .tasks import send_push_for_notification

        send_push_for_notification.delay(notification.pk)
    except Exception:
        logger.warning("push_enqueue_failed notification=%s", notification.pk)


# ── Reading ───────────────────────────────────────────────────────────────────

def unread_summary(user) -> dict:
    """``{"total": n, "by_category": {...}}`` — what the bell badge needs."""
    from django.db.models import Count

    rows = (
        Notification.objects.filter(recipient=user, read_at__isnull=True)
        .values("category")
        .annotate(n=Count("id"))
    )
    by_category = {row["category"]: row["n"] for row in rows}
    return {"total": sum(by_category.values()), "by_category": by_category}


def mark_read(user, ids=None, *, category=None) -> int:
    """Mark some or all of a person's notifications read. Returns how many moved.

    Always scoped to ``recipient=user``, so an id belonging to somebody else silently matches
    nothing rather than needing a separate ownership check that could be forgotten.
    """
    qs = Notification.objects.filter(recipient=user, read_at__isnull=True)
    if ids:
        qs = qs.filter(pk__in=ids)
    if category:
        qs = qs.filter(category=category)
    moved = qs.update(read_at=timezone.now())
    if moved:
        _hint(user)
    return moved


def prune_failed_subscriptions(older_than_days: int = 30) -> int:
    """Delete push subscriptions that have been failing for a while."""
    cutoff = timezone.now() - timedelta(days=older_than_days)
    deleted, _ = PushSubscription.objects.filter(failed_at__lt=cutoff).delete()
    return deleted
