"""Where the ledger reads its switches, so a test can override them with ``override_settings``."""

from django.conf import settings

#: A span billed month by month (lc-up's rule), or lesson by lesson from a balance (owner, 2026-11-22).
RULE_MONTH = "month"
RULE_LESSON = "lesson"


def shadow_enabled() -> bool:
    return bool(getattr(settings, "BILLING_SHADOW_ENABLED", False))


def payments_open() -> bool:
    """Whether admins enter money here. Never while the ledger still follows lc-up: a payment entered here and
    in lc-up would count twice."""
    return bool(getattr(settings, "BILLING_PAYMENTS_OPEN", False)) and not shadow_enabled()


def ledger_is_ours() -> bool:
    """lc-up no longer writes the ledger: it bills its own spans and freezes its own debtors (``tasks.own_tick``)."""
    return payments_open()


def lesson_billing() -> bool:
    """New spans are billed per lesson, from a balance topped up in advance (``ledger._bill_lessons``)."""
    return str(getattr(settings, "BILLING_MODE", RULE_MONTH) or "").strip().lower() == RULE_LESSON


def default_rule() -> str:
    return RULE_LESSON if lesson_billing() else RULE_MONTH


def _money_setting(name: str, default: int) -> int:
    try:
        value = int(getattr(settings, name, default))
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


def lesson_price() -> int:
    """One lesson at the group's full price (owner, 2026-11-22: 38,500 so'm)."""
    return _money_setting("BILLING_LESSON_PRICE", 38_500)


def min_topup() -> int:
    """The least a payment may be while students pay per lesson (owner, 2026-11-22: 160,000 so'm)."""
    return _money_setting("BILLING_MIN_TOPUP", 160_000)
