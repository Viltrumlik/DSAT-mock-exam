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


@shared_task(bind=True, name="lcup.tasks.follow_student", max_retries=20, default_retry_delay=90)
def follow_student(self, link_pk: int) -> dict:
    """A student's lc-up link moved to another of their accounts (``phone_confirm``, or an admin's
    relink): their groups and lc-up attendance follow now, not at the next sync. It takes the sync's
    lock — both write the same rosters — and waits its turn while a sync runs."""
    from datetime import timedelta

    from django.utils import timezone

    from .models import LcupStudentLink
    from .phone_confirm import follow_link

    if not lcup_enabled():
        return {"skipped": "disabled"}
    if not cache.add(RUNNING_KEY, "1", timeout=14 * 60):
        raise self.retry()
    try:
        link = LcupStudentLink.objects.filter(pk=link_pk, user__isnull=False).first()
        if link is None:
            return {"skipped": "no account"}
        return follow_link(default_client(), link, until=timezone.localdate() - timedelta(days=1))
    finally:
        cache.delete(RUNNING_KEY)


@shared_task(name="lcup.tasks.attendance_checks")
def attendance_checks() -> dict:
    """Each paired class's teachers, as its lesson ends (lcup.followups). Returns at once while
    LCUP_ATTENDANCE_CHECKS_ENABLED is off."""
    from .followups import send_lesson_checks

    return send_lesson_checks()


#: The nightly archive runs alone; the sync goes on beside it — the client paces both to lc-up's limit.
ARCHIVE_RUNNING_KEY = "lcup:archive-running"


def archive_exclusive(dry_run: bool):
    """One archive pass at a time (beat, the command): ``None`` while another is still going."""
    from .archive import run_archive

    if not cache.add(ARCHIVE_RUNNING_KEY, "1", timeout=3 * 60 * 60):
        return None
    try:
        return run_archive(default_client(), dry_run=dry_run)
    finally:
        cache.delete(ARCHIVE_RUNNING_KEY)


@shared_task(name="lcup.tasks.archive")
def archive() -> dict:
    """lcup.archive, nightly. Only reads lc-up."""
    from .conf import archive_enabled

    if not (lcup_enabled() and archive_enabled()):
        return {"skipped": "disabled"}
    run = archive_exclusive(dry_run=False)
    return {"skipped": "already running"} if run is None else {"run": run.pk, "ok": run.ok}
