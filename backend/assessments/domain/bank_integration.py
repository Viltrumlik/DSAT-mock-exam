"""
Question Bank → Assessment Builder integration (ASSESSMENTS ONLY).

This module lets the builder create an AssessmentQuestion FROM an APPROVED bank
question (copying content + recording a ``bank_question`` link), and pushes a
later Question Bank edit back onto every linked AssessmentQuestion
(``propagate_bank_question_to_consumers``) — the bank question is the live single
source of truth, not a frozen copy.

GATE: only status=APPROVED bank questions may be added. TRIAGE/IMPORTED/REJECTED/
ARCHIVED are never selectable.
"""
from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from questionbank.models import BankQuestion, QuestionStatus, QuestionType

# Bank question_type -> AssessmentQuestion.question_type
_TYPE_MAP = {
    QuestionType.MULTIPLE_CHOICE: "multiple_choice",
    QuestionType.STUDENT_PRODUCED: "numeric",
    QuestionType.NUMERIC: "numeric",
    QuestionType.SHORT_TEXT: "short_text",
    QuestionType.BOOLEAN: "boolean",
}

# Bank ImageField -> AssessmentQuestion ImageField (same names on both models).
_IMAGE_FIELDS = (
    "question_image",
    "option_a_image",
    "option_b_image",
    "option_c_image",
    "option_d_image",
)


def _img_name(field) -> str | None:
    """Storage key of an ImageField (references the same file), or None if unset."""
    return field.name if field else None


def _choices_from_bank(bank: BankQuestion) -> list[dict]:
    choices = []
    for letter in ("A", "B", "C", "D"):
        text = getattr(bank, f"option_{letter.lower()}") or ""
        if text.strip():
            choices.append({"id": letter, "text": text})
    return choices


def create_question_from_bank(assessment_set, bank_question: BankQuestion):
    """
    Create a new AssessmentQuestion in ``assessment_set`` sourced from an APPROVED
    bank question. Returns the new AssessmentQuestion.

    The content is copied and the row records ``bank_question`` for provenance +
    live propagation: a later Question Bank edit flows back onto this row via
    ``propagate_bank_question_to_consumers`` (single source of truth).
    """
    # Local import avoids any import cycle with assessments.models.
    from assessments.models import AssessmentQuestion

    if bank_question.status != QuestionStatus.APPROVED:
        raise ValidationError(
            f"Question {bank_question.qb_id} is not APPROVED (status={bank_question.status}); "
            "only approved Question Bank questions can be added to an assessment."
        )

    # Reference the bank's image files by storage name on the new AssessmentQuestion
    # row (django-cleanup is absent so the referenced file is never deleted).
    image_fields = {f: _img_name(getattr(bank_question, f)) for f in _IMAGE_FIELDS}

    # Order is server-owned: ALWAYS append under a set row-lock held through the
    # insert, so concurrent bank-adds can never race to the same order value (the
    # defect that scrambled the Boundaries sets) and a caller can never supply a
    # colliding order that would trip UNIQUE(assessment_set, order). See
    # domain/question_ordering.py.
    from .question_ordering import append_order_locked

    with transaction.atomic():
        order = append_order_locked(assessment_set.pk)
        return AssessmentQuestion.objects.create(
            assessment_set=assessment_set,
            order=order,
            prompt=bank_question.question_text,
            question_prompt=bank_question.question_prompt or "",
            question_type=_TYPE_MAP.get(bank_question.question_type, "multiple_choice"),
            choices=_choices_from_bank(bank_question),
            correct_answer=bank_question.correct_answer,
            points=bank_question.points or 1,
            explanation=bank_question.explanation or "",
            is_active=True,
            bank_question=bank_question,
            **image_fields,
        )


def _apply_bank_content(aq, bank_question) -> None:
    """Overwrite an AssessmentQuestion's content from its linked bank question."""
    aq.prompt = bank_question.question_text
    aq.question_prompt = bank_question.question_prompt or ""
    aq.question_type = _TYPE_MAP.get(bank_question.question_type, aq.question_type)
    aq.choices = _choices_from_bank(bank_question)
    aq.correct_answer = bank_question.correct_answer
    aq.points = bank_question.points or 1
    aq.explanation = bank_question.explanation or ""
    for f in _IMAGE_FIELDS:
        setattr(aq, f, _img_name(getattr(bank_question, f)))
    aq.save(
        update_fields=[
            "prompt", "question_prompt", "question_type", "choices",
            "correct_answer", "points", "explanation", *_IMAGE_FIELDS, "updated_at",
        ]
    )


def propagate_bank_question_to_consumers(bank_question) -> int:
    """Push a bank question's current content onto EVERY AssessmentQuestion linked to it.

    This is the live shared-reference behaviour: editing a question in the Question Bank
    updates it everywhere it is used, instead of leaving each consumer as a frozen copy.
    Called at the QB edit boundary (see questionbank.views.BankQuestionDetailView). The
    assessment→bank mirror (domain/bank_sync.py) writes bank rows directly via the service
    layer, not through that view, so there is no echo loop. Returns rows updated.
    """
    # Local import: assessments already depends on questionbank, and this keeps the
    # reverse edge (questionbank calling assessments) off the module-load path.
    from assessments.models import AssessmentQuestion

    updated = 0
    with transaction.atomic():
        for aq in AssessmentQuestion.objects.filter(bank_question=bank_question):
            _apply_bank_content(aq, bank_question)
            updated += 1
    return updated


def selectable_bank_questions(*, subject: str | None = None, domain_id=None, skill_id=None,
                              difficulty: str | None = None, search: str | None = None):
    """APPROVED-only queryset for the builder's 'Select From Question Bank' picker."""
    qs = BankQuestion.objects.approved().select_related("domain", "skill")
    if subject:
        qs = qs.filter(subject=subject)
    if domain_id:
        qs = qs.filter(domain_id=domain_id)
    if skill_id:
        qs = qs.filter(skill_id=skill_id)
    if difficulty:
        qs = qs.filter(difficulty=difficulty)
    if search:
        qs = qs.filter(Q(question_text__icontains=search) | Q(qb_id__icontains=search))
    return qs
