"""Where the ledger reads its switches, so a test can override them with ``override_settings``."""

from django.conf import settings


def shadow_enabled() -> bool:
    return bool(getattr(settings, "BILLING_SHADOW_ENABLED", False))
