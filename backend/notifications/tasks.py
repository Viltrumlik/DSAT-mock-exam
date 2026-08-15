"""Celery tasks: push fan-out, and pruning the endpoints that have died.

The fan-out lives here rather than in the request because N sequential HTTPS calls inside a
handler is the sync-worker starvation problem this codebase already knows about (see the 25s
SSE cap in `realtime/views.py`).
"""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="notifications.send_push_for_notification",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
)
def send_push_for_notification(notification_id: int) -> dict:
    """Push one notification to every live browser its recipient has registered."""
    from . import push
    from .models import Notification, PushSubscription

    if not push.is_configured():
        return {"sent": 0, "skipped": "not configured"}

    notification = Notification.objects.filter(pk=notification_id).select_related(
        "recipient"
    ).first()
    if notification is None:
        return {"sent": 0, "skipped": "gone"}

    payload = push.payload_for(notification)
    subscriptions = PushSubscription.objects.filter(
        user=notification.recipient, failed_at__isnull=True
    )
    sent = sum(1 for sub in subscriptions if push.send_to_subscription(sub, payload))
    return {"sent": sent}


@shared_task(name="notifications.prune_push_subscriptions")
def prune_push_subscriptions(older_than_days: int = 30) -> dict:
    from .services import prune_failed_subscriptions

    return {"deleted": prune_failed_subscriptions(older_than_days)}
