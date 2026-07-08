"""Idempotent replay for mutating mock-attempt endpoints (mirrors exams/midterms)."""

from __future__ import annotations

from typing import Callable

from django.conf import settings
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.response import Response

from .models import MockAttempt, MockAttemptIdempotencyKey


def _ttl(attempt: MockAttempt | None) -> int:
    floor = int(getattr(settings, "EXAM_ATTEMPT_IDEMPOTENCY_TTL_SECONDS", 86400) or 86400)
    if attempt is None:
        return min(max(floor, 7200), 7 * 86400)
    try:
        mins = sum(int(getattr(m, "time_limit_minutes", 0) or 0) for m in attempt.mock.english_modules() + attempt.mock.math_modules())
        mins += int(getattr(attempt.mock, "break_minutes", 0) or 0)
        scheduled = mins * 60 + 7200
    except Exception:
        scheduled = 0
    return min(max(floor, scheduled or 0, 7200), 7 * 86400)


def consume_idempotency_key(*, attempt, endpoint, key, compute: Callable[[], Response], ttl_seconds=None) -> Response:
    if ttl_seconds is None:
        ttl_seconds = _ttl(attempt)
    k = (key or "").strip()
    if not k:
        return compute()
    now = timezone.now()
    row = MockAttemptIdempotencyKey.objects.filter(attempt=attempt, endpoint=endpoint, key=k).order_by("-created_at").first()
    if row and row.expires_at and row.expires_at > now:
        return Response(row.response_json or {}, status=int(row.response_status or 200))
    res = compute()
    try:
        MockAttemptIdempotencyKey.objects.create(
            attempt=attempt, endpoint=str(endpoint), key=k,
            response_status=int(getattr(res, "status_code", 200) or 200),
            response_json=getattr(res, "data", None) if isinstance(getattr(res, "data", None), (dict, list)) else {},
            expires_at=now + timezone.timedelta(seconds=int(ttl_seconds)),
        )
    except IntegrityError:
        row = MockAttemptIdempotencyKey.objects.filter(attempt=attempt, endpoint=endpoint, key=k).order_by("-created_at").first()
        if row and row.expires_at and row.expires_at > now:
            return Response(row.response_json or {}, status=int(row.response_status or 200))
    return res
