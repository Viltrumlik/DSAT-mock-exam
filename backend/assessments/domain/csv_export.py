"""CSV export of assessment questions, mirroring ``csv_import``'s columns.

Same purpose and same contract as ``exams/question_csv_export.py``: a super_admin reads a
whole set and its answer key in a spreadsheet, and the file they get back is one the importer
would accept.

The one place this has to think is ``correct_answer``. On an assessment question it is a
JSONField holding a string, a number, a bool, or a list of acceptable strings — while the CSV
column is a single cell. The importer's own rules decide the encoding: a numeric question
accepts several comma-separated values, a boolean accepts true/false, everything else is the
literal string.
"""

from __future__ import annotations

import csv
import io

from ..models import AssessmentQuestion

EXPORT_HEADERS = [
    "order",
    "question_id",
    "question_type",
    "prompt",
    "question_prompt",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_answer",
    "points",
    "explanation",
    "has_image",
]

_LETTERS = ("A", "B", "C", "D")


def _choice_text(question: AssessmentQuestion, letter: str) -> str:
    """The text of choice ``letter``, matched by its id the way the runner matches it.

    Position is deliberately not used as a fallback: a set whose choices are stored out of
    order would then be exported with its answer key pointing at the wrong option, which is
    the one mistake this file must never make.
    """
    for choice in question.choices or []:
        if isinstance(choice, dict) and str(choice.get("id", "")).strip().upper() == letter:
            return str(choice.get("text", "") or "")
    return ""


def _correct_answer_cell(question: AssessmentQuestion) -> str:
    value = question.correct_answer
    if value is None:
        return ""
    if isinstance(value, bool):
        # Before the numeric branch: in Python a bool IS an int, so testing numbers first
        # would export True as "1" and the importer would read it back as a number.
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        # The importer splits a numeric answer on commas, which is how several acceptable
        # forms of one value ("2/3, 0.667") survive the trip.
        return ", ".join(str(v) for v in value)
    return str(value)


def _has_image(q: AssessmentQuestion) -> bool:
    return any(
        bool(getattr(q, field, None))
        for field in (
            "question_image", "option_a_image", "option_b_image",
            "option_c_image", "option_d_image",
        )
    )


def question_row(q: AssessmentQuestion) -> dict:
    row = {
        "order": q.order,
        "question_id": q.id,
        "question_type": q.question_type,
        "prompt": q.prompt or "",
        "question_prompt": q.question_prompt or "",
        "correct_answer": _correct_answer_cell(q),
        "points": q.points,
        "explanation": q.explanation or "",
        "has_image": "yes" if _has_image(q) else "",
    }
    for letter in _LETTERS:
        row[f"option_{letter.lower()}"] = _choice_text(q, letter)
    return row


def questions_for_set(assessment_set) -> list[AssessmentQuestion]:
    return list(
        AssessmentQuestion.objects.filter(assessment_set=assessment_set).order_by("order", "id")
    )


def write_questions_csv(questions) -> str:
    """BOM-first, so Excel reads it as UTF-8 rather than mojibake."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=EXPORT_HEADERS, extrasaction="ignore")
    writer.writeheader()
    for q in questions:
        writer.writerow(question_row(q))
    return buffer.getvalue()
