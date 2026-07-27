"""
CSV word import for the vocabulary bank.

One row = one word. Two entry points share the parser:

* :func:`import_section_csv` spreads the rows across several sets inside one section,
  bucketed by the ``set`` column.
* :func:`import_set_csv` drops every row into one target set and ignores ``set``.

Ergonomics are lifted from ``exams.question_csv_import``: Excel's UTF-8 BOM is stripped,
headers are normalized, blank spreadsheet rows are skipped, errors are reported against
the source row (the header is row 1), and the write is all-or-nothing — a single bad row
leaves the section exactly as it was.

Columns: ``set,word,definition,part_of_speech,example,synonyms``. Only ``word`` and
``definition`` are required.
"""

from __future__ import annotations

import csv
import io

from django.db import transaction

from .models import VocabSet, VocabSetItem, VocabWord
from .serializers import VocabWordWriteSerializer

# Header row is line 1, so the first data row is line 2.
_FIRST_DATA_ROW = 2

MAX_ROWS = 2000

REQUIRED_HEADERS = ("word", "definition")

_PART_VALUES = {c[0] for c in VocabWord.PART_CHOICES}

# Vocabulary lists are overwhelmingly written with the dictionary abbreviations, so accept
# them rather than silently degrading every row to "other".
_PART_ALIASES = {
    "n": VocabWord.PART_NOUN,
    "n.": VocabWord.PART_NOUN,
    "v": VocabWord.PART_VERB,
    "v.": VocabWord.PART_VERB,
    "vb": VocabWord.PART_VERB,
    "adj": VocabWord.PART_ADJECTIVE,
    "adj.": VocabWord.PART_ADJECTIVE,
    "a": VocabWord.PART_ADJECTIVE,
    "adv": VocabWord.PART_ADVERB,
    "adv.": VocabWord.PART_ADVERB,
    "prep": VocabWord.PART_PREPOSITION,
    "prep.": VocabWord.PART_PREPOSITION,
    "pron": VocabWord.PART_PRONOUN,
    "pron.": VocabWord.PART_PRONOUN,
    "conj": VocabWord.PART_CONJUNCTION,
    "conj.": VocabWord.PART_CONJUNCTION,
    "interj": VocabWord.PART_INTERJECTION,
    "interj.": VocabWord.PART_INTERJECTION,
}


def _norm_key(key: str) -> str:
    return (key or "").strip().lower().replace(" ", "_")


def _word_key(word: str) -> str:
    """Case-folded headword.

    The DB unique constraint is case-SENSITIVE, so matching case-insensitively here is
    strictly safer: it can only ever reuse an existing row, never violate the constraint.
    """
    return (word or "").strip().lower()


def decode_csv(raw: bytes) -> str:
    """Decode CSV bytes, stripping Excel's UTF-8 BOM. Raises ValueError on bad encoding."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError(
            "The file is not valid UTF-8. Re-save it as 'CSV UTF-8' and try again."
        ) from exc


def _split_synonyms(raw: str) -> list[str]:
    text = (raw or "").strip()
    if not text:
        return []
    # ';' is the documented separator; comma-separated lists are common enough in
    # hand-made vocabulary files that we fall back to them when no ';' is present.
    parts = text.split(";") if ";" in text else text.split(",")
    return [p.strip() for p in parts if p.strip()]


def _normalize_part(raw: str) -> str:
    token = (raw or "").strip().lower()
    if token in _PART_VALUES:
        return token
    if token in _PART_ALIASES:
        return _PART_ALIASES[token]
    return _PART_ALIASES.get(token.rstrip("."), VocabWord.PART_OTHER)


def parse_word_rows(raw: bytes) -> list[tuple[int, dict]]:
    """
    Parse CSV bytes into ``(source_row_number, payload)`` pairs.

    The row number is the line in the author's spreadsheet, so skipping blank rows never
    shifts the numbers reported back in the error list.
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
            + ". Required headers: word, definition."
        )

    rows: list[tuple[int, dict]] = []
    for offset, raw_row in enumerate(reader):
        row = {_norm_key(k): (v if v is not None else "") for k, v in raw_row.items()}
        # Skip fully blank rows (trailing newlines / spacer rows in spreadsheets).
        if not any((v or "").strip() for v in row.values()):
            continue
        rows.append(
            (
                offset + _FIRST_DATA_ROW,
                {
                    "set": (row.get("set") or "").strip(),
                    "word": (row.get("word") or "").strip(),
                    "definition": (row.get("definition") or "").strip(),
                    "part_of_speech": _normalize_part(row.get("part_of_speech")),
                    "example": (row.get("example") or "").strip(),
                    "synonyms": _split_synonyms(row.get("synonyms")),
                },
            )
        )
        if len(rows) > MAX_ROWS:
            raise ValueError(
                f"The CSV has more than {MAX_ROWS} word rows. Split it into smaller files."
            )
    return rows


def _row_errors_response(errors: list[dict]) -> dict:
    return {"detail": "Some rows are invalid; nothing was imported.", "errors": errors}


def _validate_rows(rows: list[tuple[int, dict]]) -> tuple[list[tuple[int, dict]], list[dict]]:
    """Run every row through the same serializer the single-word endpoints use."""
    clean: list[tuple[int, dict]] = []
    errors: list[dict] = []
    for row_no, payload in rows:
        ser = VocabWordWriteSerializer(
            data={k: v for k, v in payload.items() if k != "set"}
        )
        if ser.is_valid():
            data = dict(ser.validated_data)
            data["set"] = payload["set"]
            clean.append((row_no, data))
        else:
            errors.append({"row": row_no, "errors": ser.errors})
    return clean, errors


