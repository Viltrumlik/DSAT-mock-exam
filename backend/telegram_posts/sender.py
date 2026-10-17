"""Sending: claim a run, open one row per group, send each with retries — and the sweep.

The run's claim is a conditional UPDATE on ``GroupPost.last_run_on`` (the events reminder's
pattern), so two overlapping beats, or a beat and a "send now", open a run once between them.
Each row is then claimed PENDING → SENDING before its message goes, so a retry racing the sweep
cannot send one group the same post twice. A row found still SENDING long after is marked
Failed, never re-sent: the message may well have arrived, and only a person can look.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import time
from datetime import date, timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from classes import telegram_group_api as api

from . import audience, render, schedule
from .models import GroupPost, GroupPostDelivery

logger = logging.getLogger("telegram_posts")

MAX_TRIES = 3
#: Telegram's 429 says how long to wait; past this it is better to fail the row and let a
#: person press Retry than to hold a worker for minutes.
RETRY_AFTER_CAP = 30
INTERRUPTED_AFTER = timedelta(minutes=10)
INTERRUPTED = "Interrupted while sending — it may or may not have arrived. Check the group before retrying."
LATE = "More than an hour late — not sent on its own."

_sleep = time.sleep  # tests replace it


def enabled() -> bool:
    return bool(getattr(settings, "TELEGRAM_GROUP_POSTS_ENABLED", False)) and api.is_configured()


def claim_run(post, due) -> bool:
    claimed = (
        GroupPost.objects.filter(pk=post.pk)
        .filter(Q(last_run_on__isnull=True) | Q(last_run_on__lt=due.run_on))
        .update(last_run_on=due.run_on)
    )
    if claimed:
        post.last_run_on = due.run_on
    return bool(claimed)


def open_run(post, due) -> int:
    """One row per target group for a claimed run. A late run's rows are born Missed."""
    status = GroupPostDelivery.STATUS_MISSED if due.late else GroupPostDelivery.STATUS_PENDING
    made = 0
    for target in audience.for_post(post):
        _row, created = GroupPostDelivery.objects.get_or_create(
            post=post, run_on=due.run_on, chat_id=target.chat_id,
            defaults={"group_names": target.names, "status": status, "error": LATE if due.late else ""},
        )
        made += int(created)
    return made


def send_pending(post, run_on: date) -> dict:
    stats = {"sent": 0, "failed": 0, "skipped": 0}
    rows = list(
        GroupPostDelivery.objects.filter(
            post=post, run_on=run_on, status=GroupPostDelivery.STATUS_PENDING
        ).order_by("id")
    )
    if not rows:
        return stats
    rendered = render.render(post)
    if rendered is None:
        # The event behind it stopped being published after the run opened.
        GroupPostDelivery.objects.filter(
            pk__in=[r.pk for r in rows], status=GroupPostDelivery.STATUS_PENDING
        ).update(
            status=GroupPostDelivery.STATUS_MISSED,
            error="Nothing to send: the event is no longer published.",
            updated_at=timezone.now(),
        )
        stats["skipped"] = len(rows)
        return stats

    markup = _markup(rendered)
    for row in rows:
        took = GroupPostDelivery.objects.filter(
            pk=row.pk, status=GroupPostDelivery.STATUS_PENDING
        ).update(status=GroupPostDelivery.STATUS_SENDING, updated_at=timezone.now())
        if not took:
            continue
        result, tries = _deliver(post, rendered, markup, row.chat_id)
        if result.ok:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_SENT, message_id=_message_id(result),
                attempts=tries, sent_at=timezone.now(), error="", updated_at=timezone.now(),
            )
            stats["sent"] += 1
        else:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_FAILED, attempts=tries, error=_reason(result),
                updated_at=timezone.now(),
            )
            stats["failed"] += 1
    return stats


def _markup(rendered):
    if not rendered.button:
        return None
    label, url = rendered.button
    return {"inline_keyboard": [[{"text": label, "url": url}]]}


