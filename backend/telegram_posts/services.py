"""What the console does to a post. The rules live here, not in the views: the ops page, the
Django shell and the event hooks all come through these functions."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count
from django.utils import timezone

from events.models import Event

from . import schedule, sender
from .models import GroupPost, GroupPostDelivery

logger = logging.getLogger("telegram_posts")

#: Telegram lets a bot delete its own group messages for this long.
DELETE_WINDOW = timedelta(hours=48)
SCHEDULE_FIELDS = {"when", "send_at", "weekdays", "time_of_day"}


class PostRefused(Exception):
    """A refusal with a code the page can branch on and a sentence it can show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _dispatch_now(post) -> None:
    from classes.telegram_group_hooks import _dispatch

    from .tasks import send_group_post_now

    _dispatch(send_group_post_now, post.pk)


def _dispatch_run(post, run_on) -> None:
    from classes.telegram_group_hooks import _dispatch

    from .tasks import send_group_post_run

    _dispatch(send_group_post_run, post.pk, run_on.isoformat())


# ── create / edit ────────────────────────────────────────────────────────────


def create_post(*, data: dict, user, now=None) -> GroupPost:
    now = now or timezone.now()
    post = GroupPost(kind=GroupPost.KIND_MANUAL, created_by=user, active_from=now, **data)
    if post.when == GroupPost.WHEN_NOW:
        post.send_at = now
    post.save()
    if post.when == GroupPost.WHEN_NOW:
        _dispatch_now(post)
    return post


def ensure_editable(post, data: dict | None = None) -> None:
    """Refuse an edit that cannot work. `data` is the edit itself, when it is known."""
    if post.is_event_post:
        raise PostRefused("event_post", "This post comes from an event — edit the event instead.")
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    if post.when in (GroupPost.WHEN_NOW, GroupPost.WHEN_ONCE) and post.last_run_on:
        raise PostRefused("already_sent", "This post's time has passed. Write a new post, or use Send missed now.")
    # A post that has run keeps its kind of timing. Weekly → once would never send (the sweep skips a
    # post with a run), and weekly → now on the day it ran would send nothing (`due` sees the run).
    if data and "when" in data and data["when"] != post.when and post.last_run_on:
        raise PostRefused(
            "already_ran", "This post has already run — its timing can't change. Pause it and write a new post."
        )


def update_post(post, data: dict, *, now=None) -> GroupPost:
    """Edits change future sends only. A message already in a group is never rewritten."""
    now = now or timezone.now()
    ensure_editable(post, data)
    for field, value in data.items():
        setattr(post, field, value)
    if "image" in data:
        post.image_file_id = ""
    if SCHEDULE_FIELDS & set(data):
        post.active_from = now
    if post.when == GroupPost.WHEN_NOW:
        post.send_at = now
    post.save()
    if post.when == GroupPost.WHEN_NOW:
        _dispatch_now(post)
    return post


def pause(post) -> None:
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    post.is_paused = True
    post.save(update_fields=["is_paused", "updated_at"])


def resume(post, *, now=None) -> None:
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    if not post.is_paused:
        # Nothing to resume. Moving active_from now would skip a run that is due this very minute.
        return
    post.is_paused = False
    # What the pause covered stays skipped: resuming is not a burst of everything missed.
    post.active_from = now or timezone.now()
    post.save(update_fields=["is_paused", "active_from", "updated_at"])


# ── retry / missed ───────────────────────────────────────────────────────────


def _requeue(post, status: str) -> int:
    if post.deleted_at:
        raise PostRefused("deleted", "This post was deleted from the groups.")
    if not sender.enabled():
        raise PostRefused("off", "Posting to Telegram groups is switched off on this server.")
    if not post.last_run_on:
        return 0
    queued = GroupPostDelivery.objects.filter(
        post=post, run_on=post.last_run_on, status=status
    ).update(status=GroupPostDelivery.STATUS_PENDING, error="", updated_at=timezone.now())
    if queued:
        _dispatch_run(post, post.last_run_on)
    return queued


def retry_failed(post) -> dict:
    return {"queued": _requeue(post, GroupPostDelivery.STATUS_FAILED)}


def send_missed_now(post, *, now=None) -> dict:
    now = now or timezone.now()
    if post.kind == GroupPost.KIND_EVENT_REMINDER and (post.event is None or post.event.starts_at <= now):
        raise PostRefused("too_late", "The event has started — its reminder would be wrong now.")
    return {"queued": _requeue(post, GroupPostDelivery.STATUS_MISSED)}


