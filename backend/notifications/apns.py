"""Apple Push Notification service — the iOS app's half of push.

The web half (`push.py`) speaks Web Push to browsers. An installed iPhone app cannot receive
Web Push; it receives APNs. Same notifications, same gate (`PUSH_EVENTS` + the student's
`push_enabled`), a second transport.

**Inert until configured**, exactly like the VAPID half: with no key `is_configured()` is False,
the task returns at once, and nothing else changes. Configuring it needs an Apple Developer
Program membership (a free "Personal Team" cannot sign the push entitlement):

    APNS_KEY_ID=ABC123DEFG           # the key's id, from developer.apple.com → Keys
    APNS_TEAM_ID=XXXXXXXXXX          # the team id
    APNS_AUTH_KEY_PATH=/path/AuthKey_ABC123DEFG.p8     (or APNS_AUTH_KEY=<the .p8 text>)
    APNS_TOPIC=uz.mastersat.app      # the app's bundle id

Token-based auth: one ES256-signed JWT, reused for 45 minutes (Apple refuses one older than an
hour and throttles one refreshed more often than every twenty). HTTP/2 is required by APNs; the
client is created once and reused, which is also what Apple asks for.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

PRODUCTION_HOST = "https://api.push.apple.com"
SANDBOX_HOST = "https://api.sandbox.push.apple.com"
TOKEN_LIFETIME_SECONDS = 45 * 60
#: APNs reasons that mean the device token itself is dead — stop sending to it.
DEAD_TOKEN_REASONS = frozenset({"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "TopicDisallowed"})
#: APNs caps a payload at 4 KB; a notification body is short, but a broadcast might not be.
MAX_BODY_CHARS = 1500

_lock = threading.Lock()
_provider: dict[str, Any] = {}
_client = None


def _transport_available() -> bool:
    """httpx with HTTP/2 support (`h2`). Imported lazily: a deploy without them must still boot."""
    try:
        import h2  # noqa: F401
        import httpx  # noqa: F401
    except ImportError:
        return False
    return True


def _auth_key() -> str:
    raw = (getattr(settings, "APNS_AUTH_KEY", "") or "").strip()
    if raw:
        # An env var cannot hold real newlines everywhere; accept them written as "\n".
        return raw.replace("\\n", "\n")
    path = (getattr(settings, "APNS_AUTH_KEY_PATH", "") or "").strip()
    if path:
        try:
            with open(path, encoding="utf-8") as handle:
                return handle.read().strip()
        except OSError:
            logger.warning("apns_auth_key_unreadable path=%s", path)
    return ""


def is_configured() -> bool:
    return bool(
        getattr(settings, "APNS_KEY_ID", "")
        and getattr(settings, "APNS_TEAM_ID", "")
        and _auth_key()
        and _transport_available()
    )


def topic() -> str:
    return getattr(settings, "APNS_TOPIC", "") or "uz.mastersat.app"


def _provider_token(*, force: bool = False) -> str:
    """The signed JWT, cached across sends (and threads) for 45 minutes."""
    import jwt

    now = time.time()
    with _lock:
        cached = _provider.get("token")
        issued = _provider.get("issued", 0.0)
        if cached and not force and now - issued < TOKEN_LIFETIME_SECONDS:
            return cached
        token = jwt.encode(
            {"iss": settings.APNS_TEAM_ID, "iat": int(now)},
            _auth_key(),
            algorithm="ES256",
            headers={"kid": settings.APNS_KEY_ID},
        )
        _provider["token"] = token
        _provider["issued"] = now
        return token


def _get_client():
    global _client
    with _lock:
        if _client is None:
            import httpx

            _client = httpx.Client(http2=True, timeout=10.0)
        return _client


def _post(url: str, headers: dict[str, str], body: bytes) -> tuple[int, str]:
    """One request to APNs → (status, reason). Separate so tests can stand in for the network."""
    response = _get_client().post(url, headers=headers, content=body)
    reason = ""
    if response.status_code != 200:
        try:
            reason = str((response.json() or {}).get("reason") or "")
        except Exception:
            reason = ""
    return response.status_code, reason


def payload_for(notification, *, badge: int | None = None) -> dict:
    """What the app receives. `link` is the web path the app maps to a screen."""
    aps: dict[str, Any] = {
        "alert": {"title": notification.title, "body": (notification.body or "")[:MAX_BODY_CHARS]},
        "sound": "default",
        # Groups a category's banners together in Notification Centre, the way the web's
        # service worker replaces a category's previous banner.
        "thread-id": notification.category,
    }
    if badge is not None:
        aps["badge"] = max(0, int(badge))
    return {
        "aps": aps,
        "link": notification.link_url or "",
        "category": notification.category,
        "id": notification.pk,
    }


def send_to_device(device, payload: dict) -> bool:
    """Push one payload to one device. Returns whether APNs accepted it.

    A dead token (410, BadDeviceToken…) is a normal end of life — the app was deleted — so the
    row is stamped `failed_at` and the caller is not asked to retry. An expired provider token
    is re-signed and the send tried once more. Anything else is logged and dropped: APNs
    stores and forwards what it accepts, and re-sending on our side only duplicates banners.

    `BadDeviceToken` is also what APNs answers when a token is sent to the wrong host — a
    debug build's token belongs to the sandbox, a TestFlight or App Store build's to
    production — so the other host is tried once before the token is called dead, and the
    environment that worked is remembered.
    """
    if not is_configured():
        return False

    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    environment = device.environment
    force_token = re_signed = tried_other_host = False

    for _ in range(3):
        host = SANDBOX_HOST if environment == device.ENV_SANDBOX else PRODUCTION_HOST
        headers = {
            "authorization": f"bearer {_provider_token(force=force_token)}",
            "apns-topic": topic(),
            "apns-push-type": "alert",
            "apns-priority": "10",
            # A day: news older than that (a homework due yesterday) is noise, not news.
            "apns-expiration": str(int(time.time()) + 24 * 3600),
        }
        force_token = False
        try:
            status, reason = _post(f"{host}/3/device/{device.token}", headers, body)
        except Exception:
            logger.warning("apns_send_error device=%s", device.pk, exc_info=True)
            return False

        if status == 200:
            fields = []
            if environment != device.environment:
                device.environment = environment
                fields.append("environment")
            if device.failed_at:
                device.failed_at = None
                device.failure_reason = ""
                fields += ["failed_at", "failure_reason"]
            if fields:
                device.save(update_fields=[*fields, "last_seen_at"])
            return True
        if status == 403 and reason in ("ExpiredProviderToken", "InvalidProviderToken") and not re_signed:
            re_signed = force_token = True
            continue
        if reason == "BadDeviceToken" and not tried_other_host:
            tried_other_host = True
            environment = device.ENV_PRODUCTION if environment == device.ENV_SANDBOX else device.ENV_SANDBOX
            continue
        if status == 410 or reason in DEAD_TOKEN_REASONS:
            device.failed_at = timezone.now()
            device.failure_reason = (reason or f"HTTP {status}")[:64]
            device.save(update_fields=["failed_at", "failure_reason"])
            logger.info("apns_device_gone device=%s status=%s reason=%s", device.pk, status, reason)
            return False
        logger.warning("apns_send_failed device=%s status=%s reason=%s", device.pk, status, reason)
        return False
    return False


def reset_for_tests() -> None:
    """Forget the cached provider token and client."""
    global _client
    with _lock:
        _provider.clear()
        _client = None
