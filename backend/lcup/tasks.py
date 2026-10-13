from celery import shared_task
from django.core.cache import cache

from .client import default_client
from .conf import lcup_enabled
from .sync import run_sync

#: Beat fires every 15 minutes; a run that is still going when the next one fires is not doubled.
RUNNING_KEY = "lcup:sync-running"


def _exclusive(dry_run: bool) -> dict:
    if not cache.add(RUNNING_KEY, "1", timeout=14 * 60):
        return {"skipped": "already running"}
    try:
        return run_sync(default_client(), dry_run=dry_run).counts
    finally:
        cache.delete(RUNNING_KEY)


@shared_task(name="lcup.tasks.sync")
def sync() -> dict:
    if not lcup_enabled():
        return {"skipped": "disabled"}
    return _exclusive(dry_run=False)


@shared_task(name="lcup.tasks.dry_run")
def dry_run() -> dict:
    """The /ops/lcup "Dry run" button. Allowed while the integration is off — previewing a sync
    before switching it on is the point. Its report is the dry-run row in the run list."""
    return _exclusive(dry_run=True)
