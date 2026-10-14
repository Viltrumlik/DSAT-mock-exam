"""Where the integration reads its switches and credentials — one place, so nothing else touches
``settings.LCUP_*`` directly and a test can override them with ``override_settings``."""

import re

from django.conf import settings
from django.utils.dateparse import parse_date


def lcup_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ENABLED", False))


def attendance_pull_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ATTENDANCE_PULL_ENABLED", False))


def attendance_push_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ATTENDANCE_PUSH_ENABLED", False))


def attendance_push_from():
    """The first lesson day whose attendance may be sent to lc-up, or None (send nothing). A day
    before it is never sent: lc-up charges the fee for every mark it receives."""
    raw = str(getattr(settings, "LCUP_ATTENDANCE_PUSH_FROM", "") or "").strip()
    try:
        return parse_date(raw)
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        return None


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "LCUP_BASE_URL", "") or "").strip().rstrip("/"),
        "domain": (getattr(settings, "LCUP_DOMAIN", "") or "").strip(),
        # lc-up's login takes "998901234567" and answers 422 to "+998 90 …", which is how people write it.
        "mobile": re.sub(r"\D", "", getattr(settings, "LCUP_MOBILE", "") or ""),
        "password": getattr(settings, "LCUP_PASSWORD", "") or "",
    }
