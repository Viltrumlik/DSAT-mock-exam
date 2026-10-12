import logging

from celery import shared_task
from django.core.cache import cache

from .client import LcupAuthError, default_client
from .conf import lcup_enabled
from .sync import run_sync

log = logging.getLogger("lcup")

#: Beat fires every 15 minutes; a run that is still going when the next one fires is not doubled.
RUNNING_KEY = "lcup:sync-running"


@shared_task(name="lcup.tasks.sync")
def sync() -> dict:
    if not lcup_enabled():
        return {"skipped": "disabled"}
    if not cache.add(RUNNING_KEY, "1", timeout=14 * 60):
        return {"skipped": "already running"}
    try:
        try:
            run = run_sync(default_client())
        except LcupAuthError:
            log.error("lc-up refused the integration login; the sync stopped")
            raise
        return run.counts
    finally:
        cache.delete(RUNNING_KEY)
