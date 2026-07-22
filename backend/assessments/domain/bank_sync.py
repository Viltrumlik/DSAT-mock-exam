"""
Assessment → Question Bank sync (the reverse of bank_integration.py).

When a question is authored or edited directly in an assessment, mirror it into the
Question Bank as an APPROVED, student-visible BankQuestion, and link it back via
AssessmentQuestion.bank_question / bank_version. Used by:
  - questionbank `migrate_assessments_to_bank` (one-time bulk seed), and
  - the admin builder create/edit views (live sync).

Loop-safe: a question SOURCED FROM the bank (M4 ``create_question_from_bank``) is never
pushed back — we only ever own rows whose bank ``source_reference`` is this assessment
question. Assessments carry no taxonomy, so we assign a best-guess (category match when
meaningful, else the subject's first domain/skill) and keep the category match as an
advisory suggestion for later correction.
"""
from __future__ import annotations

import logging

from questionbank.dedup import find_duplicate, question_content_hash
from questionbank.models import (
    BankDomain,
    BankSkill,
    Difficulty,
    QuestionStatus,
    QuestionType,
    SourceType,
    Subject,
)
from questionbank.services import create_bank_question, update_bank_question
from questionbank.triage import approve_question, classify_question

from .bank_integration import _IMAGE_FIELDS, _img_name

logger = logging.getLogger(__name__)

# AssessmentQuestion.question_type (lowercase) → bank QuestionType.
_TYPE_MAP = {
    "multiple_choice": QuestionType.MULTIPLE_CHOICE,
    "short_text": QuestionType.SHORT_TEXT,
    "numeric": QuestionType.NUMERIC,
    "boolean": QuestionType.BOOLEAN,
}


def _source_ref(aq) -> str:
    return f"assessments.AssessmentQuestion:{aq.id}"


def _subject_for(aset) -> str:
    return Subject.MATH if aset.subject == "math" else Subject.ENGLISH


def _options_from_aq(aq) -> dict:
    opts = {"A": "", "B": "", "C": "", "D": ""}
    for choice in (aq.choices or []):
        cid = str(choice.get("id", "")).strip().upper()
        if cid in opts:
            opts[cid] = choice.get("text", "") or ""
    return opts


def _match_taxonomy(subject, category):
    """Real (domain, skill) from a 'Domain › Subdomain' category, else (None, None)."""
    if not category:
        return None, None
    parts = [p.strip() for p in str(category).split("›")]
    domain = BankDomain.objects.filter(
        subject=subject, name__iexact=(parts[0] if parts else "")
    ).first()
    skill = None
    if domain and len(parts) > 1:
        skill = BankSkill.objects.filter(domain=domain, name__iexact=parts[1]).first()
    return domain, skill


def _provisional_taxonomy(subject, category):
    """Best-guess (domain, skill, difficulty): category match when meaningful, else the
    subject's first domain + its first skill. Difficulty defaults MEDIUM (none on AQ)."""
    domain, skill = _match_taxonomy(subject, category)
    if domain is None:
        domain = BankDomain.objects.filter(subject=subject).order_by("display_order", "id").first()
    if skill is None and domain is not None:
        skill = BankSkill.objects.filter(domain=domain).order_by("display_order", "id").first()
    return domain, skill, Difficulty.MEDIUM


def _bank_fields(aq) -> dict:
    opts = _options_from_aq(aq)
    fields = dict(
        question_prompt=aq.question_prompt or "",
        option_a=opts["A"], option_b=opts["B"], option_c=opts["C"], option_d=opts["D"],
        correct_answer=aq.correct_answer,
        explanation=aq.explanation or "",
        points=aq.points or 1,
    )
    # Reference image files by storage name (freeze-safe); only set ones present so we
    # never assign None to a non-null ImageField (mirrors backfill_question_bank).
    for f in _IMAGE_FIELDS:
        name = _img_name(getattr(aq, f))
        if name:
            fields[f] = name
    return fields


def sync_assessment_question_to_bank(aq, *, user=None):
    """Create-or-update the linked BankQuestion for an authored assessment question.

    Returns the BankQuestion (or None if it could not be mirrored). Skips questions
    that were sourced FROM the bank — those must never be mutated from the consumer.
    """
    aset = aq.assessment_set
    subject = _subject_for(aset)
    qtype = _TYPE_MAP.get(aq.question_type, QuestionType.MULTIPLE_CHOICE)
    question_text = aq.prompt or ""
    fields = _bank_fields(aq)

    existing = aq.bank_question
    if existing is not None:
        # Only push edits onto rows WE created from this exact assessment question;
        # never mutate a canonical bank question that this AQ was sourced from (M4).
        if existing.source_reference != _source_ref(aq):
            return existing
        update_bank_question(existing, user=user, question_text=question_text, **fields)
        return existing

    # Dedup against the bank: identical content reuses the existing row.
    chash = question_content_hash(
        question_text=question_text,
        options=[fields["option_a"], fields["option_b"], fields["option_c"], fields["option_d"]],
        correct_answer=fields["correct_answer"],
        passage_text="",
    )
    bank = find_duplicate(subject=subject, content_hash=chash)
    if bank is None:
        bank = create_bank_question(
            subject=subject, question_type=qtype, question_text=question_text,
            status=QuestionStatus.IMPORTED, user=user,
            source_type=SourceType.MIGRATED_ASSESSMENT, source_reference=_source_ref(aq),
            **fields,
        )
        domain, skill, difficulty = _provisional_taxonomy(subject, aset.category)
        if domain and skill:
            classify_question(bank, domain=domain, skill=skill, difficulty=difficulty, user=user)
            approve_question(bank, user=user)
        sd, ss = _match_taxonomy(subject, aset.category)
        if sd and not bank.suggestion_model:
            bank.suggested_domain = sd
            bank.suggested_skill = ss
            bank.suggestion_model = "sync:assessment_category"
            bank.suggestion_rationale = f"Synced from assessment set category '{aset.category}'."
            bank.save(update_fields=[
                "suggested_domain", "suggested_skill", "suggestion_model", "suggestion_rationale",
            ])

    aq.bank_question = bank
    aq.save(update_fields=["bank_question"])
    return bank
