from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.db import transaction

from .engine_db_guard import TransitionConflict
from .models import MidtermAttempt

logger = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def score_midterm_attempt_async(self, attempt_id: int, trace_id: str | None = None) -> dict:
    """Idempotent scoring: SCORING -> COMPLETED, then standalone auto-certificate if applicable."""
    with transaction.atomic():
        attempt = (
            MidtermAttempt.objects.select_for_update().select_related("midterm").get(pk=attempt_id)
        )
        if attempt.current_state == MidtermAttempt.STATE_COMPLETED and attempt.is_completed:
            return {"status": "noop", "reason": "already_completed", "attempt_id": attempt_id}
        if attempt.current_state != MidtermAttempt.STATE_SCORING:
            return {"status": "noop", "reason": f"state_is_{attempt.current_state}", "attempt_id": attempt_id}
        try:
            attempt.complete()
        except TransitionConflict:
            attempt.refresh_from_db()
            if not (attempt.is_completed and attempt.current_state == MidtermAttempt.STATE_COMPLETED):
                raise

    # Standalone flavor auto-issues a certificate on completion (no rank, instructor = grantor).
    # The certificate service lands with the schedule/cert re-home; call it defensively.
    try:
        from .certificates import maybe_issue_standalone_certificate

        maybe_issue_standalone_certificate(attempt_id)
    except Exception:  # pragma: no cover - defensive until cert re-home ships
        logger.debug("standalone certificate issuance skipped for midterm attempt %s", attempt_id, exc_info=True)

    logger.info("midterm_attempt_scored attempt_id=%s trace_id=%s", attempt_id, trace_id)
    return {"status": "ok", "attempt_id": attempt_id}


def enqueue_midterm_scoring(*, attempt_id: int, request=None) -> None:
    """Enqueue scoring on the first SCORING transition (async if a broker exists, else inline)."""
    trace_id = getattr(request, "trace_id", None) if request is not None else None
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        score_midterm_attempt_async.delay(attempt_id, trace_id=trace_id)
    else:
        # No broker in this environment: score inline so results are immediate (matches
        # EXAMS_SCORE_INLINE_IF_NO_CELERY intent; midterms are single-module and fast).
        score_midterm_attempt_async(attempt_id, trace_id=trace_id)
