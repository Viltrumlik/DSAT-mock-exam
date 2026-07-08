"""Idempotent replay for mutating midterm-attempt endpoints.

Mirrors ``exams.idempotency`` against ``MidtermAttemptIdempotencyKey`` so the frontend
exam-runner's existing ``Idempotency-Key`` header keeps working unchanged.
"""

from __future__ import annotations

from typing import Callable

from django.conf import settings
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.response import Response

from .models import MidtermAttempt, MidtermAttemptIdempotencyKey


def idempotency_ttl_seconds_for_attempt(attempt: MidtermAttempt | None) -> int:
    """TTL for stored replay payloads: full exam duration + buffer, capped at 7 days."""
    floor = int(getattr(settings, "EXAM_ATTEMPT_IDEMPOTENCY_TTL_SECONDS", 24 * 60 * 60) or 86400)
    slack = 7200
    if attempt is None:
        return min(max(floor, 7200), 7 * 86400)
    try:
        scheduled_secs = int(getattr(attempt.midterm, "duration_minutes", 0) or 0) * 60 + slack
    except Exception:
        scheduled_secs = 0
    return min(max(floor, scheduled_secs or 0, 7200), 7 * 86400)


def consume_idempotency_key(
    *,
    attempt: MidtermAttempt,
    endpoint: str,
    key: str | None,
    compute: Callable[[], Response],
    ttl_seconds: int | None = None,
) -> Response:
    """Persist and replay responses for a mutating endpoint. Empty key -> plain compute()."""
    if ttl_seconds is None:
        ttl_seconds = idempotency_ttl_seconds_for_attempt(attempt)
    k = (key or "").strip()
    if not k:
        return compute()

    now = timezone.now()
    row = (
        MidtermAttemptIdempotencyKey.objects.filter(attempt=attempt, endpoint=endpoint, key=k)
        .order_by("-created_at")
        .first()
    )
    if row and row.expires_at and row.expires_at > now:
        return Response(row.response_json or {}, status=int(row.response_status or 200))

    res = compute()
    try:
        MidtermAttemptIdempotencyKey.objects.create(
            attempt=attempt,
            endpoint=str(endpoint),
            key=k,
            response_status=int(getattr(res, "status_code", 200) or 200),
            response_json=getattr(res, "data", None) if isinstance(getattr(res, "data", None), (dict, list)) else {},
            expires_at=now + timezone.timedelta(seconds=int(ttl_seconds)),
        )
    except IntegrityError:
        row = (
            MidtermAttemptIdempotencyKey.objects.filter(attempt=attempt, endpoint=endpoint, key=k)
            .order_by("-created_at")
            .first()
        )
        if row and row.expires_at and row.expires_at > now:
            return Response(row.response_json or {}, status=int(row.response_status or 200))
    return res
