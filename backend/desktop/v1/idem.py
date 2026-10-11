"""v1 idempotency: one key means one outcome, a 5xx is never remembered, and a replay always
carries a FRESH attempt summary.

Why not the legacy helpers (``exams.idempotency`` / ``midterms.idempotency``):

* they store the whole response — so a replay hands back the timer as it stood when the key
  was first used, minutes stale;
* they store 500s too, so a request that failed once fails forever under that key (0.1.0
  works around it by minting ``.r{n}`` keys).

v1 stores only ``{"outcome": {...}}`` and the status, only when the status is below 500, in the
same tables (``AttemptIdempotencyKey`` / ``MidtermAttemptIdempotencyKey``) under endpoint names
``v1.start``, ``v1.sync``, ``v1.submit``, ``v1.offscreen`` — no migration. The view renders the
response from the outcome, both the first time and on every replay, so the two can never drift.

The attempt row is locked before the key is looked up and stays locked until the outcome is
stored, so two copies of one request (a retry racing its lost original) run one after the
other: the second finds the first's outcome instead of applying a second strike or a second
submit. Work that must happen after the commit (enqueueing scoring) is returned as
``after_commit`` and run once the transaction is closed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable

from django.db import IntegrityError, transaction
from django.utils import timezone

from exams.idempotency import idempotency_ttl_seconds_for_attempt as _pastpaper_ttl
from exams.models import AttemptIdempotencyKey, TestAttempt
from midterms.idempotency import idempotency_ttl_seconds_for_attempt as _midterm_ttl
from midterms.models import MidtermAttempt, MidtermAttemptIdempotencyKey

logger = logging.getLogger(__name__)

ENDPOINT_START = "v1.start"
ENDPOINT_SYNC = "v1.sync"
ENDPOINT_SUBMIT = "v1.submit"
ENDPOINT_OFFSCREEN = "v1.offscreen"


@dataclass
class Outcome:
    """What a write decided. ``body`` is the endpoint's own fields (never the attempt)."""

    status: int = 200
    body: dict = field(default_factory=dict)
    #: False for answers that must not be replayed even below 500 (a lost race the client
    #: should simply retry).
    store: bool = True
    after_commit: list[Callable[[], None]] = field(default_factory=list)
    replayed: bool = False


def _table_for(attempt):
    if isinstance(attempt, MidtermAttempt):
        return MidtermAttemptIdempotencyKey, _midterm_ttl(attempt)
    return AttemptIdempotencyKey, _pastpaper_ttl(attempt)


def _lock(attempt):
    """Re-read the attempt under a row lock — only the attempt row (``of=self``), never a
    joined row: a joined midterm row would serialize every student of that midterm."""
    model = type(attempt)
    qs = model.objects.select_for_update(of=("self",))
    if model is MidtermAttempt:
        qs = qs.select_related("midterm")
    return qs.get(pk=attempt.pk)


def run(*, attempt, endpoint: str, key: str, compute: Callable[[object], Outcome]) -> Outcome:
    """Replay ``key``'s stored outcome, or lock the attempt, ``compute(locked)``, and store it.

    ``compute`` receives the locked attempt. Its ``after_commit`` callables run after the
    transaction, and only for a fresh outcome.
    """
    table, ttl = _table_for(attempt)
    now = timezone.now()
    with transaction.atomic():
        locked = _lock(attempt)
        row = table.objects.filter(attempt_id=locked.pk, endpoint=endpoint, key=key).first()
        if row is not None and row.expires_at and row.expires_at > now:
            stored = row.response_json if isinstance(row.response_json, dict) else {}
            outcome = Outcome(
                status=int(row.response_status or 200),
                body=dict(stored.get("outcome") or {}),
                replayed=True,
            )
            return outcome
        outcome = compute(locked)
        if outcome.store and outcome.status < 500:
            values = {
                "response_status": int(outcome.status),
                "response_json": {"outcome": outcome.body},
                "expires_at": now + timezone.timedelta(seconds=int(ttl)),
            }
            try:
                with transaction.atomic():
                    if row is not None:
                        # An expired row under the same key: reuse it (the key is unique).
                        table.objects.filter(pk=row.pk).update(**values)
                    else:
                        table.objects.create(attempt_id=locked.pk, endpoint=endpoint, key=key, **values)
            except IntegrityError:  # pragma: no cover - the row lock above makes this a no-op race
                logger.warning("desktop_v1_idem_store_race endpoint=%s attempt_id=%s", endpoint, locked.pk)
    for job in outcome.after_commit:
        try:
            job()
        except Exception:  # pragma: no cover - scoring is retried by the sweep; never 500 a hand-in
            logger.exception("desktop_v1_after_commit_failed endpoint=%s attempt_id=%s", endpoint, attempt.pk)
    return outcome


def is_pastpaper(attempt) -> bool:
    return isinstance(attempt, TestAttempt)
