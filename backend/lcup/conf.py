"""Where the integration reads its switches and credentials — one place, so nothing else touches
``settings.LCUP_*`` directly and a test can override them with ``override_settings``."""

import re
from datetime import date

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


def debt_freeze_enabled() -> bool:
    return bool(getattr(settings, "LCUP_DEBT_FREEZE_ENABLED", False))


def debt_freeze_day() -> int:
    """From this day of each month a student whose lc-up balance is below zero is frozen (owner:
    "har oyning 6-sanasigacha qarz to'lanmasa muzlatilsin 6-kuni")."""
    try:
        day = int(getattr(settings, "LCUP_DEBT_FREEZE_DAY", 6))
    except (TypeError, ValueError):
        day = 6
    return min(max(day, 1), 28)


def archive_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ARCHIVE_ENABLED", False))


def archive_since():
    """The first day of attendance and payments the archive copies. Before lc-up held anything, so a
    window of nothing costs one request and is done."""
    raw = str(getattr(settings, "LCUP_ARCHIVE_SINCE", "") or "").strip()
    try:
        return parse_date(raw) or date(2025, 1, 1)
    except ValueError:
        return date(2025, 1, 1)


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "LCUP_BASE_URL", "") or "").strip().rstrip("/"),
        "domain": (getattr(settings, "LCUP_DOMAIN", "") or "").strip(),
        # lc-up's login takes "998901234567" and answers 422 to "+998 90 …", which is how people write it.
        "mobile": re.sub(r"\D", "", getattr(settings, "LCUP_MOBILE", "") or ""),
        "password": getattr(settings, "LCUP_PASSWORD", "") or "",
    }


def attendance_checks_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ATTENDANCE_CHECKS_ENABLED", False))


def profile_sync_enabled() -> bool:
    """A linked learner's name and phone are lc-up's: set on every sync, not edited here (``lcup.profiles``)."""
    return bool(getattr(settings, "LCUP_PROFILE_SYNC_ENABLED", False))


def free_trial_lessons() -> int:
    """How many lessons a trial student comes to for free (owner, 2026-10-20: one — "birinchi darsda")."""
    try:
        lessons = int(getattr(settings, "LCUP_FREE_TRIAL_LESSONS", 1))
    except (TypeError, ValueError):
        lessons = 1
    return max(lessons, 0)
