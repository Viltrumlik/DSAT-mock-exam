from celery import shared_task
from django.core.cache import cache

from . import conf, shadow
from .models import BillingState

#: Beat fires every 15 minutes; a tick that is still going when the next one fires is not doubled.
RUNNING_KEY = "billing:tick-running"


@shared_task(name="billing.tasks.shadow_tick")
def shadow_tick(*, allow_mass: bool = False) -> dict:
    """Follow lc-up for the last 15 minutes. Returns at once while BILLING_SHADOW_ENABLED is off."""
    if not cache.add(RUNNING_KEY, "1", timeout=14 * 60):
        return {"skipped": "already running"}
    try:
        return shadow.tick(allow_mass=allow_mass)
    finally:
        cache.delete(RUNNING_KEY)


@shared_task(name="billing.tasks.compare")
def compare() -> dict:
    """The day's comparison with lc-up's balances."""
    if not conf.shadow_enabled():
        return {"skipped": "disabled"}
    if BillingState.get().opened_at is None:
        return {"skipped": "not opened"}
    run = shadow.compare()
    return {"run": run.pk, "ok": run.ok}
