"""CSV import for assessment questions.

One CSV row = one question. The header row names the columns (case- and
space-insensitive). Recognised columns:

    question_type    multiple_choice | short_text | numeric | boolean
                     (aliases accepted: mcq, mc; text, sa; spr, grid-in, number; tf, true/false)
    prompt           the PRIMARY block, rendered FIRST/at the top          (required)
                     · Math: the question itself.
                     · Reading: the passage / stimulus.
    question_prompt  optional secondary block rendered AFTER `prompt`, right
                     above the choices. For a reading question this is the
                     ACTUAL QUESTION (e.g. "Based on the text, why…?"); leave
                     blank when `prompt` already is the question.
    option_a..d      multiple-choice choice text (blank options are skipped);
                     assembled into choices [{"id": "A", "text": ...}]
    correct_answer   MCQ: the correct choice letter (A/B/C/D);
                     numeric: a value or several comma-separated acceptable values ("10.25, 21/2");
                     boolean: true / false;
                     short_text: the accepted string
    points           optional integer points (default 1)
    explanation      optional answer explanation

Text-only — images are not importable via CSV (see the RUNBOOK). Every row is
turned into a payload and handed to AssessmentQuestionAdminWriteSerializer, so
all the type-specific correct_answer guards (fraction denominators, MCQ letter
must match a choice id, boolean coercion) apply exactly as in the builder UI.
"""

from __future__ import annotations

import csv
import io

# Alias → canonical AssessmentQuestion.TYPE_* value.
_TYPE_ALIASES = {
    "multiple_choice": "multiple_choice",
    "multiplechoice": "multiple_choice",
    "mcq": "multiple_choice",
    "mc": "multiple_choice",
    "choice": "multiple_choice",
    "short_text": "short_text",
    "shorttext": "short_text",
    "text": "short_text",
    "sa": "short_text",
    "numeric": "numeric",
    "spr": "numeric",
    "gridin": "numeric",
    "grid_in": "numeric",
    "number": "numeric",
    "boolean": "boolean",
    "bool": "boolean",
    "tf": "boolean",
    "true_false": "boolean",
    "truefalse": "boolean",
}

REQUIRED_HEADERS = ("prompt", "question_type", "correct_answer")


def _norm_key(k: str) -> str:
    return (k or "").strip().lower().replace(" ", "_").replace("/", "_")


def decode_csv(raw: bytes | str) -> str:
    """Decode uploaded bytes as UTF-8, stripping the BOM Excel prepends."""
    if isinstance(raw, bytes):
        return raw.decode("utf-8-sig")
    return raw


def _row_to_payload(norm_row: dict) -> dict:
    def g(key: str) -> str:
        v = norm_row.get(key)
        return str(v).strip() if v is not None else ""

    qtype_raw = _norm_key(g("question_type"))
    qtype = _TYPE_ALIASES.get(qtype_raw, qtype_raw)

    payload: dict = {
        "prompt": g("prompt"),
        "question_prompt": g("question_prompt"),
        "question_type": qtype,
        "explanation": g("explanation"),
    }

    points = g("points")
    if points:
        try:
            payload["points"] = int(float(points))
        except ValueError:
            payload["points"] = points  # let the serializer/field reject it precisely

    correct = g("correct_answer")
    if qtype == "multiple_choice":
        choices = []
        for letter in ("a", "b", "c", "d"):
            text = g(f"option_{letter}")
            if text:
                choices.append({"id": letter.upper(), "text": text})
        payload["choices"] = choices
        # Choice ids are stored uppercase A–D; normalise so "b" still matches "B".
        payload["correct_answer"] = correct.upper()
    elif qtype == "boolean":
        payload["choices"] = []
        payload["correct_answer"] = correct.lower()
    else:  # numeric, short_text, or an unknown type (serializer will reject unknown)
        payload["choices"] = []
        payload["correct_answer"] = correct

    return payload


def _is_blank_row(norm_row: dict) -> bool:
    return not any(str(v or "").strip() for v in norm_row.values())


def parse_rows(text: str) -> list[dict]:
    """Parse CSV text into a list of question payloads.

    Raises ValueError with a human-readable message if the header is missing a
    required column or the file has no header at all.
    """
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("The CSV is empty or has no header row.")

    header_keys = {_norm_key(h) for h in reader.fieldnames if h}
    missing = [h for h in REQUIRED_HEADERS if h not in header_keys]
    if missing:
        raise ValueError(
            "The CSV header is missing required column(s): "
            + ", ".join(missing)
            + ". Expected at least: prompt, question_type, correct_answer."
        )

    payloads: list[dict] = []
    for raw_row in reader:
        norm_row = {_norm_key(k): v for k, v in raw_row.items() if k is not None}
        if _is_blank_row(norm_row):
            continue
        payloads.append(_row_to_payload(norm_row))
    return payloads
