"""Reaper for stranded full-mock attempts — the shared implementation.

Called from two places, which must never drift:
  * ``manage.py sweep_mock_attempts``      — manual / cron
  * ``mocks.tasks.sweep_mock_attempts_task`` — Celery beat (see CELERY_BEAT_SCHEDULE)

Open-practice mocks never pause, so an attempt whose student closed the tab mid-module
stays ACTIVE with an expired clock forever: it never reaches SCORING, never scores, and
— via ``uniq_active_mock_attempt_per_student`` — permanently blocks that student from
starting the mock again. Reaping fast-forwards it to completion; unanswered questions
grade as omitted, which is the right outcome for a timed test nobody came back to.
"""
from __future__ import annotations

import logging

from django.db import transaction

from .models import MockAttempt
from .state_machine import (
    STATE_ABANDONED,
    STATE_BREAK,
    STATE_COMPLETED,
    STATE_NOT_STARTED,
    STATE_SCORING,
)

logger = logging.getLogger(__name__)

DEFAULT_GRACE_MINUTES = 30


def is_stranded(att, grace_seconds: int) -> bool:
    state = att.current_state
    if state == STATE_SCORING:
        return True  # stuck before scoring finished — finish it
    if state == STATE_NOT_STARTED:
        return False  # student never began; not force-started here
    timing = att.get_break_timing() if state == STATE_BREAK else att.get_timing()
    if not timing or not timing.is_expired:
        return False
    # remaining_seconds is clamped at 0, so measure lateness via elapsed vs limit.
    return (timing.elapsed_seconds - timing.limit_seconds) >= grace_seconds


def drain(att) -> None:
    """Fast-forward a stranded attempt to SCORING (or as far as the state machine allows).

    Bounded loop — the linear chain E1→E2→BREAK→M1→M2→SCORING is at most 5 hops.
    """
    for _ in range(8):
        state = att.current_state
        if state == STATE_BREAK:
            if not att.end_break():
                break
            continue
        if state in (STATE_SCORING, STATE_COMPLETED, STATE_ABANDONED, STATE_NOT_STARTED):
            break
        # A submittable module: advance without accepting any late answers.
        if not att.submit_module(answers=None, flagged=None):
            break


def sweep_stranded_mock_attempts(*, grace_minutes: int = DEFAULT_GRACE_MINUTES, dry_run: bool = False) -> dict:
    """Reap every mock attempt whose current phase expired at least ``grace_minutes`` ago.

    Returns ``{"reaped": n, "attempt_ids": [...], "dry_run": bool}``.
    """
    from .tasks import enqueue_mock_scoring

    grace = int(grace_minutes) * 60
    candidate_ids = list(
        MockAttempt.objects.filter(is_completed=False)
        .exclude(current_state=STATE_ABANDONED)
        .values_list("pk", flat=True)
    )

    reaped: list[int] = []
    needs_scoring: list[int] = []
    for att_id in candidate_ids:
        with transaction.atomic():
            att = MockAttempt.objects.select_for_update().select_related("mock").get(pk=att_id)
            if not is_stranded(att, grace):
                continue
            reaped.append(att.pk)
            if dry_run:
                continue
            drain(att)
            if att.current_state == STATE_SCORING:
                needs_scoring.append(att.pk)

    # Enqueue scoring outside the row lock (runs synchronously when no broker).
    for att_id in needs_scoring:
        enqueue_mock_scoring(attempt_id=att_id, request=None)

    if reaped and not dry_run:
        logger.info("mock_attempts_reaped count=%s ids=%s", len(reaped), reaped)
    return {"reaped": len(reaped), "attempt_ids": reaped, "dry_run": bool(dry_run)}
