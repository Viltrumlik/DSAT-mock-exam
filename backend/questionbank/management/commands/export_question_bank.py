"""
Export Question Bank questions to CSV (one row per question).

Text is exported RAW — exactly as stored, including the LaTeX delimiters
(``\\( … \\)``), ``<br>`` tags and ``*emphasis*`` markers the renderer relies on.
A "prettified" column was deliberately NOT added: stripping markup would corrupt
math and make the file unsafe to read back.

``correct_answer`` is a JSONField holding a letter ("A"), a number (17, -3.5), or
a list of accepted variants. It is written twice: ``correct_answer`` joined with
" | " for reading, and ``correct_answer_json`` verbatim for machines.

``taxonomy_source`` exists because domain/skill are NOT always a real classification.
assessments.domain.bank_sync._provisional_taxonomy falls back to the subject's FIRST
domain + FIRST skill whenever the assessment set's category doesn't match a taxonomy
row, and only stamps suggestion_model on a genuine match. Without this column the
fallback rows are indistinguishable from classified ones and the CSV silently lies.

Images are referenced by absolute URL (``--base-url``); a CSV cannot embed them.

Usage:
    python manage.py export_question_bank --out /tmp/question_bank.csv
    python manage.py export_question_bank --status APPROVED --subject MATH
"""
from __future__ import annotations

import csv
import json
import os

from django.conf import settings
from django.core.management.base import BaseCommand

from questionbank.models import BankQuestion, QuestionStatus, Subject

COLUMNS = [
    "qb_id",
    "external_id",
    "subject",
    "domain",
    "skill",
    "taxonomy_source",
    "difficulty",
    "question_type",
    "status",
    "points",
    "passage_text",
    "question_text",
    "question_prompt",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_answer",
    "correct_answer_json",
    "explanation",
    "question_image_url",
    "option_a_image_url",
    "option_b_image_url",
    "option_c_image_url",
    "option_d_image_url",
    "source_type",
    "source_reference",
    "content_hash",
    "created_at",
    "updated_at",
]


#: bank_sync stamps this only when the assessment category matched a real taxonomy row.
SYNC_MATCH_MARKER = "sync:assessment_category"


def taxonomy_source(question) -> str:
    """Whether domain/skill were classified or defaulted. Blank suggestion_model on a
    synced question means _match_taxonomy found nothing and the fallback pair was used."""
    if not question.domain_id:
        return "unclassified"
    if question.suggestion_model == SYNC_MATCH_MARKER:
        return "assessment_category"
    if question.suggestion_model:
        return question.suggestion_model
    return "fallback_default"


def readable_answer(value) -> str:
    """Flatten the JSON answer for a human. Lists are the multi-variant SPR case
    (e.g. ["3/2", "1.5"]) — join rather than dump so the cell stays legible."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " | ".join(str(v) for v in value)
    return str(value)


class Command(BaseCommand):
    help = "Export Question Bank questions to CSV."

    def add_arguments(self, parser):
        parser.add_argument("--out", default="/tmp/question_bank.csv", help="Output CSV path.")
        parser.add_argument(
            "--status", default="", choices=[""] + list(QuestionStatus.values),
            help="Only this status (default: every status).",
        )
        parser.add_argument(
            "--subject", default="", choices=[""] + list(Subject.values),
            help="Only this subject (default: both).",
        )
        parser.add_argument(
            "--base-url", default="https://mastersat.uz",
            help="Origin prefixed to image URLs so they open from the CSV.",
        )

    def handle(self, *args, **opts):
        out_path = opts["out"]
        base_url = (opts["base_url"] or "").rstrip("/")

        qs = BankQuestion.objects.select_related("domain", "skill", "passage").order_by("qb_id")
        if opts["status"]:
            qs = qs.filter(status=opts["status"])
        if opts["subject"]:
            qs = qs.filter(subject=opts["subject"])

        total = qs.count()
        self.stdout.write(f"Exporting {total} questions to {out_path} …")

        def image_url(field) -> str:
            name = getattr(field, "name", "") or ""
            if not name:
                return ""
            return f"{base_url}{settings.MEDIA_URL}{name}"

        # utf-8-sig: without the BOM Excel mis-decodes the á/›/\( content as mojibake.
        missing_answer = 0
        fallback_taxonomy = 0
        written = 0
        with open(out_path, "w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=COLUMNS, quoting=csv.QUOTE_ALL)
            writer.writeheader()
            for q in qs.iterator(chunk_size=200):
                if q.correct_answer is None:
                    missing_answer += 1
                tax_src = taxonomy_source(q)
                if tax_src == "fallback_default":
                    fallback_taxonomy += 1
                writer.writerow({
                    "qb_id": q.qb_id,
                    "external_id": q.external_id,
                    "subject": q.subject,
                    "domain": q.domain.name if q.domain_id else "",
                    "skill": q.skill.name if q.skill_id else "",
                    "taxonomy_source": tax_src,
                    "difficulty": q.difficulty,
                    "question_type": q.question_type,
                    "status": q.status,
                    "points": q.points,
                    "passage_text": q.passage.passage_text if q.passage_id else "",
                    "question_text": q.question_text or "",
                    "question_prompt": q.question_prompt or "",
                    "option_a": q.option_a or "",
                    "option_b": q.option_b or "",
                    "option_c": q.option_c or "",
                    "option_d": q.option_d or "",
                    "correct_answer": readable_answer(q.correct_answer),
                    "correct_answer_json": json.dumps(q.correct_answer, ensure_ascii=False),
                    "explanation": q.explanation or "",
                    "question_image_url": image_url(q.question_image),
                    "option_a_image_url": image_url(q.option_a_image),
                    "option_b_image_url": image_url(q.option_b_image),
                    "option_c_image_url": image_url(q.option_c_image),
                    "option_d_image_url": image_url(q.option_d_image),
                    "source_type": q.source_type,
                    "source_reference": q.source_reference,
                    "content_hash": q.content_hash,
                    "created_at": q.created_at.isoformat() if q.created_at else "",
                    "updated_at": q.updated_at.isoformat() if q.updated_at else "",
                })
                written += 1

        size = os.path.getsize(out_path)
        self.stdout.write(self.style.SUCCESS(
            f"Wrote {written} rows ({size / 1024:.0f} KB) to {out_path}"
        ))
        if written != total:
            self.stderr.write(self.style.ERROR(
                f"Row count {written} != queryset count {total} — export is incomplete."
            ))
        if missing_answer:
            self.stderr.write(self.style.WARNING(
                f"{missing_answer} question(s) have no correct_answer — they can never be "
                f"marked correct. Their correct_answer cell is empty."
            ))
        if fallback_taxonomy:
            self.stderr.write(self.style.WARNING(
                f"{fallback_taxonomy} question(s) carry taxonomy_source=fallback_default — "
                f"their domain/skill is a sync default, not a real classification."
            ))
