"""
Question Bank services — the ONLY supported way to create questions and mutate
their content.

Why centralise here:
  - qb_id allocation and content_hash must always move together. Scattered writes
    would let them drift.
  - Questions are a LIVE single source of truth: an edit updates the row in place
    and propagates to every consumer (see assessments.domain.bank_integration).
    There is no version chain.
"""
from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import (
    BankQuestion,
    QuestionStatus,
    Subject,
)
from .qb_id import allocate_qb_id


# ──────────────────────────────────────────────────────────────────────────────
# Canonical payload — the basis for content_hash (dedup).
# ──────────────────────────────────────────────────────────────────────────────
def _image_ref(field) -> str | None:
    """Stable string reference to an ImageField for snapshots (name, not URL)."""
    try:
        return field.name or None
    except ValueError:
        return None


def build_content_payload(q: BankQuestion) -> dict[str, Any]:
    """The graded/rendered content of a question, independent of DB identity."""
    passage_text = q.passage.passage_text if q.passage_id else ""
    return {
        "subject": q.subject,
        "question_type": q.question_type,
        "passage_text": passage_text,
        "question_text": q.question_text,
        "question_prompt": q.question_prompt,
        "options": {
            "A": q.option_a,
            "B": q.option_b,
            "C": q.option_c,
            "D": q.option_d,
        },
        "option_images": {
            "A": _image_ref(q.option_a_image),
            "B": _image_ref(q.option_b_image),
            "C": _image_ref(q.option_c_image),
            "D": _image_ref(q.option_d_image),
        },
        "question_image": _image_ref(q.question_image),
        "correct_answer": q.correct_answer,
        "explanation": q.explanation,
        "points": q.points,
    }


def compute_content_hash(q: BankQuestion) -> str:
    from .dedup import question_content_hash

    payload = build_content_payload(q)
    return question_content_hash(
        question_text=payload["question_text"],
        options=list(payload["options"].values()),
        correct_answer=payload["correct_answer"],
        passage_text=payload["passage_text"],
    )


# ──────────────────────────────────────────────────────────────────────────────
# Creation
# ──────────────────────────────────────────────────────────────────────────────
@transaction.atomic
def create_bank_question(
    *,
    subject: str,
    question_type: str,
    question_text: str,
    status: str = QuestionStatus.TRIAGE,
    user=None,
    **fields: Any,
) -> BankQuestion:
    """
    Create a BankQuestion with an allocated permanent qb_id and compute its
    content_hash.

    Taxonomy (domain/skill/difficulty) is intentionally NOT defaulted here — a
    migrated/imported question lands UNCLASSIFIED unless a human passes it.
    """
    if subject not in Subject.values:
        raise ValueError(f"Unknown subject: {subject!r}")

    # Cross-question external_id uniqueness (friendly error before the DB constraint).
    external_id = (fields.get("external_id") or "").strip()
    if external_id and BankQuestion.objects.filter(external_id=external_id).exists():
        existing = BankQuestion.objects.filter(external_id=external_id).first()
        raise ValidationError(
            f"external_id {external_id!r} already exists in the bank ({existing.qb_id})."
        )

    q = BankQuestion(
        qb_id=allocate_qb_id(subject),
        subject=subject,
        question_type=question_type,
        question_text=question_text,
        status=status,
        created_by=user,
        **fields,
    )
    q.content_hash = compute_content_hash(q)
    q.save()
    return q


@transaction.atomic
def update_bank_question(q: BankQuestion, *, user=None, **fields: Any) -> BankQuestion:
    """
    Apply edits to a live BankQuestion in place and recompute content_hash.
    **Status is preserved** — editing an APPROVED question keeps it APPROVED.
    Status transitions go through triage.py, not here. The question is a live
    single source of truth: the edit propagates to every consumer at the API
    boundary (assessments.domain.bank_integration.propagate_bank_question_to_consumers).
    """
    new_ext = fields.get("external_id")
    if new_ext is not None:
        new_ext = new_ext.strip()
        if new_ext and BankQuestion.objects.filter(external_id=new_ext).exclude(pk=q.pk).exists():
            existing = BankQuestion.objects.filter(external_id=new_ext).exclude(pk=q.pk).first()
            raise ValidationError(
                f"external_id {new_ext!r} already exists in the bank ({existing.qb_id})."
            )
        fields["external_id"] = new_ext

    for field, value in fields.items():
        setattr(q, field, value)
    q.content_hash = compute_content_hash(q)
    q.save()
    return q