# ── delete from groups ───────────────────────────────────────────────────────


def delete_from_groups(post, *, now=None) -> dict:
    """Take the post out of every group the bot can, and stop it for good.

    Works with the flag off as well: taking a wrong message down is the one thing that must
    never wait for a setting.
    """
    now = now or timezone.now()
    stats = {"deleted": 0, "too_old": 0, "failed": 0, "in_flight": 0}
    GroupPost.objects.filter(pk=post.pk, deleted_at__isnull=True).update(deleted_at=now, updated_at=now)
    post.deleted_at = post.deleted_at or now
    # Never sent: nothing to take down, and nothing will send them now.
    GroupPostDelivery.objects.filter(
        post=post,
        status__in=[GroupPostDelivery.STATUS_PENDING, GroupPostDelivery.STATUS_MISSED, GroupPostDelivery.STATUS_FAILED],
    ).update(status=GroupPostDelivery.STATUS_DELETED, deleted_at=now, updated_at=now)
    # Mid-send right now: the message may land after this call returns. `send_pending` sees the
    # post is deleted when such a row finishes and takes the message down itself; the count tells
    # the admin it is not done yet.
    stats["in_flight"] = GroupPostDelivery.objects.filter(
        post=post, status=GroupPostDelivery.STATUS_SENDING
    ).count()

    for row in GroupPostDelivery.objects.filter(post=post, status=GroupPostDelivery.STATUS_SENT).order_by("id"):
        if not row.message_id or (row.sent_at and now - row.sent_at > DELETE_WINDOW):
            stats["too_old"] += 1
            continue
        gone, why = sender.take_down(row.chat_id, row.message_id)
        if gone:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                status=GroupPostDelivery.STATUS_DELETED, deleted_at=now, updated_at=now
            )
            stats["deleted"] += 1
        else:
            GroupPostDelivery.objects.filter(pk=row.pk).update(
                error=f"Delete failed: {why}"[:400], updated_at=now
            )
            stats["failed"] += 1
    logger.info("telegram_post_deleted post=%s %s", post.pk, stats)
    return stats


# ── what the console shows ───────────────────────────────────────────────────


def delivery_counts(post_ids) -> dict:
    out: dict = defaultdict(lambda: defaultdict(Counter))
    rows = (
        GroupPostDelivery.objects.filter(post_id__in=list(post_ids))
        .order_by()
        .values("post_id", "run_on", "status")
        .annotate(n=Count("id"))
    )
    for row in rows:
        out[row["post_id"]][row["run_on"]][row["status"]] += row["n"]
    return out


def last_run(post, counts) -> dict | None:
    if not post.last_run_on:
        return None
    c = counts.get(post.pk, {}).get(post.last_run_on) or Counter()
    return {
        "run_on": post.last_run_on,
        "total": sum(c.values()),
        "sent": c[GroupPostDelivery.STATUS_SENT],
        "failed": c[GroupPostDelivery.STATUS_FAILED],
        "missed": c[GroupPostDelivery.STATUS_MISSED],
        "pending": c[GroupPostDelivery.STATUS_PENDING] + c[GroupPostDelivery.STATUS_SENDING],
        "deleted": c[GroupPostDelivery.STATUS_DELETED],
    }


def post_state(post, last, now) -> str:
    if post.deleted_at:
        return "deleted"
    if post.event_id and post.event.status == Event.STATUS_CANCELLED:
        return "event_cancelled"
    if post.is_paused:
        return "paused"
    if last:
        if last["pending"]:
            return "sending"
        if last["failed"]:
            return "failed"
        if last["missed"]:
            return "missed"
    if schedule.next_at(post, now):
        return "scheduled"
    return "sent" if last else "done"


def runs(post, *, limit: int = 12) -> list[dict]:
    days = list(
        GroupPostDelivery.objects.filter(post=post)
        .order_by("-run_on")
        .values_list("run_on", flat=True)
        .distinct()[:limit]
    )
    grouped: dict = {day: [] for day in days}
    for row in GroupPostDelivery.objects.filter(post=post, run_on__in=days).order_by("-run_on", "id"):
        grouped[row.run_on].append(row)
    return [{"run_on": day, "deliveries": grouped[day]} for day in days]
