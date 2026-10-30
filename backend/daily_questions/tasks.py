from __future__ import annotations

from celery import shared_task
from django.utils import timezone

from .pools import build_pools


@shared_task(name="daily_questions.tasks.build_pools")
def build_pools_task() -> int:
    """This month's lists, on the 1st. Idempotent: a list already built is left as it is."""
    return len(build_pools(timezone.localdate()))
