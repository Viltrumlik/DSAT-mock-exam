from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Optional

from .models import QuestionErrorReport


@dataclass
class ResolvedTarget:
    resource_type: str
    resource_id: Optional[int]
    resource_title: str
    question_order: Optional[int]
    question_excerpt: str
    qb_id: str


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _excerpt(text: str, limit: int = 200) -> str:
    if not text:
        return ""
    s = _TAG_RE.sub(" ", str(text))
    s = _WS_RE.sub(" ", s).strip()
    if len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


def _resolve_exam(question_id: int) -> Optional[ResolvedTarget]:
    """Resolve an ``exams.Question`` id to (pastpaper | practice_test | mock | midterm)."""
    from exams.models import Question

    q = (
        Question.objects.select_related(
            "module",
            "module__practice_test",
            "module__practice_test__practice_test_pack",
            "bank_question",
        )
        .filter(pk=question_id)
        .first()
    )
    if q is None:
        return None

    order = int(q.order or 0) + 1
    excerpt = _excerpt(q.question_text or q.question_prompt or "")
    qb_id = q.bank_question.qb_id if getattr(q, "bank_question_id", None) else ""

    resource_type = QuestionErrorReport.RESOURCE_UNKNOWN
    resource_id: Optional[int] = None
    resource_title = ""

    module = q.module
    if module is not None:
        # Midterm owns exactly one Module (reverse OneToOne). Query by id to avoid
        # relying on the reverse-accessor DoesNotExist dance.
        from midterms.models import Midterm

        midterm = Midterm.objects.filter(question_module_id=module.id).only("id", "title").first()
        if midterm is not None:
            resource_type = QuestionErrorReport.RESOURCE_MIDTERM
            resource_id = midterm.id
            resource_title = midterm.title or ""
        else:
            pt = module.practice_test
            if pt is not None:
                if pt.practice_test_pack_id:
                    pack = pt.practice_test_pack
                    resource_type = QuestionErrorReport.RESOURCE_PRACTICE_TEST
                    resource_id = pt.practice_test_pack_id
                    resource_title = (getattr(pack, "title", "") or pt.title or "").strip()
                elif pt.mock_exam_id:
                    # Legacy staff-built mock section on the old exams.MockExam.
                    resource_type = QuestionErrorReport.RESOURCE_MOCK
                    resource_id = pt.mock_exam_id
                    resource_title = (pt.title or pt.collection_name or "").strip()
                else:
                    resource_type = QuestionErrorReport.RESOURCE_PASTPAPER
                    resource_id = pt.id
                    resource_title = (pt.collection_name or pt.title or "").strip()
            else:
                # Modern full mock: the Module hangs off a mocks.MockSection via a
                # OneToOne with related_name="+" (no reverse accessor) -> query it.
                from django.db.models import Q
                from mocks.models import MockSection

                section = (
                    MockSection.objects.select_related("mock")
                    .filter(Q(module1_id=module.id) | Q(module2_id=module.id))
                    .first()
                )
                if section is not None and section.mock is not None:
                    resource_type = QuestionErrorReport.RESOURCE_MOCK
                    resource_id = section.mock_id
                    resource_title = section.mock.title or ""

    return ResolvedTarget(resource_type, resource_id, resource_title, order, excerpt, qb_id)


def _resolve_assessment(question_id: int) -> Optional[ResolvedTarget]:
    from assessments.models import AssessmentQuestion

    aq = (
        AssessmentQuestion.objects.select_related("assessment_set", "bank_question")
        .filter(pk=question_id)
        .first()
    )
    if aq is None:
        return None
    order = int(aq.order or 0) + 1
    excerpt = _excerpt(aq.prompt or aq.question_prompt or "")
    qb_id = aq.bank_question.qb_id if getattr(aq, "bank_question_id", None) else ""
    title = aq.assessment_set.title if aq.assessment_set_id else ""
    return ResolvedTarget(
        QuestionErrorReport.RESOURCE_ASSESSMENT,
        aq.assessment_set_id,
        title or "",
        order,
        excerpt,
        qb_id,
    )


def resolve_target(system: str, question_id: int) -> Optional[ResolvedTarget]:
    """Authoritatively derive the resource identity + stable snapshot for a report target."""
    if system == QuestionErrorReport.SYSTEM_ASSESSMENT:
        return _resolve_assessment(question_id)
    return _resolve_exam(question_id)


_RESOURCE_LABELS = dict(QuestionErrorReport.RESOURCE_CHOICES)
_CATEGORY_LABELS = dict(QuestionErrorReport.CATEGORY_CHOICES)


def _reporter_label(report: QuestionErrorReport) -> str:
    u = report.reporter
    if u is None:
        return "Unknown"
    name = ""
    getter = getattr(u, "get_full_name", None)
    if callable(getter):
        name = (getter() or "").strip()
    uname = (getattr(u, "username", "") or "").strip()
    parts = [p for p in [name, f"@{uname}" if uname else ""] if p]
    return " ".join(parts) or f"user #{u.pk}"


def build_report_message(report: QuestionErrorReport) -> str:
    """Build the HTML Telegram message (parse_mode=HTML) with all dynamic text escaped."""
    e = html.escape
    resource_label = _RESOURCE_LABELS.get(report.resource_type, report.resource_type)
    category_label = _CATEGORY_LABELS.get(report.category, report.category)
    qnum = f"#{report.question_order}" if report.question_order else f"id {report.question_id}"

    lines = [
        "🚩 <b>Question error report</b>",
        f"<b>Resource:</b> {e(resource_label)} — {e(report.resource_title or '—')}",
        f"<b>Question:</b> {e(qnum)}"
        + (f" · <code>{e(report.qb_id)}</code>" if report.qb_id else ""),
        f"<b>Category:</b> {e(category_label)}",
        f"<b>Reported by:</b> {e(_reporter_label(report))}",
    ]
    if report.message:
        lines.append(f"<b>Message:</b> {e(report.message)}")
    if report.question_excerpt:
        lines.append(f"\n<i>{e(report.question_excerpt)}</i>")
    lines.append(
        f"\n<code>report #{report.id} · {e(report.system)} qid {report.question_id}</code>"
    )
    return "\n".join(lines)
