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

**Two entry points, one for each shape of caller.** ``notify`` is for a hook that knows one
recipient — a grade, a reply, an order. ``notify_many`` is for a fan-out that knows a group —
a class announcement, a due-soon sweep, a whole-school broadcast — and it is *not* a loop over
``notify``. It used to be, and a 200-student announcement therefore cost roughly six hundred
queries inside a request thread: a ``get_or_create`` on preferences, a dedupe ``SELECT``, an
``INSERT``, a realtime row and a Celery publish, per student. Everything ``notify_many`` does
is now set-shaped — one preferences query, one dedupe query, one ``bulk_create``, one realtime
emit, one push task — while ``notify`` keeps the simple per-row path it always had.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Callable

from django.db import transaction
from django.utils import timezone

from . import constants
from .models import Notification, NotificationPreference, PushSubscription

logger = logging.getLogger(__name__)

#: How long a `dedupe_key` collapses repeats for. A re-grade three days later is news again.
DEDUPE_WINDOW_MINUTES = 60

#: Rows per ``bulk_create`` batch in the fan-out. Bounds the size of a single INSERT statement
#: on a whole-school broadcast without making the round trips per-row again.
FANOUT_BATCH_SIZE = 500


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
                    # DELIBERATELY no `queue_push` on this path, and it is not an oversight.
                    #
                    # A collapsed repeat is the same fact told again — four items in one
                    # bundle each firing a grade write, a teacher re-saving a mark twice. The
                    # bell is a list the student scans, so refreshing a row there is cheap and
                    # the newest wording is worth having. A push is an interruption: it lights
                    # a lock screen and makes a phone buzz in a lesson. Buzzing three times for
                    # one piece of news is precisely what teaches a 15-year-old to turn push
                    # off — after which the notification that actually mattered never arrives
                    # either. Suppressing the repeat buzz IS the point of `dedupe_key`; only
                    # the first telling of a fact is allowed to interrupt.
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


def notify_many(
    users,
    *,
    event: str,
    title: str,
    body: str = "",
    link_url: str = "",
    dedupe_key: str | Callable = "",
    push: bool | None = None,
) -> int:
    """Notify a group in a fixed number of queries. Returns how many were actually written.

    Set-shaped on purpose — see the module docstring for the N+1 this replaced. The cost of a
    fan-out is now roughly constant in the number of recipients rather than linear in it:

    * **one** preferences query for the whole group,
    * **one** dedupe query for the whole group,
    * **one** ``bulk_create``,
    * **one** realtime emit (``emit_to_users`` already batches its own writes),
    * **one** Celery task for the entire push fan-out, not one per student.

    ``dedupe_key`` may be a plain string — every recipient shares it — or a callable taking the
    user and returning that recipient's key. The callable form is what lets a per-student key
    like ``f"due:{assignment_id}:{student_id}"`` still ride the bulk path instead of forcing
    the caller back into a loop over :func:`notify`.

    **A missing preferences row is not created here.** ``NotificationPreference``'s own
    docstring says absence means everything is on, so a broadcast to two thousand students
    would otherwise write two thousand rows recording the default — pure cost, and it would
    silently freeze today's default for anyone who has never touched the screen.
    """
    # De-duplicate the recipient list itself. A student in two of the classrooms an
    # announcement targets is one person, and a caller assembling a list from several
    # querysets has no cheap way to know that.
    by_id: dict[int, object] = {}
    for user in users or ():
        pk = getattr(user, "pk", None)
        if pk and pk not in by_id:
            by_id[pk] = user
    if not by_id or not event or not title:
        return 0

    try:
        category = constants.category_for(event)
        keys = {
            uid: (str(dedupe_key(user)) if callable(dedupe_key) else str(dedupe_key or ""))
            for uid, user in by_id.items()
        }

        # 1) Preferences — one query. Muting removes a recipient entirely; push_enabled only
        #    removes them from the buzz, so the two are tracked separately.
        muted_ids: set[int] = set()
        push_off_ids: set[int] = set()
        # `.only("user", ...)` loads the `user_id` column without fetching the User rows —
        # a fan-out already holds the user objects and has no use for a second copy.
        for pref in NotificationPreference.objects.filter(user_id__in=list(by_id)).only(
            "user", "muted_categories", "push_enabled"
        ):
            if pref.is_muted(category):
                muted_ids.add(pref.user_id)
            elif not pref.push_enabled:
                push_off_ids.add(pref.user_id)

        wanted = [uid for uid in by_id if uid not in muted_ids]
        if not wanted:
            return 0

        refreshed_ids: set[int] = set()
        created: list[Notification] = []
        with transaction.atomic():
            # 2) Dedupe — one query for the whole group. The `dedupe_key__in` is a coarse
            #    filter: it can match a row whose recipient/key pairing is not one of ours, so
            #    the pairs are re-checked in Python rather than trusting the cross product.
            keyed = [uid for uid in wanted if keys.get(uid)]
            if keyed:
                since = timezone.now() - timedelta(minutes=DEDUPE_WINDOW_MINUTES)
                existing = list(
                    Notification.objects.filter(
                        recipient_id__in=keyed,
                        dedupe_key__in={keys[uid] for uid in keyed},
                        created_at__gte=since,
                    ).values("pk", "recipient_id", "dedupe_key")
                )
                hits = [
                    row for row in existing
                    if keys.get(row["recipient_id"]) == row["dedupe_key"]
                ]
                if hits:
                    Notification.objects.filter(pk__in=[row["pk"] for row in hits]).update(
                        title=title, body=body, link_url=link_url,
                        read_at=None, created_at=timezone.now(),
                    )
                    refreshed_ids = {row["recipient_id"] for row in hits}

            # 3) The new rows — one INSERT per batch. Same "a repeat does not buzz" rule as
            #    the single-recipient path: only `created` is ever considered for push.
            fresh = [uid for uid in wanted if uid not in refreshed_ids]
            if fresh:
                created = Notification.objects.bulk_create(
                    [
                        Notification(
                            recipient_id=uid, category=category, event=event,
                            title=title, body=body, link_url=link_url,
                            dedupe_key=keys.get(uid, ""),
                        )
                        for uid in fresh
                    ],
                    batch_size=FANOUT_BATCH_SIZE,
                )

        # Every wanted recipient was either refreshed or created, so `wanted` is the set that
        # now has something new at the top of their inbox and needs their open tab told.
        _hint_many(wanted)

        should_push = push if push is not None else event in constants.PUSH_EVENTS
        if should_push:
            queue_push_many([
                n.pk for n in created if n.pk and n.recipient_id not in push_off_ids
            ])
        return len(wanted)
    except Exception:
        logger.exception("notify_many_failed event=%s recipients=%s", event, len(by_id))
        return 0


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


