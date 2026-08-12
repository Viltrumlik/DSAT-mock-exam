"""CSV export of exam questions — pastpapers, midterms, full mocks, practice tests.

The point of the file is review: a super_admin wants to read a whole test's questions and
answer key side by side, in a spreadsheet, rather than clicking through the builder one
question at a time.

**The columns are the importer's columns.** ``question_csv_import.REQUIRED_HEADERS`` and
``_row_to_payload`` define what a row means; this writes exactly those names so a downloaded
file can be edited and imported back. Note ``correct_answer`` singular — the model field is
``correct_answers``, the CSV column has always been singular, and matching the model here
would produce a file the importer silently drops the answer key from.

The extra leading columns (module / order / question_id) are review scaffolding. The importer
reads only the keys it knows and ignores the rest, so they cost the round-trip nothing.

``has_image`` is a warning, not data: images cannot travel in a CSV, so a row marked ``yes``
would come back through the importer without its figure.
"""

from __future__ import annotations

import csv
import io

from .models import Question

#: Column order is the reading order of a question, not the model's field order: what is
#: asked, then the choices, then the answer.
EXPORT_HEADERS = [
    "module",
    "order",
    "question_id",
    "question_type",
    "question_text",
    "question_prompt",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_answer",
    "is_math_input",
    "score",
    "explanation",
    "skill",
    "has_image",
]


_SUBJECT_LABELS = {"READING_WRITING": "Reading & Writing", "MATH": "Math"}


def _subject_label(subject: str) -> str:
    raw = (subject or "").strip().upper()
    return _SUBJECT_LABELS.get(raw, raw.replace("_", " ").title())


def _mock_section_labels(module_ids) -> dict[int, str]:
    """Module labels for the modules a full mock owns.

    A mock's four modules hang off ``MockSection.module1/module2`` with
    ``practice_test=None``, so the subject cannot be read the way it is for a pastpaper.
    Without this, all four export as "Module 1"/"Module 2" and a reviewer cannot tell the
    English Module 1 from the Math one — in a file whose whole job is being read.

    Imported inside the function on purpose: ``mocks`` imports from ``exams``, and a
    module-level import here would close the cycle. This is a display label, so the lazy
    import costs nothing real.
    """
    from django.db.models import Q

    from mocks.models import MockSection

    ids = list(module_ids)
    if not ids:
        return {}
    labels: dict[int, str] = {}
    for section in MockSection.objects.filter(
        Q(module1_id__in=ids) | Q(module2_id__in=ids)
    ):
        subject = _subject_label(section.subject)
        if section.module1_id:
            labels[section.module1_id] = f"{subject} · Module 1"
        if section.module2_id:
            labels[section.module2_id] = f"{subject} · Module 2"
    return labels


def _module_label(module) -> str:
    """How a reviewer names the module in conversation, e.g. "Math · Module 2"."""
    if module is None:
        return ""
    test = getattr(module, "practice_test", None)
    subject = _subject_label(getattr(test, "subject", "") or "")
    order = getattr(module, "module_order", None)
    parts = [p for p in (subject, f"Module {order}" if order is not None else "") if p]
    return " · ".join(parts) or (getattr(test, "title", "") or "")


def _has_image(q: Question) -> bool:
    return any(
        bool(getattr(q, field, None))
        for field in (
            "question_image", "option_a_image", "option_b_image",
            "option_c_image", "option_d_image",
        )
    )


def question_row(q: Question, *, module_label: str | None = None) -> dict:
    return {
        "module": module_label if module_label is not None else _module_label(q.module),
        "order": q.order,
        "question_id": q.id,
        "question_type": q.question_type,
        "question_text": q.question_text or "",
        "question_prompt": q.question_prompt or "",
        "option_a": q.option_a or "",
        "option_b": q.option_b or "",
        "option_c": q.option_c or "",
        "option_d": q.option_d or "",
        "correct_answer": q.correct_answers or "",
        # The importer's truthy tokens include "true"/"1"/"yes"; "" reads as false. Written
        # as the word rather than a bare 1/0 so the file is readable as a document.
        "is_math_input": "true" if q.is_math_input else "",
        "score": q.score,
        "explanation": q.explanation or "",
        # The importer resolves a skill by name OR stable code, so the name round-trips.
        "skill": q.skill.name if q.skill_id else "",
        "has_image": "yes" if _has_image(q) else "",
    }


def questions_for_modules(module_ids) -> list[Question]:
    """Every question on the given modules, in the order a reader expects them."""
    return list(
        Question.objects.filter(module_id__in=list(module_ids))
        .select_related("module", "module__practice_test", "skill")
        .order_by("module__practice_test__id", "module__module_order", "order", "id")
    )


def write_questions_csv(questions) -> str:
    """The CSV text for these questions, BOM-first.

    ``utf-8-sig``'s BOM is what makes Excel read the file as UTF-8; without it a Cyrillic or
    typographic-quote question opens as mojibake, and this exists to be read.
    """
    questions = list(questions)
    # One query for the whole file, not one per row: a mock's modules need their subject
    # looked up through MockSection, and a 4×27-question mock would otherwise do it 108
    # times.
    mock_labels = _mock_section_labels(
        [q.module_id for q in questions if q.module_id and q.module.practice_test_id is None]
    )

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=EXPORT_HEADERS, extrasaction="ignore")
    writer.writeheader()
    for q in questions:
        writer.writerow(question_row(q, module_label=mock_labels.get(q.module_id)))
    return buffer.getvalue()
