"""Sending: claim a run, open one row per group, send each with retries — and the sweep.

The run's claim is a conditional UPDATE on ``GroupPost.last_run_on`` (the events reminder's
pattern), so two overlapping beats, or a beat and a "send now", open a run once between them.
Each row is then claimed PENDING → SENDING before its message goes, so a retry racing the sweep
cannot send one group the same post twice. A row found still SENDING long after is marked
Failed, never re-sent: the message may well have arrived, and only a person can look.

Nothing here may strand a run. The claim and the opening of its rows are one transaction, so a
run that cannot be opened is un-claimed and the next beat tries again; an error while sending
fails the rows that were never attempted (they cannot double-send) and leaves the rest of the
sweep running; and a row left PENDING for an hour is failed by the sweep itself.

A post deleted from the groups while a row of it is mid-send is handled where that row finishes:
`send_pending` checks the post once the message is in, and takes it straight back down.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import time
from datetime import date, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from classes import telegram_group_api as api

from . import audience, render, schedule
from .models import GroupPost, GroupPostDelivery

logger = logging.getLogger("telegram_posts")

MAX_TRIES = 3
#: Telegram's 429 says how long to wait. We wait at most this many seconds and then retry; if
#: Telegram still wants longer, the retry meets another 429 and, after MAX_TRIES, the row fails
#: and a person presses Retry — better than holding a worker for minutes.
RETRY_AFTER_CAP = 30
INTERRUPTED_AFTER = timedelta(minutes=10)
#: A row still PENDING this long after it was last touched was never attempted (the run died
#: after opening it): the sweep fails it so the console shows it and Retry can send it.
STALE_PENDING_AFTER = timedelta(hours=1)
INTERRUPTED = "Interrupted while sending — it may or may not have arrived. Check the group before retrying."
NEVER_SENT = "Never sent — an internal error stopped this run. Retry sends it."
NO_ANSWER = "No answer from Telegram — it may have arrived. Check the group before Retry. ({})"
LATE = "More than an hour late — not sent on its own."
#: What Telegram answers to deleting a message that is already gone. That is the outcome we want.
ALREADY_GONE = "message to delete not found"

_sleep = time.sleep  # tests replace it


def enabled() -> bool:
    return bool(getattr(settings, "TELEGRAM_GROUP_POSTS_ENABLED", False)) and api.is_configured()


def claim_run(post, due) -> bool:
    """Win the right to open this run. A post deleted or paused since the caller read it is not claimed."""
    claimed = (
        GroupPost.objects.filter(pk=post.pk, deleted_at__isnull=True, is_paused=False)
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
            error="Nothing to send: the event was cancelled or has started.",
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
            _take_down_if_deleted(post, row.pk, row.chat_id, _message_id(result))
        else:
            reason = _reason(result)
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_FAILED, attempts=tries, error=reason,
                updated_at=timezone.now(),
            )
            logger.warning("telegram post %s → %s failed: %s", post.pk, row.chat_id, reason)
            stats["failed"] += 1
    return stats


def take_down(chat_id, message_id) -> tuple[bool, str]:
    """Delete our message from a group. `(True, "")` when it is gone, whether we removed it or it
    already was; `(False, why)` when it is still there."""
    result = api.delete_message(chat_id, message_id)
    if result.ok or ALREADY_GONE in (result.description or "").lower():
        return True, ""
    return False, result.description or "Telegram did not answer."


def _take_down_if_deleted(post, row_pk, chat_id, message_id) -> None:
    """The post was deleted from the groups while this row was mid-send, so `delete_from_groups`
    left the row alone (it was SENDING) and the message has just landed in the group: take it
    down at once. Never raises: the send itself succeeded, and the rest of the run must go on."""
    if not message_id:
        return
    try:
        if not GroupPost.objects.filter(pk=post.pk, deleted_at__isnull=False).exists():
            return
        gone, why = take_down(chat_id, message_id)
        now = timezone.now()
        if gone:
            GroupPostDelivery.objects.filter(pk=row_pk).update(
                status=GroupPostDelivery.STATUS_DELETED, deleted_at=now, updated_at=now
            )
        else:
            GroupPostDelivery.objects.filter(pk=row_pk).update(
                error=f"Delete failed: {why}"[:400], updated_at=now
            )
            logger.warning("telegram post %s → %s: deleted mid-send, take-down failed: %s", post.pk, chat_id, why)
    except Exception:
        logger.exception("telegram post %s → %s: could not take down a message of a deleted post", post.pk, chat_id)


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


def _never_reached_telegram(result) -> bool:
    """No code and a URLError: the connection failed (DNS, refused, connect timeout), so the request
    never got to Telegram. Any other no-code failure (a read timeout, a dropped connection) may
    have happened after Telegram took the message."""
    return result.error_code is None and (result.description or "").startswith("URLError")


def _worth_retrying(result) -> bool:
    """A 429, a 5xx, or a connection that never opened. A 400/403 will say the same thing next
    time, and an answer that never came may mean the message did arrive: a retry would post twice."""
    code = result.error_code
    if code is None:
        return _never_reached_telegram(result)
    return code == 429 or code >= 500


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
    if result.error_code is None and not _never_reached_telegram(result):
        return NO_ANSWER.format(result.description or "no details")[:400]
    prefix = "The bot is not in this group any more, or may not post. " if result.error_code == 403 else ""
    code = f"{result.error_code}: " if result.error_code else ""
    return (prefix + code + (result.description or "Telegram did not answer."))[:400]


def _fail_interrupted(now) -> int:
    interrupted = GroupPostDelivery.objects.filter(
        status=GroupPostDelivery.STATUS_SENDING, updated_at__lt=now - INTERRUPTED_AFTER
    ).update(status=GroupPostDelivery.STATUS_FAILED, error=INTERRUPTED, updated_at=now)
    unsent = GroupPostDelivery.objects.filter(
        status=GroupPostDelivery.STATUS_PENDING, updated_at__lt=now - STALE_PENDING_AFTER
    ).update(status=GroupPostDelivery.STATUS_FAILED, error=NEVER_SENT, updated_at=now)
    return interrupted + unsent


def _start_run(post, due) -> bool:
    """Claim the run and open its rows as one unit. False: another worker has it, or it could
    not be opened — in which case the claim is rolled back and the next beat tries again."""
    previous = post.last_run_on
    try:
        with transaction.atomic():
            if not claim_run(post, due):
                return False
            open_run(post, due)
    except Exception:
        post.last_run_on = previous
        logger.exception(
            "telegram post %s: the run of %s could not be opened; the next beat retries it",
            post.pk, due.run_on,
        )
        return False
    return True


def _guarded_send(post, run_on: date) -> dict:
    """`send_pending`, except an error fails the rows that were never attempted instead of
    stranding them PENDING. A row that was mid-send stays SENDING for `_fail_interrupted`: it may
    have arrived. (An interrupted run does not report the messages it did send.)"""
    try:
        return send_pending(post, run_on)
    except Exception:
        logger.exception("telegram post %s: sending the run of %s stopped on an error", post.pk, run_on)
    failed = 0
    try:
        failed = GroupPostDelivery.objects.filter(
            post=post, run_on=run_on, status=GroupPostDelivery.STATUS_PENDING
        ).update(status=GroupPostDelivery.STATUS_FAILED, error=NEVER_SENT, updated_at=timezone.now())
    except Exception:
        logger.exception("telegram post %s: could not fail the unsent rows of %s", post.pk, run_on)
    return {"sent": 0, "failed": failed, "skipped": 0}


def _sweep_post(post, now, stats: dict) -> None:
    due = schedule.due(post, now)
    if due is None or not _start_run(post, due):
        return
    stats["runs"] += 1
    if due.late:
        stats["missed"] += post.deliveries.filter(
            run_on=due.run_on, status=GroupPostDelivery.STATUS_MISSED
        ).count()
        return
    result = _guarded_send(post, due.run_on)
    stats["sent"] += result["sent"]
    stats["failed"] += result["failed"]


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
        try:
            _sweep_post(post, now, stats)
        except Exception:
            # One bad post must not stop the others from going out.
            logger.exception("telegram post %s: the sweep stopped on it", post.pk)
    if stats["runs"]:
        logger.info("telegram_posts sweep %s", stats)
    return stats


def send_post_now(post_id: int) -> dict:
    """A "Now" post or an event's announcement, dispatched on commit: nobody waits a minute."""
    if not enabled():
        return {}
    try:
        post = GroupPost.objects.select_related("event").filter(pk=post_id).first()
        if post is None:
            return {}
        due = schedule.due(post, timezone.now())
        if due is None or not _start_run(post, due):
            return {}
        return {} if due.late else _guarded_send(post, due.run_on)
    except Exception:
        logger.exception("telegram post %s: send now stopped on an error", post_id)
        return {}


def send_run(post_id: int, run_on: date) -> dict:
    """Send what a retry or "send missed now" put back to Pending.

    Like `send_post_now`, nothing escapes: an error is logged and the task ends. An error while
    sending fails the rows that were never attempted (`_guarded_send`) so none is left Pending.
    """
    if not enabled():
        return {}
    try:
        post = GroupPost.objects.select_related("event").filter(pk=post_id, deleted_at__isnull=True).first()
        return _guarded_send(post, run_on) if post else {}
    except Exception:
        logger.exception("telegram post %s: sending the run of %s stopped on an error", post_id, run_on)
        return {}
