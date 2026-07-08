"""Live sync: legacy ``exams.MockExam(kind=MIDTERM)`` → new ``midterms.Midterm``.

The legacy Questions-console builder (``/builder/midterms``) still authors midterms into
``exams.MockExam``. The *separated* runtime — teacher standalone area, student runner,
scorer, certificates — reads ``midterms.Midterm``. Without a bridge, a midterm published
in the builder never reaches the new tables (the one-shot ``migrate_midterms_to_new_tables``
command only moves what already existed).

This module mirrors the **definition + questions** of a legacy midterm into the new tables
on publish/unpublish/delete, so builder-authored midterms appear in the new teacher area.
It never touches attempt/cert/grant data (those are migrated once), and it refuses to
rebuild questions once any attempt exists — attempt answers key on ``Question.id``, so a
delete+recreate would orphan them.

Idempotent on ``Midterm.legacy_mock_exam_id`` (unique). Safe to call inside a request path;
callers wrap it so a mirror failure never breaks the legacy publish itself.
"""

from __future__ import annotations

# exams.Question content fields copied verbatim onto the mirror's question rows.
# Kept in lock-step with migrate_midterms_to_new_tables._QUESTION_FIELDS.
_QUESTION_FIELDS = [
    "question_type", "question_text", "question_prompt", "question_image",
    "option_a", "option_b", "option_c", "option_d",
    "option_a_image", "option_b_image", "option_c_image", "option_d_image",
    "correct_answers", "is_math_input", "score", "explanation",
]


def _is_legacy_midterm(mock) -> bool:
    from exams.models import MockExam

    return getattr(mock, "kind", None) == MockExam.KIND_MIDTERM


def upsert_midterm_from_legacy(mock, *, sync_questions: bool = True):
    """Create or refresh the ``midterms.Midterm`` mirror of a legacy midterm MockExam.

    Returns the mirror ``Midterm`` (or ``None`` when ``mock`` is not a midterm). Refreshes
    the definition (title/subject/scale/timing/publish state) every call. Rebuilds the
    owned question module from the legacy sections only when ``sync_questions`` is set AND
    the mirror has no attempts yet.
    """
    if not _is_legacy_midterm(mock):
        return None

    from exams.models import Module, Question
    from .models import Midterm, MidtermAttempt

    m1 = int(getattr(mock, "midterm_module1_minutes", 60) or 60)
    m2 = int(getattr(mock, "midterm_module2_minutes", 60) or 60)
    count = int(getattr(mock, "midterm_module_count", 1) or 1)
    duration = max(1, m1 + (m2 if count >= 2 else 0))

    midterm, _created = Midterm.objects.get_or_create(
        legacy_mock_exam_id=mock.id,
        defaults={
            "title": mock.title,
            "subject": getattr(mock, "midterm_subject", None) or Midterm.READING_WRITING,
            "scoring_scale": getattr(mock, "midterm_scoring_scale", None) or Midterm.SCALE_100,
            "duration_minutes": duration,
            "question_limit": int(getattr(mock, "midterm_module_question_limit", 30) or 30),
            "is_published": bool(getattr(mock, "is_published", False)),
            "published_at": getattr(mock, "published_at", None),
        },
    )

    # Refresh the definition from the legacy source of truth on every sync.
    midterm.title = mock.title
    midterm.subject = getattr(mock, "midterm_subject", None) or midterm.subject
    midterm.scoring_scale = getattr(mock, "midterm_scoring_scale", None) or midterm.scoring_scale
    midterm.duration_minutes = duration
    midterm.question_limit = int(getattr(mock, "midterm_module_question_limit", 30) or 30)
    midterm.is_published = bool(getattr(mock, "is_published", False))
    midterm.published_at = getattr(mock, "published_at", None)

    if not midterm.question_module_id:
        module = Module.objects.create(
            practice_test=None, module_order=1, time_limit_minutes=duration
        )
        midterm.question_module = module
    else:
        module = midterm.question_module
        if module.time_limit_minutes != duration:
            module.time_limit_minutes = duration
            module.save(update_fields=["time_limit_minutes"])
    midterm.save()

    # Rebuild questions from the legacy sections — but NEVER once an attempt exists
    # (answers key on Question.id; a rebuild would orphan them).
    if sync_questions and not MidtermAttempt.objects.filter(midterm=midterm).exists():
        Question.objects.filter(module_id=module.id).delete()
        order = 0
        for section in mock.tests.all().order_by("id"):
            for src_mod in section.modules.all().order_by("module_order"):
                for src_q in src_mod.questions.all().order_by("order", "id"):
                    fields = {f: getattr(src_q, f) for f in _QUESTION_FIELDS}
                    Question.objects.create(module=module, order=order, **fields)
                    order += 1

    return midterm


def unpublish_midterm_mirror(mock) -> None:
    """Hide the mirror when the legacy midterm is unpublished."""
    if not _is_legacy_midterm(mock):
        return
    from .models import Midterm

    Midterm.objects.filter(legacy_mock_exam_id=mock.id).update(
        is_published=False, published_at=None
    )


def delete_midterm_mirror(mock) -> None:
    """Remove the mirror when the legacy midterm is deleted.

    If the mirror already has attempts, its results/certificates must survive — so it is
    merely unpublished (hidden from the teacher catalog) rather than deleted.
    """
    if not _is_legacy_midterm(mock):
        return
    from .models import Midterm, MidtermAttempt

    for mt in Midterm.objects.filter(legacy_mock_exam_id=mock.id):
        if MidtermAttempt.objects.filter(midterm=mt).exists():
            Midterm.objects.filter(pk=mt.pk).update(is_published=False, published_at=None)
        else:
            mt.delete()
