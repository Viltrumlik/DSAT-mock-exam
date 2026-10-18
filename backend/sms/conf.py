"""Where the SMS app reads its switches and credentials — one place, so nothing else touches
``settings.ESKIZ_*`` directly and a test can override them with ``override_settings``."""

from django.conf import settings

DEFAULT_BASE_URL = "https://notify.eskiz.uz/api"
DEFAULT_SENDER = "4546"


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "ESKIZ_BASE_URL", "") or DEFAULT_BASE_URL).strip().rstrip("/"),
        "email": (getattr(settings, "ESKIZ_EMAIL", "") or "").strip(),
        # The gateway secret key from the eskiz cabinet (SMS → gateway), not the cabinet password.
        "secret": getattr(settings, "ESKIZ_SECRET_KEY", "") or "",
        "sender": (getattr(settings, "ESKIZ_FROM", "") or DEFAULT_SENDER).strip(),
    }


def is_configured() -> bool:
    creds = credentials()
    return bool(creds["email"] and creds["secret"])


def debt_warnings_enabled() -> bool:
    return bool(getattr(settings, "SMS_DEBT_WARNINGS_ENABLED", False))
