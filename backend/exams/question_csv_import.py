"""
CSV question import for the exams question system (pastpapers, full mocks, and
midterms — all of which store ``exams.Question`` rows on an ``exams.Module``).

One CSV row = one question, appended to a single target Module. This mirrors the
assessments CSV importer (backend/assessments/domain/csv_import.py): a normalized,
case/space/slash-insensitive header parser, per-row validation through the SAME
``AdminQuestionSerializer`` the builder uses (no grading-guard bypass), all-or-nothing
insertion in one transaction, and row-numbered error reporting.

The container (pastpaper module / mock section module / midterm module) is resolved by
the calling view from the URL; this module never lets a row choose its module or order.
"""

from __future__ import annotations

import csv
import io

from django.db import transaction

from .models import Question
from .serializers import AdminQuestionSerializer

# Header row is line 1, so the first data row is line 2.
_FIRST_DATA_ROW = 2

REQUIRED_HEADERS = ("question_text", "correct_answer")

_TYPE_ALIASES = {
    "math": "MATH",
    "reading": "READING",
    "writing": "WRITING",
    "rw": "READING",
    "r&w": "READING",
    "english": "READING",
}

_TRUE_TOKENS = {"1", "true", "t", "yes", "y", "grid", "grid-in", "gridin", "spr"}


def _norm_key(key: str) -> str:
    return (key or "").strip().lower().replace(" ", "_").replace("/", "_")


def decode_csv(raw: bytes) -> str:
    """Decode CSV bytes, stripping Excel's UTF-8 BOM. Raises ValueError on bad encoding."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(
            "The file is not valid UTF-8. Re-save it as 'CSV UTF-8' and try again."
        ) from exc


def parse_question_rows(raw: bytes, *, subject: str) -> list[dict]:
    """
    Parse CSV bytes into a list of ``AdminQuestionSerializer`` payloads.

    ``subject`` is the target module's platform subject ('MATH' | 'READING_WRITING'); it
    only supplies the DEFAULT question_type when a row omits it (MATH modules default to
    MATH; Reading&Writing modules default to READING).
    """
    text = decode_csv(raw)
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("The CSV has no header row.")

    present = {_norm_key(f) for f in reader.fieldnames}
    missing = [h for h in REQUIRED_HEADERS if h not in present]
    if missing:
        raise ValueError(
            "Missing required column(s): "
            + ", ".join(missing)
            + ". Required headers: question_text, correct_answer."
        )

    default_type = "MATH" if str(subject or "").strip().upper() == "MATH" else "READING"

    payloads: list[dict] = []
    for raw_row in reader:
        row = {_norm_key(k): (v if v is not None else "") for k, v in raw_row.items()}
        # Skip fully blank rows (trailing newlines / spacer rows in spreadsheets).
        if not any((v or "").strip() for v in row.values()):
            continue
        payloads.append(_row_to_payload(row, default_type))
    return payloads


def _row_to_payload(row: dict, default_type: str) -> dict:
    qtype_raw = (row.get("question_type") or "").strip()
    if qtype_raw:
        qtype = _TYPE_ALIASES.get(qtype_raw.lower(), qtype_raw.upper())
    else:
        qtype = default_type

    is_math = (row.get("is_math_input") or "").strip().lower() in _TRUE_TOKENS

    payload: dict = {
        "question_type": qtype,
        "question_text": row.get("question_text") or "",
        "question_prompt": row.get("question_prompt") or "",
        "is_math_input": is_math,
        "explanation": row.get("explanation") or "",
    }

    score_raw = (row.get("score") or "").strip()
    if score_raw:
        try:
            payload["score"] = int(float(score_raw))
        except ValueError:
            # Leave the raw value so the serializer's IntegerField reports it per-row.
            payload["score"] = score_raw

    correct = (row.get("correct_answer") or "").strip()
    if is_math:
        # Grid-in: comma-separated acceptable variants, e.g. "2/3, 0.666, 0.667".
        payload["correct_answer"] = correct
    else:
        # Multiple choice: a single letter A-D (uppercased) that must match a filled option.
        payload["correct_answer"] = correct.upper()
        for letter in ("a", "b", "c", "d"):
            payload[f"option_{letter}"] = row.get(f"option_{letter}") or ""
    return payload


def import_questions_csv(
    *,
    module,
    subject: str,
    raw_bytes: bytes,
    cap: int,
    cap_label: str,
) -> tuple[list[int], dict | None]:
    """
    Validate every row through ``AdminQuestionSerializer`` and, only if ALL rows are
    valid and the per-module cap is respected, append them in one transaction.

    Returns ``(created_ids, None)`` on success, or ``([], error_dict)`` on failure —
    caller returns the error dict with HTTP 400. Nothing is written unless every row
    passes (all-or-nothing).
    """
    try:
        payloads = parse_question_rows(raw_bytes, subject=subject)
    except ValueError as exc:
        return [], {"detail": str(exc)}

    if not payloads:
        return [], {"detail": "The CSV has no question rows."}

    validated = []
    errors = []
    for idx, payload in enumerate(payloads):
        # ``bulk_module`` lets validate() resolve the target module (and thus run the SAT
        # type check + content full_clean) without relying on view.kwargs, which do not
        # carry a test_pk for mock/midterm modules.
        ser = AdminQuestionSerializer(data=payload, context={"bulk_module": module})
        if ser.is_valid():
            validated.append(ser)
        else:
            errors.append({"row": idx + _FIRST_DATA_ROW, "errors": ser.errors})

    if errors:
        return [], {
            "detail": "Some rows are invalid; nothing was imported.",
            "errors": errors,
        }

    current = Question.objects.filter(module_id=module.pk).count()
    if current + len(validated) > cap:
        return [], {
            "detail": (
                f"{cap_label} can hold at most {cap} questions — it already has "
                f"{current} and this CSV adds {len(validated)}. Nothing was imported."
            )
        }

    created_ids: list[int] = []
    with transaction.atomic():
        order = current
        for ser in validated:
            q = ser.save(module=module, order=order)
            created_ids.append(q.id)
            order += 1
    return created_ids, None
