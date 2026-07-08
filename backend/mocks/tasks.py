from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.db import transaction

from .engine_db_guard import TransitionConflict
from .models import MockAttempt

logger = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def score_mock_attempt_async(self, attempt_id: int, trace_id: str | None = None) -> dict:
    """Idempotent scoring: SCORING -> COMPLETED (freezes english/math/total)."""
    with transaction.atomic():
        attempt = MockAttempt.objects.select_for_update().select_related("mock").get(pk=attempt_id)
        if attempt.is_completed:
            return {"status": "noop", "reason": "already_completed", "attempt_id": attempt_id}
        if attempt.current_state != "SCORING":
            return {"status": "noop", "reason": f"state_is_{attempt.current_state}", "attempt_id": attempt_id}
        try:
            attempt.complete()
        except TransitionConflict:
            attempt.refresh_from_db()
            if not (attempt.is_completed and attempt.current_state == "COMPLETED"):
                raise
    logger.info("mock_attempt_scored attempt_id=%s trace_id=%s", attempt_id, trace_id)
    return {"status": "ok", "attempt_id": attempt_id}


def enqueue_mock_scoring(*, attempt_id: int, request=None) -> None:
    trace_id = getattr(request, "trace_id", None) if request is not None else None
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        score_mock_attempt_async.delay(attempt_id, trace_id=trace_id)
    else:
        score_mock_attempt_async(attempt_id, trace_id=trace_id)
