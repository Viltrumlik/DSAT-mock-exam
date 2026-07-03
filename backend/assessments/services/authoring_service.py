"""
Authoring workflows for assessment questions.

Every write that assigns ``AssessmentQuestion.order`` goes through here so the
parent ``AssessmentSet`` is row-locked for the duration — no two concurrent
add/reorder calls can race to the same ``order`` value (the defect that
scrambled the "Boundaries" sets). See ``domain/question_ordering.py``.
"""
from __future__ import annotations

from django.db import transaction

from ..domain.question_ordering import (
    append_order_locked,
    reindex_set_questions_dense_locked,
)


def create_question(assessment_set, serializer):
    """
    Persist a validated question, assigning the next append ``order`` under a
    set row-lock held through the insert (so ``max(order)+1`` stays unique).

    ``serializer`` must already have passed ``is_valid()``. ``assessment_set``
    and ``order`` are injected here — the serializer treats both as read-only, so
    a stale client that still sends ``order`` can neither collide nor override.
    """
    with transaction.atomic():
        order = append_order_locked(assessment_set.pk)
        return serializer.save(assessment_set=assessment_set, order=order)


def reorder_questions(set_id: int, ordered_ids: list[int]) -> list[int]:
    """
    Atomically persist a full question ordering for a set as dense ``0..n-1``.

    Ids not listed are appended in canonical order; unknown ids are ignored.
    Returns the server's canonical ordered id list. Replaces the builder's old
    N-PATCH drag loop, which left duplicate/gapped orders if a request failed
    midway.
    """
    return reindex_set_questions_dense_locked(set_id, ordered_ids)
