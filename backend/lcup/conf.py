"""Where the integration reads its switches and credentials — one place, so nothing else touches
``settings.LCUP_*`` directly and a test can override them with ``override_settings``."""

from django.conf import settings


def lcup_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ENABLED", False))


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "LCUP_BASE_URL", "") or "").rstrip("/"),
        "domain": getattr(settings, "LCUP_DOMAIN", "") or "",
        "mobile": getattr(settings, "LCUP_MOBILE", "") or "",
        "password": getattr(settings, "LCUP_PASSWORD", "") or "",
    }
