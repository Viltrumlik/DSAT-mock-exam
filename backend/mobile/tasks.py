from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

#: Long enough to compare this release with the last two; short enough that a crash loop on one
#: phone cannot grow the table without bound.
RETENTION_DAYS = 90


@shared_task(name="mobile.prune_diagnostics")
def prune_diagnostics() -> int:
    from .models import ClientDiagnostic

    cutoff = timezone.now() - timedelta(days=RETENTION_DAYS)
    deleted, _ = ClientDiagnostic.objects.filter(received_at__lt=cutoff).delete()
    return deleted
