"""
AssessmentQuestion ``order`` — **dense only** (0..n-1 per set), with an
``AssessmentSet`` row lock for every mutation.

Mirrors ``exams/question_ordering.py`` (which the exams module already relies on
with its ``UNIQUE(module, order)`` constraint). All writes that assign
``AssessmentQuestion.order`` should go through here so:

  - the parent ``AssessmentSet`` is ``select_for_update()``-locked for the
    duration of the reorder (no two concurrent add/reorder calls race to the
    same ``order`` — the bug that scrambled the "Boundaries" sets), and
  - reassignment uses a large temporary band so a future
    ``UNIQUE(assessment_set, order)`` constraint is never tripped mid-update
    while ``order`` is a ``PositiveIntegerField``.

Ordering is dense across **all** rows in a set (active + inactive) so every row
holds a unique ``order``; delivery still filters ``is_active=True`` downstream.
"""
from __future__ import annotations

from django.apps import apps
from django.db import transaction
from django.db.models import Max

# Must exceed any plausible in-service dense index; only used inside locked txns.
ORDER_TEMP_BASE = 10_000_000


def _sorted_rows(rows: list, key: str) -> list:
    """Return ``rows`` in the canonical sequence chosen by ``key``."""
    if key == "id":
        return sorted(rows, key=lambda q: q.id)
    if key == "created":
        return sorted(rows, key=lambda q: (q.created_at, q.id))
    # "current": the canonical delivery order (order, id) used everywhere else.
    return sorted(rows, key=lambda q: (q.order, q.id))


def _apply_dense(QuestionModel, ordered: list) -> int:
    """
    Persist ``ordered`` as ``order`` = 0..n-1 using a two-phase temp band.
    Returns the number of rows whose ``order`` changed. No-op (0) when already
    dense and in the given sequence — so callers are idempotent.
    """
    if all(q.order == i for i, q in enumerate(ordered)):
        return 0

    # Phase 1: park everything in a unique temp band (PositiveIntegerField-safe).
    for i, q in enumerate(ordered):
        q.order = ORDER_TEMP_BASE + i
    QuestionModel.objects.bulk_update(ordered, ["order"])

    # Phase 2: final dense indices.
    for i, q in enumerate(ordered):
        q.order = i
    QuestionModel.objects.bulk_update(ordered, ["order"])
    return len(ordered)


def dense_compact_set_orders(set_id: int, *, key: str = "current") -> int:
    """
    Collapse a set's question orders to contiguous ``0..n-1`` by ``key``.

    Does **not** lock — callers needing concurrency safety must use
    ``dense_compact_set_orders_locked`` or hold their own set lock.
    """
    QuestionModel = apps.get_model("assessments", "AssessmentQuestion")
    rows = list(QuestionModel.objects.filter(assessment_set_id=set_id))
    return _apply_dense(QuestionModel, _sorted_rows(rows, key))


def dense_compact_set_orders_locked(set_id: int, *, key: str = "current") -> int:
    """Same as ``dense_compact_set_orders`` but under ``select_for_update(set)``."""
    SetModel = apps.get_model("assessments", "AssessmentSet")
    with transaction.atomic():
        SetModel.objects.select_for_update().get(pk=set_id)
        return dense_compact_set_orders(set_id, key=key)


def reindex_set_questions_dense_locked(set_id: int, ordered_ids: list[int]) -> list[int]:
    """
    Persist an explicit question sequence for a set as ``order`` = 0..n-1.

    ``ordered_ids`` need not be exhaustive: any of the set's questions missing
    from it are appended at the end in canonical ``(order, id)`` order, so the
    result is always a complete, unique, dense ordering. Unknown ids are ignored.
    Returns the final ordered id list. Locks the set for the whole reindex.
    """
    QuestionModel = apps.get_model("assessments", "AssessmentQuestion")
    SetModel = apps.get_model("assessments", "AssessmentSet")
    with transaction.atomic():
        SetModel.objects.select_for_update().get(pk=set_id)
        by_id = {q.id: q for q in QuestionModel.objects.filter(assessment_set_id=set_id)}
        seen: set[int] = set()
        ordered: list = []
        for qid in ordered_ids:
            q = by_id.get(int(qid))
            if q is not None and q.id not in seen:
                ordered.append(q)
                seen.add(q.id)
        # Append any not explicitly listed, keeping their relative order stable.
        rest = sorted(
            (q for q in by_id.values() if q.id not in seen),
            key=lambda q: (q.order, q.id),
        )
        ordered.extend(rest)
        _apply_dense(QuestionModel, ordered)
        return [q.id for q in ordered]


def append_order_locked(set_id: int) -> int:
    """
    Lock the set row and return the next append ``order`` (``max+1``, or 0).

    MUST be called inside ``transaction.atomic()`` and the caller MUST perform
    the insert within the SAME transaction so the lock is held through commit —
    otherwise the race this guards against reopens.
    """
    QuestionModel = apps.get_model("assessments", "AssessmentQuestion")
    SetModel = apps.get_model("assessments", "AssessmentSet")
    SetModel.objects.select_for_update().get(pk=set_id)
    mx = (
        QuestionModel.objects.filter(assessment_set_id=set_id)
        .aggregate(Max("order"))
        .get("order__max")
    )
    return int(mx) + 1 if mx is not None else 0


__all__ = [
    "ORDER_TEMP_BASE",
    "dense_compact_set_orders",
    "dense_compact_set_orders_locked",
    "reindex_set_questions_dense_locked",
    "append_order_locked",
]
