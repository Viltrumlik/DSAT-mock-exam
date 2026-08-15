"""Web Push delivery.

Push is the right transport for this platform for one specific reason: it does **not** hold a
worker. Gunicorn runs three sync workers here, which is why the SSE stream in `realtime/` caps
itself at 25 seconds and why whole-fleet delivery cannot ride it. A push is one outbound HTTPS
request from a Celery worker and then nothing.

**Configuration is optional and its absence is not an error.** Without VAPID keys the platform
runs exactly as it does today — the bell works, the realtime hint works, and `is_configured()`
is False so the client never asks the browser for permission it cannot honour. A half-configured
deployment asking students for notification permission and then never sending one is worse than
one that never asks: a denied permission is permanent per origin, and it cannot be asked for
again once refused.
"""

from __future__ import annotations

import json
import logging

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """True when VAPID keys are present and `pywebpush` is installed."""
    if not (getattr(settings, "VAPID_PUBLIC_KEY", "") and getattr(settings, "VAPID_PRIVATE_KEY", "")):
        return False
    try:
        import pywebpush  # noqa: F401
    except ImportError:
        return False
    return True


def public_key() -> str:
    return getattr(settings, "VAPID_PUBLIC_KEY", "") or ""


def _claims() -> dict:
    # The `sub` is how a push service reaches a human if the platform starts misbehaving.
    # Required by the spec, and some services reject a subscription without it.
    return {"sub": getattr(settings, "VAPID_SUBJECT", "") or "mailto:admin@mastersat.uz"}


def send_to_subscription(subscription, payload: dict) -> bool:
    """Push one payload to one browser. Returns whether it landed.

    A 404 or 410 means the browser has thrown the subscription away — the student cleared
    their data, or uninstalled. That is a normal end of life, not a failure to retry: the row
    is stamped `failed_at` and pruned later, and the caller must not raise on it.
    """
    if not is_configured():
        return False

    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims=_claims(),
            timeout=10,
        )
        if subscription.failed_at:
            subscription.failed_at = None
            subscription.save(update_fields=["failed_at", "last_seen_at"])
        return True
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            subscription.failed_at = timezone.now()
            subscription.save(update_fields=["failed_at"])
            logger.info("push_subscription_gone id=%s status=%s", subscription.pk, status)
        else:
            logger.warning("push_send_failed id=%s status=%s", subscription.pk, status)
        return False
    except Exception:
        logger.exception("push_send_error id=%s", subscription.pk)
        return False


def payload_for(notification) -> dict:
    """What the service worker receives. Kept small — payloads are size-capped and encrypted."""
    return {
        "title": notification.title,
        "body": notification.body,
        "url": notification.link_url or "/",
        "category": notification.category,
        "id": notification.pk,
    }
