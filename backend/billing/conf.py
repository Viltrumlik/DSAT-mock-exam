"""Where the ledger reads its switches, so a test can override them with ``override_settings``."""

from django.conf import settings


def shadow_enabled() -> bool:
    return bool(getattr(settings, "BILLING_SHADOW_ENABLED", False))


def payments_open() -> bool:
    """Whether admins enter money here. Never while the ledger still follows lc-up: a payment entered here and
    in lc-up would count twice."""
    return bool(getattr(settings, "BILLING_PAYMENTS_OPEN", False)) and not shadow_enabled()