def _deliver(post, rendered, markup, chat_id):
    result = None
    for attempt in range(1, MAX_TRIES + 1):
        result = _send_once(post, rendered, markup, chat_id)
        if result.ok or not _worth_retrying(result) or attempt == MAX_TRIES:
            return result, attempt
        _sleep(min(result.retry_after or attempt, RETRY_AFTER_CAP))
    return result, MAX_TRIES


def _worth_retrying(result) -> bool:
    """A 429, a 5xx, or no answer at all. A 400/403 will say the same thing next time."""
    code = result.error_code
    return code is None or code == 429 or code >= 500


def _send_once(post, rendered, markup, chat_id):
    if rendered.image is None:
        return api.send_message(chat_id, rendered.text, reply_markup=markup)
    if post.image_file_id:
        return api.send_photo(
            chat_id, caption=rendered.text, file_id=post.image_file_id, reply_markup=markup
        )
    data, name, content_type = _image_bytes(rendered.image)
    if not data:
        return api.TgResult(False, error_code=400, description="The picture could not be read from storage.")
    result = api.send_photo(
        chat_id, caption=rendered.text, photo=data, filename=name,
        content_type=content_type, reply_markup=markup,
    )
    if result.ok:
        file_id = api.largest_photo_file_id(result.result)
        if file_id:
            GroupPost.objects.filter(pk=post.pk).update(image_file_id=file_id)
            post.image_file_id = file_id
    return result


def _image_bytes(field) -> tuple[bytes, str, str]:
    try:
        field.open("rb")
        try:
            data = field.read()
        finally:
            field.close()
    except Exception:
        logger.exception("telegram post picture unreadable: %s", getattr(field, "name", ""))
        return b"", "", ""
    name = os.path.basename(field.name or "") or "photo.jpg"
    return data, name, mimetypes.guess_type(name)[0] or "image/jpeg"


def _message_id(result):
    try:
        return int((result.result or {}).get("message_id"))
    except (TypeError, ValueError, AttributeError):
        return None


def _reason(result) -> str:
    prefix = "The bot is not in this group any more, or may not post. " if result.error_code == 403 else ""
    code = f"{result.error_code}: " if result.error_code else ""
    return (prefix + code + (result.description or "Telegram did not answer."))[:400]


def _fail_interrupted(now) -> int:
    return GroupPostDelivery.objects.filter(
        status=GroupPostDelivery.STATUS_SENDING, updated_at__lt=now - INTERRUPTED_AFTER
    ).update(status=GroupPostDelivery.STATUS_FAILED, error=INTERRUPTED, updated_at=now)


def sweep(*, now=None) -> dict:
    stats = {"runs": 0, "sent": 0, "failed": 0, "missed": 0}
    if not enabled():
        return stats
    now = now or timezone.now()
    _fail_interrupted(now)
    posts = (
        GroupPost.objects.filter(deleted_at__isnull=True, is_paused=False)
        # A once/now post that has run is finished; only repeating posts stay in the scan.
        .filter(Q(when__in=[GroupPost.WHEN_WEEKLY, GroupPost.WHEN_EVENT]) | Q(last_run_on__isnull=True))
        .select_related("event")
    )
    for post in posts:
        due = schedule.due(post, now)
        if due is None or not claim_run(post, due):
            continue
        stats["runs"] += 1
        open_run(post, due)
        if due.late:
            stats["missed"] += post.deliveries.filter(
                run_on=due.run_on, status=GroupPostDelivery.STATUS_MISSED
            ).count()
            continue
        result = send_pending(post, due.run_on)
        stats["sent"] += result["sent"]
        stats["failed"] += result["failed"]
    if stats["runs"]:
        logger.info("telegram_posts sweep %s", stats)
    return stats


def send_post_now(post_id: int) -> dict:
    """A "Now" post or an event's announcement, dispatched on commit: nobody waits a minute."""
    if not enabled():
        return {}
    post = GroupPost.objects.select_related("event").filter(pk=post_id).first()
    if post is None:
        return {}
    due = schedule.due(post, timezone.now())
    if due is None or not claim_run(post, due):
        return {}
    open_run(post, due)
    return {} if due.late else send_pending(post, due.run_on)
