"""Question content as v1 ships it: the website's question fields, image KEYS instead of signed
URLs, a 1-based ``order``, and a ``content_hash`` per module so the app can skip what it has.

Never the answer key: ``correct_answers`` and ``explanation`` stay out, exactly as the
website's ``QuestionSerializer`` leaves them out.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Iterable

from exams.models import Question

_OPTION_SLOTS = Question._OPTION_SLOTS  # (("option_a", "option_a_image", "A"), …)


def _image_key(field_file) -> str | None:
    """The storage key of an image field ("question_images/a.png"), never a URL."""
    name = getattr(field_file, "name", None) if field_file else None
    return str(name) if name else None


def question_payload(question: Question, order: int) -> dict:
    """One question, the website's fields minus the signed URLs (``Question.get_options``'s
    rule for which letters exist: text or an image)."""
    options = {}
    for text_field, image_field, letter in _OPTION_SLOTS:
        text = getattr(question, text_field) or ""
        image = getattr(question, image_field)
        if text or image:
            options[letter] = {"text": text, "image_key": _image_key(image)}
    return {
        "id": question.id,
        "order": order,
        "question_type": question.question_type,
        "is_math_input": bool(question.is_math_input),
        "question_text": question.question_text or "",
        "question_prompt": question.question_prompt or "",
        "question_image_key": _image_key(question.question_image),
        "options": options or None,
    }


def questions_payload(questions: Iterable[Question]) -> list[dict]:
    return [question_payload(q, i) for i, q in enumerate(questions, start=1)]


def content_hash(questions: list[dict]) -> str:
    """``"sha256:" + sha256(json.dumps(questions, sort_keys=True, separators=(",",":"),
    ensure_ascii=False))`` over the list exactly as served. The app computes the same value
    (``contentHashOf`` in ``desktop-native/app/lib/core/models/content.dart``)."""
    canonical = json.dumps(questions, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def image_keys(questions: list[dict]) -> list[str]:
    """Every image a module's questions reference, in reading order, each once."""
    seen: dict[str, None] = {}
    for q in questions:
        if q.get("question_image_key"):
            seen.setdefault(q["question_image_key"], None)
        for option in (q.get("options") or {}).values():
            if option.get("image_key"):
                seen.setdefault(option["image_key"], None)
    return list(seen)


def questions_by_module(module_ids: Iterable[int]) -> dict[int, list[Question]]:
    """One query for every past-paper module's questions, in the website runner's order.

    The website serves ``module.questions.all()``, i.e. ``Question.Meta.ordering`` =
    ``("order", "created_at")``; ``id`` only breaks a tie that ordering leaves open.
    (Midterm modules are read through ``MidtermAttempt.effective_questions_for_order``,
    which carries the midterm runner's own order.)
    """
    ids = [int(m) for m in module_ids if m]
    out: dict[int, list[Question]] = defaultdict(list)
    if not ids:
        return out
    for q in Question.objects.filter(module_id__in=ids).order_by("module_id", "order", "created_at", "id"):
        out[int(q.module_id)].append(q)
    return out


# ── annotations ──────────────────────────────────────────────────────────────────────────
#: The containers and marks the app's annotator understands (``AnnotationContainer``,
#: ``AnnotationKind``, ``HighlightColor``, ``UnderlineStyle`` in the Dart models). A stored row
#: outside these — written by an older website build — is left out of the bundle rather than
#: failing the whole bundle's parse on the laptop.
ANNOTATION_CONTAINERS = ("passage", "question", "choices")
ANNOTATION_KINDS = ("highlight", "underline")
HIGHLIGHT_COLORS = ("yellow", "blue", "pink")
UNDERLINE_STYLES = ("solid", "dashed", "dotted")


def _clean_mark(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    start, end, kind = raw.get("start"), raw.get("end"), raw.get("kind")
    if isinstance(start, bool) or isinstance(end, bool):
        return None
    if not isinstance(start, int) or not isinstance(end, int) or kind not in ANNOTATION_KINDS:
        return None
    mark = {"start": start, "end": end, "kind": kind}
    if raw.get("color") in HIGHLIGHT_COLORS:
        mark["color"] = raw["color"]
    if raw.get("underline") in UNDERLINE_STYLES:
        mark["underline"] = raw["underline"]
    return mark


def annotations_for(*, student, ref: str) -> list[dict]:
    """``[{target_id, container, data}]`` — what the student marked on this sitting, in one
    query. Past papers use ``ref=str(attempt_id)`` (the website's own key); midterms use
    ``ref="mt-<attempt_id>"`` so a midterm and a past-paper attempt that share a number never
    see each other's highlights."""
    from annotations.models import StudyAnnotation

    rows = StudyAnnotation.objects.filter(
        student=student, scope=StudyAnnotation.SCOPE_EXAM, ref=ref, container__in=ANNOTATION_CONTAINERS
    ).order_by("target_id", "container")
    out = []
    for row in rows:
        marks = [m for m in (_clean_mark(x) for x in (row.data or [])) if m is not None]
        if marks:
            out.append({"target_id": int(row.target_id), "container": row.container, "data": marks})
    return out


def module_block(
    *,
    module_id: int,
    order: int,
    time_limit_minutes: int,
    questions: list[dict],
    have: dict[str, str],
    deferred: bool = False,
) -> dict:
    """``modules[]`` / ``next_module``: the content, or ``questions: null`` when the app already
    holds this exact content (``unchanged``) or it is held back (``deferred``)."""
    digest = content_hash(questions)
    unchanged = have.get(str(module_id)) == digest
    return {
        "id": module_id,
        "order": order,
        "time_limit_minutes": int(time_limit_minutes or 0),
        "question_count": len(questions),
        "content_hash": digest,
        "unchanged": unchanged,
        "deferred": bool(deferred),
        "questions": None if (unchanged or deferred) else questions,
    }