def _hint_many(user_ids) -> None:
    """The group form of :func:`_hint`. One call, not one per student.

    ``emit_to_users`` already normalises and bulk-inserts the whole batch, so a fan-out costs
    the realtime bus one round trip rather than N.
    """
    ids = list(user_ids or ())
    if not ids:
        return
    try:
        from realtime.services import emit_to_users

        emit_to_users(
            user_ids=ids,
            event_type="notifications.updated",
            payload={"reason": "created"},
        )
    except Exception:
        logger.warning("notification_hint_many_failed n=%s", len(ids))


def queue_push(notification: Notification) -> None:
    """Hand the fan-out to Celery, **after the caller's transaction commits**.

    Two separate reasons this is shaped the way it is.

    **Never sent inline.** Gunicorn runs three *sync* workers, so N sequential HTTPS requests
    to a push service inside a request handler is the same worker-starvation problem that keeps
    SSE capped at 25 seconds per connection in this codebase. If Celery is not configured the
    send is skipped rather than attempted — an unqueued push is a missed buzz; an inline one is
    an outage.

    **Never published before commit.** ``.delay()`` puts the id on the broker the instant it is
    called, and a Celery worker is a *different process with its own database connection*. The
    hooks that call ``notify`` almost all run inside a ``transaction.atomic()`` the view still
    holds — grading, submitting, the shop — so at the moment ``.delay()`` returns, the row the
    task is being asked to read is still invisible outside this connection, and on a rollback
    it never exists at all. The worker then wins the race often enough to matter: it reads
    ``Notification.objects.filter(pk=...)``, finds nothing, and returns ``{"skipped": "gone"}``
    for a notification that is about to be perfectly real. The student's phone simply never
    buzzes, with nothing in any log that looks like a failure.

    ``transaction.on_commit`` closes it. Outside a transaction it runs the callback
    immediately, so the un-nested callers are unaffected; inside one it defers the publish
    until after ``COMMIT``, and a rollback drops the callback along with the row — which is the
    behaviour you want anyway, since there is then nothing to push about.
    """
    try:
        from .tasks import send_push_for_notification

        notification_id = notification.pk
        transaction.on_commit(lambda: send_push_for_notification.delay(notification_id))
    except Exception:
        logger.warning("push_enqueue_failed notification=%s", notification.pk)


def queue_push_many(notification_ids) -> None:
    """Queue the push fan-out for a whole group as **one** task.

    The loop this replaced published one Celery message per student, so a 200-student
    announcement put 200 messages on the broker to do 200 near-identical jobs. One task holding
    the whole list lets the worker load the subscriptions in a single query and spend its time
    on the HTTPS calls, which are the only part that actually has to be per-device.

    Deferred to ``on_commit`` for exactly the reason :func:`queue_push` explains — and it
    matters more here, because a fan-out is written with ``bulk_create`` inside the caller's
    transaction and *every* id in the list would be invisible to the worker, not just one.
    """
    ids = [int(pk) for pk in (notification_ids or ()) if pk]
    if not ids:
        return
    try:
        from .tasks import send_push_for_notifications

        transaction.on_commit(lambda: send_push_for_notifications.delay(ids))
    except Exception:
        logger.warning("push_enqueue_many_failed n=%s", len(ids))


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