def _set_title_for(value: str, fallback: str) -> str:
    """``12`` → "Set 12"; anything else is used verbatim; blank falls back."""
    v = (value or "").strip()
    if not v:
        return fallback
    return f"Set {v}" if v.isdigit() else v


def _write_plans(section, plans: list[dict]) -> dict:
    """
    Materialize the planned sets, words and links in ONE transaction.

    ``plans`` is an ordered list of ``{"title", "instance", "rows", "next_order"}`` where
    ``instance`` is None for a set that still has to be created.
    """
    created_sets = 0
    created_words = 0
    linked_words = 0
    set_ids: list[int] = []
    word_ids: list[int] = []

    with transaction.atomic():
        # Re-read inside the transaction: another author may have added the same headword
        # to this section between planning and writing.
        section_words = {_word_key(w.word): w for w in section.words.all()}
        next_set_order = section.sets.count()

        for plan in plans:
            vset = plan["instance"]
            if vset is None:
                vset = VocabSet.objects.create(
                    section=section, title=plan["title"], order=next_set_order
                )
                next_set_order += 1
                created_sets += 1
            set_ids.append(vset.pk)

            order = plan["next_order"]
            for _row_no, data in plan["rows"]:
                key = _word_key(data["word"])
                word = section_words.get(key)
                if word is None:
                    word = VocabWord.objects.create(
                        section=section,
                        word=data["word"],
                        definition=data["definition"],
                        part_of_speech=data.get("part_of_speech") or VocabWord.PART_OTHER,
                        example=data.get("example") or "",
                        synonyms=data.get("synonyms") or [],
                    )
                    section_words[key] = word
                    created_words += 1
                else:
                    # The section already teaches this word — link it, do not duplicate it
                    # (and do not overwrite the wording an author may have edited by hand).
                    linked_words += 1
                VocabSetItem.objects.create(vocab_set=vset, word=word, order=order)
                word_ids.append(word.pk)
                order += 1

    return {
        "created_sets": created_sets,
        "created_words": created_words,
        "linked_words": linked_words,
        "set_ids": set_ids,
        "word_ids": word_ids,
    }


def import_section_csv(*, section, raw_bytes: bytes) -> tuple[dict | None, dict | None]:
    """
    Import a whole section's worth of words, bucketed into sets by the ``set`` column.

    Returns ``(result, None)`` on success or ``(None, error)`` on failure — the caller
    returns the error dict with HTTP 400. Nothing is written unless every row passes.
    """
    try:
        rows = parse_word_rows(raw_bytes)
    except ValueError as exc:
        return None, {"detail": str(exc)}
    if not rows:
        return None, {"detail": "The CSV has no word rows."}

    clean, errors = _validate_rows(rows)
    if errors:
        return None, _row_errors_response(errors)

    existing_sets = {s.title.strip().lower(): s for s in section.sets.all()}
    # Rows that name no set share one bucket; it continues the section's own numbering.
    fallback_title = f"Set {len(existing_sets) + 1}"

    # Keyed by the RESOLVED title, not the raw column value: "1" and "Set 1" both name
    # "Set 1" and must land in one set rather than creating a duplicate.
    plans: dict[str, dict] = {}
    for row_no, data in clean:
        title = _set_title_for(data["set"], fallback_title)
        plan = plans.get(title.strip().lower())
        if plan is None:
            instance = existing_sets.get(title.strip().lower())
            plan = {
                "title": title,
                "instance": instance,
                "rows": [],
                "taken": (
                    {_word_key(i.word.word) for i in instance.items.select_related("word")}
                    if instance is not None
                    else set()
                ),
                "next_order": instance.items.count() if instance is not None else 0,
            }
            plans[title.strip().lower()] = plan

        key = _word_key(data["word"])
        if key in plan["taken"]:
            errors.append({"row": row_no, "errors": {"word": ["Already in this set."]}})
            continue
        plan["taken"].add(key)
        plan["rows"].append((row_no, data))

    if errors:
        return None, _row_errors_response(errors)

    result = _write_plans(section, list(plans.values()))
    return (
        {
            "section_id": section.pk,
            "created_sets": result["created_sets"],
            "created_words": result["created_words"],
            "linked_words": result["linked_words"],
            "set_ids": result["set_ids"],
        },
        None,
    )


def import_set_csv(*, vocab_set, raw_bytes: bytes) -> tuple[dict | None, dict | None]:
    """
    Append every row of the CSV to one target set. A ``set`` column, if present, is
    ignored — the target is the set in the URL.
    """
    try:
        rows = parse_word_rows(raw_bytes)
    except ValueError as exc:
        return None, {"detail": str(exc)}
    if not rows:
        return None, {"detail": "The CSV has no word rows."}

    clean, errors = _validate_rows(rows)
    if errors:
        return None, _row_errors_response(errors)

    taken = {_word_key(i.word.word) for i in vocab_set.items.select_related("word")}
    planned: list[tuple[int, dict]] = []
    for row_no, data in clean:
        key = _word_key(data["word"])
        if key in taken:
            errors.append({"row": row_no, "errors": {"word": ["Already in this set."]}})
            continue
        taken.add(key)
        planned.append((row_no, data))

    if errors:
        return None, _row_errors_response(errors)

    plan = {
        "title": vocab_set.title,
        "instance": vocab_set,
        "rows": planned,
        "next_order": vocab_set.items.count(),
    }
    result = _write_plans(vocab_set.section, [plan])
    return (
        {
            "set_id": vocab_set.pk,
            "created_count": len(result["word_ids"]),
            "word_ids": result["word_ids"],
        },
        None,
    )
