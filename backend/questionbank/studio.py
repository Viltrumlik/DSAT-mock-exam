"""``GET /api/questionbank/studio/summary/`` — every number Studio home (the builder's ``/builder``) shows.

The design handoff's BuilderHome board (owner, 2026-11-11: "Yes, start 8b"): what needs the content team
(questions with no answer key, the review queue, imports that failed validation, mocks that can't be
published, questions without a skill), what the team did today, how many approved questions each SAT skill
has, the library's live counts, and the state of the things this browser opened last. Read-only, one
request, a fixed number of queries whatever the bank's size.

Definitions are the ones the pages these numbers open already use, so a number never disagrees with the list
behind it:

* review = status TRIAGE (the triage page and the bell; ``in_triage()`` also takes IMPORTED, not used).
* no answer key = ``correct_answer`` SQL NULL, JSON null, ``""``, ``[]`` or ``{}`` — the bank list's
  "Answer key: Missing" filter (``views_changelist``). "Live" = used by an active approved assessment set, or
  by a module of a published practice test / past paper, full mock or midterm.
* without a skill = the bank list's ``classified=no`` (no domain).
* failed import = a READY batch holding ERROR candidates (the Imports page's "Validation failed"); FAILED is
  never written by any code.
* a mock can't be published = ``mocks.admin_serializers.publish_check``'s rule; short = below the SAT shape
  (R&W 27, Math 22 a module), which ``publish_warnings`` reports without blocking.
* publishing a mock, paper, practice test or midterm records no actor: Team today names nobody for it.
"""
from __future__ import annotations

from datetime import datetime, time

from django.db.models import Count, Max, Min, Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from assessments.models import AssessmentAttempt, AssessmentQuestion, AssessmentSet, GovernanceEvent
from exams.models import PracticeTest
from exams.models import Question as ExamQuestion
from exams.sat_rules import SAT_MODULE_QUESTION_COUNT
from midterms.models import Midterm
from mocks.models import Mock, MockAttempt, MockSection
from mocks.state_machine import STATE_BREAK, STATE_ENGLISH_M1, STATE_ENGLISH_M2, STATE_MATH_M1, STATE_MATH_M2
from vocabulary.models import VocabSection

from . import audit
from .models import BankQuestion, BankSkill, ImportBatch, ImportCandidate, QuestionStatus, Subject, TaxonomyLevel
from .views import QB_PERMISSIONS

#: The board's target line: approved questions a skill should have.
COVERAGE_TARGET = 10
#: Below this a skill is "thin" (the finding under the chart).
COVERAGE_THIN = 5
#: At most this many recent items are looked up for the Continue row.
RECENT_MAX = 8
RECENT_KINDS = ("question", "set", "mock", "pastpaper")

#: ``correct_answer`` carries no usable key. JSONField: ``__isnull`` is SQL NULL, ``=None`` is JSON null.
NO_KEY = (
    Q(correct_answer__isnull=True)
    | Q(correct_answer=None)
    | Q(correct_answer="")
    | Q(correct_answer=[])
    | Q(correct_answer={})
)
#: Any advisory suggestion — the serializer's ``has_suggestion``. Not all of them are AI (heuristic, sync).
HAS_SUGGESTION = (
    Q(suggested_domain__isnull=False)
    | Q(suggested_skill__isnull=False)
    | ~Q(suggested_difficulty="")
    | ~Q(suggestion_rationale="")
)
_MOCK_ACTIVE = (STATE_ENGLISH_M1, STATE_ENGLISH_M2, STATE_BREAK, STATE_MATH_M1, STATE_MATH_M2)
_DONE = (AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED)
_SECTION_SHORT = {"READING_WRITING": "R&W", "MATH": "Math"}

#: event_type → (verb, noun for one, noun for many). Only what a person did to content.
_TEAM_VERBS = {
    audit.EVT_APPROVE: ("approved", "question", "questions"),
    audit.EVT_REJECT: ("rejected", "question", "questions"),
    audit.EVT_CLASSIFY: ("classified", "question", "questions"),
    audit.EVT_ACCEPT_SUGGESTION: ("classified", "question", "questions"),
    audit.EVT_CREATE: ("wrote", "question", "questions"),
    audit.EVT_UPDATE: ("edited", "question", "questions"),
    audit.EVT_ARCHIVE: ("archived", "question", "questions"),
    audit.EVT_RESTORE: ("restored", "question", "questions"),
    audit.EVT_BATCH_PROMOTE: ("added to the bank", "import batch", "import batches"),
    GovernanceEvent.EVENT_APPROVE: ("approved", "set", "sets"),
    GovernanceEvent.EVENT_SUBMIT_FOR_REVIEW: ("sent for review", "set", "sets"),
    GovernanceEvent.EVENT_SEND_BACK: ("sent back", "set", "sets"),
    GovernanceEvent.EVENT_SET_DELETE: ("deleted", "set", "sets"),
}
TEAM_MAX = 8


def _live_bank_ids():
    """Bank question ids students can be served right now, as two subqueries."""
    sets = AssessmentQuestion.objects.filter(
        is_active=True,
        assessment_set__is_active=True,
        assessment_set__review_status=AssessmentSet.STATUS_APPROVED,
        bank_question__isnull=False,
    ).values("bank_question_id")
    # Mock sections point at their modules with related_name="+", so walk from the section to the ids.
    mock_live = MockSection.objects.filter(mock__is_published=True)
    midterm_live = Midterm.objects.filter(is_published=True)
    modules = ExamQuestion.objects.filter(
        Q(module__practice_test__is_published=True, module__practice_test__mock_exam__isnull=True)
        | Q(module_id__in=mock_live.values("module1_id"))
        | Q(module_id__in=mock_live.values("module2_id"))
        | Q(module_id__in=midterm_live.values("question_module_id"))
        | Q(module_id__in=midterm_live.values("question_module_2_id")),
        bank_question__isnull=False,
    ).values("bank_question_id")
    return Q(pk__in=sets) | Q(pk__in=modules)


def _person(first: str | None, last: str | None, email: str | None) -> str:
    first = (first or "").strip()
    if first:
        return first
    last = (last or "").strip()
    if last:
        return last
    return (email or "someone").split("@")[0]


def _today_start():
    return timezone.make_aware(datetime.combine(timezone.localdate(), time.min))


def _bank() -> dict:
    triage = Q(status=QuestionStatus.TRIAGE)
    return BankQuestion.objects.aggregate(
        total=Count("id"),
        review=Count("id", filter=triage),
        review_oldest=Min("created_at", filter=triage),
        review_suggested=Count("id", filter=triage & HAS_SUGGESTION),
        no_key=Count("id", filter=NO_KEY),
        no_key_live=Count("id", filter=NO_KEY & _live_bank_ids()),
        no_skill=Count("id", filter=Q(domain__isnull=True)),
        english=Count("id", filter=Q(subject=Subject.ENGLISH)),
        math=Count("id", filter=Q(subject=Subject.MATH)),
    )


def _imports() -> dict:
    total = ImportBatch.objects.count()
    failed = list(
        ImportBatch.objects.filter(status=ImportBatch.Status.READY)
        .annotate(
            errors=Count("candidates", filter=Q(candidates__validation_status=ImportCandidate.Validation.ERROR)),
            duplicates=Count(
                "candidates", filter=Q(candidates__validation_status=ImportCandidate.Validation.DUPLICATE)
            ),
        )
        .filter(errors__gt=0)
        .order_by("-created_at", "-id")
        .values(
            "id", "filename", "errors", "duplicates", "created_at",
            "uploaded_by__first_name", "uploaded_by__last_name", "uploaded_by__email",
        )
    )
    return {
        "batches": total,
        "with_errors": len(failed),
        "failed": [
            {
                "id": b["id"],
                "filename": b["filename"],
                "errors": b["errors"],
                "duplicates": b["duplicates"],
                "at": b["created_at"],
                "by": _person(b["uploaded_by__first_name"], b["uploaded_by__last_name"], b["uploaded_by__email"])
                if b["uploaded_by__email"] else None,
            }
            for b in failed[:3]
        ],
    }


def _mock_state(mock: dict, sections: list[dict], counts: dict[int, int]) -> dict:
    """The publish rule and the SAT-shape gaps of one mock, from rows already fetched."""
    gaps = []
    blocked = ""
    if len(sections) != 2:
        blocked = "A mock needs an English and a Math section."
    for sec in sorted(sections, key=lambda s: 0 if s["subject"] == "READING_WRITING" else 1):
        target = SAT_MODULE_QUESTION_COUNT.get(sec["subject"])
        label = _SECTION_SHORT.get(sec["subject"], sec["subject"])
        for slot, module_id in ((1, sec["module1_id"]), (2, sec["module2_id"])):
            have = counts.get(module_id, 0) if module_id else 0
            if module_id and have == 0 and not blocked:
                blocked = "Every module needs at least one question."
            if target and have < target:
                gaps.append({"module": f"{label} {slot}", "have": have, "need": target})
    return {
        "id": mock["id"],
        "title": mock["title"],
        "live": mock["is_published"],
        "ready": not blocked,
        "block_reason": blocked,
        "short": sum(g["need"] - g["have"] for g in gaps),
        "gaps": gaps,
        "updated_at": mock["updated_at"],
    }


def _mocks() -> tuple[dict, dict[int, dict]]:
    mocks = list(Mock.objects.values("id", "title", "is_published", "updated_at"))
    sections = list(MockSection.objects.values("mock_id", "subject", "module1_id", "module2_id"))
    module_ids = {m for s in sections for m in (s["module1_id"], s["module2_id"]) if m}
    counts = dict(
        ExamQuestion.objects.filter(module_id__in=module_ids)
        .values("module_id").annotate(n=Count("id")).values_list("module_id", "n")
    ) if module_ids else {}
    by_mock: dict[int, list[dict]] = {}
    for s in sections:
        by_mock.setdefault(s["mock_id"], []).append(s)
    states = {m["id"]: _mock_state(m, by_mock.get(m["id"], []), counts) for m in mocks}
    attempts = list(
        MockAttempt.objects.filter(mock__is_published=True, is_completed=False, current_state__in=_MOCK_ACTIVE)
        .values("mock_id", "mock__title").annotate(students=Count("student", distinct=True)).order_by("-students")
    )
    drafts = sorted(
        (s for s in states.values() if not s["live"] and (s["gaps"] or not s["ready"])),
        key=lambda s: s["updated_at"], reverse=True,
    )
    return {
        "total": len(mocks),
        "live": sum(1 for s in states.values() if s["live"]),
        "incomplete": sum(1 for s in states.values() if s["gaps"] or not s["ready"]),
        "not_ready": [{k: v for k, v in d.items() if k != "updated_at"} for d in drafts[:3]],
        "not_ready_count": len(drafts),
        "mid_attempt": [{"id": a["mock_id"], "title": a["mock__title"], "students": a["students"]} for a in attempts[:3]],
    }, states


def _team_today(user) -> list[dict]:
    start = _today_start()
    rows = []
    events = (
        GovernanceEvent.objects.filter(occurred_at__gte=start, event_type__in=list(_TEAM_VERBS))
        .values("actor_id", "actor_email", "actor__first_name", "actor__last_name", "event_type")
        .annotate(n=Count("id"), last=Max("occurred_at"))
        .order_by()
    )
    for e in events:
        verb, one, many = _TEAM_VERBS[e["event_type"]]
        mine = user is not None and e["actor_id"] == user.id
        rows.append({
            "who": "You" if mine else _person(e["actor__first_name"], e["actor__last_name"], e["actor_email"]),
            "mine": mine,
            "what": f"{verb} {e['n']} {one if e['n'] == 1 else many}",
            "detail": "",
            "at": e["last"],
            "kind": e["event_type"],
        })
    batches = (
        ImportBatch.objects.filter(created_at__gte=start)
        .annotate(errors=Count("candidates", filter=Q(candidates__validation_status=ImportCandidate.Validation.ERROR)))
        .values(
            "id", "created_at", "errors", "uploaded_by_id",
            "uploaded_by__first_name", "uploaded_by__last_name", "uploaded_by__email",
        )
    )
    for b in batches:
        mine = user is not None and b["uploaded_by_id"] == user.id
        who = "You" if mine else (
            _person(b["uploaded_by__first_name"], b["uploaded_by__last_name"], b["uploaded_by__email"])
            if b["uploaded_by__email"] else "Someone"
        )
        rows.append({
            "who": who,
            "mine": mine,
            "what": f"imported batch #{b['id']}",
            "detail": f"{b['errors']} {'row' if b['errors'] == 1 else 'rows'} failed" if b["errors"] else "",
            "at": b["created_at"],
            "kind": "import",
        })
    published = [
        *(("full mock", r) for r in Mock.objects.filter(is_published=True, published_at__gte=start).values("title", "published_at")),
        *(
            ("practice test" if r["is_practice_test"] else "past paper", r)
            for r in PracticeTest.objects.filter(is_published=True, published_at__gte=start, mock_exam__isnull=True)
            .values("title", "published_at", "is_practice_test")
        ),
        *(("midterm", r) for r in Midterm.objects.filter(is_published=True, published_at__gte=start).values("title", "published_at")),
    ]
    for kind, r in published:
        # Publishing records no actor anywhere, so nobody is named.
        rows.append({
            "who": None, "mine": False, "what": f"{r['title'] or kind.capitalize()} published",
            "detail": kind, "at": r["published_at"], "kind": "publish",
        })
    rows.sort(key=lambda r: r["at"], reverse=True)
    return rows[:TEAM_MAX]


def _coverage() -> dict:
    skills = list(
        BankSkill.objects.filter(domain__level=TaxonomyLevel.SAT)
        .annotate(approved=Count("questions", filter=Q(questions__status=QuestionStatus.APPROVED)))
        .values("id", "name", "domain__name", "domain__subject", "approved")
        .order_by("domain__subject", "domain__display_order", "display_order", "name")
    )
    return {
        "target": COVERAGE_TARGET,
        "thin_below": COVERAGE_THIN,
        "skills": [
            {"id": s["id"], "name": s["name"], "domain": s["domain__name"], "subject": s["domain__subject"], "approved": s["approved"]}
            for s in skills
        ],
    }


def _library(bank: dict, imports: dict, mocks: dict) -> dict:
    sets = AssessmentSet.objects.aggregate(
        total=Count("id"),
        live=Count("id", filter=Q(is_active=True, review_status=AssessmentSet.STATUS_APPROVED)),
        english=Count("id", filter=Q(subject=AssessmentSet.SUBJECT_ENGLISH)),
        math=Count("id", filter=Q(subject=AssessmentSet.SUBJECT_MATH)),
        categories=Count("category", distinct=True, filter=~Q(category="")),
    )
    midterms = Midterm.objects.aggregate(
        total=Count("id"),
        live=Count("id", filter=Q(is_published=True)),
        english=Count("id", filter=Q(subject=Midterm.READING_WRITING)),
        math=Count("id", filter=Q(subject=Midterm.MATH)),
    )
    tests = PracticeTest.objects.filter(mock_exam__isnull=True).aggregate(
        pastpapers=Count("id", filter=Q(is_practice_test=False)),
        pastpapers_live=Count("id", filter=Q(is_practice_test=False, is_published=True)),
        practice=Count("id", filter=Q(is_practice_test=True)),
        practice_live=Count("id", filter=Q(is_practice_test=True, is_published=True)),
    )
    vocab = list(VocabSection.objects.order_by("order", "id").values_list("title", flat=True))
    return {
        "questions": {"total": bank["total"], "review": bank["review"], "english": bank["english"], "math": bank["math"]},
        "sets": sets,
        "midterms": midterms,
        "vocabulary": {"sections": len(vocab), "names": vocab[:2]},
        "imports": {"batches": imports["batches"], "with_errors": imports["with_errors"]},
        "pastpapers": {"total": tests["pastpapers"], "live": tests["pastpapers_live"]},
        "practice_tests": {"total": tests["practice"], "live": tests["practice_live"]},
        "mocks": {"total": mocks["total"], "live": mocks["live"], "incomplete": mocks["incomplete"]},
    }


def parse_recent(raw: str | None) -> list[tuple[str, int]]:
    """``"question:30,set:12"`` → [("question", 30), ("set", 12)]; unknown kinds and junk are dropped."""
    out: list[tuple[str, int]] = []
    for part in (raw or "").split(",")[: RECENT_MAX * 2]:
        kind, _, ident = part.strip().partition(":")
        if kind in RECENT_KINDS and ident.isdigit() and len(ident) < 10 and (kind, int(ident)) not in out:
            out.append((kind, int(ident)))
        if len(out) >= RECENT_MAX:
            break
    return out


def _recent(items: list[tuple[str, int]], mock_states: dict[int, dict]) -> list[dict]:
    """The current state of what this browser opened last, in the order given. Deleted ids drop out."""
    want: dict[str, list[int]] = {}
    for kind, ident in items:
        want.setdefault(kind, []).append(ident)
    found: dict[tuple[str, int], dict] = {}
    if want.get("question"):
        for q in BankQuestion.objects.filter(pk__in=want["question"]).values(
            "id", "qb_id", "question_text", "status", "subject", "domain_id", "skill__name",
            "updated_at", "created_at", "source_type",
        ):
            found[("question", q["id"])] = {
                "kind": "question", "id": q["id"], "title": q["qb_id"], "text": (q["question_text"] or "")[:400],
                "status": q["status"], "subject": q["subject"], "skill": q["skill__name"],
                "needs_skill": q["domain_id"] is None, "imported": q["source_type"] != "MANUAL",
                "updated_at": q["updated_at"], "created_at": q["created_at"],
            }
    if want.get("set"):
        for s in AssessmentSet.objects.filter(pk__in=want["set"]).annotate(
            classes=Count("homework_assignments__classroom", distinct=True),
            done=Count(
                "homework_assignments__attempts__student",
                filter=Q(homework_assignments__attempts__status__in=_DONE),
                distinct=True,
            ),
            n_questions=Count("questions", filter=Q(questions__is_active=True), distinct=True),
        ).values(
            "id", "title", "subject", "category", "is_active", "review_status", "updated_at", "classes", "done", "n_questions",
        ):
            found[("set", s["id"])] = {
                "kind": "set", "id": s["id"], "title": s["title"], "subject": s["subject"], "category": s["category"],
                "live": s["is_active"] and s["review_status"] == AssessmentSet.STATUS_APPROVED,
                "review_status": s["review_status"], "classes": s["classes"], "done": s["done"],
                "questions": s["n_questions"], "updated_at": s["updated_at"],
            }
    for ident in want.get("mock", []):
        st = mock_states.get(ident)
        if st:
            found[("mock", ident)] = {"kind": "mock", **st}
    if want.get("pastpaper"):
        for t in PracticeTest.objects.filter(pk__in=want["pastpaper"]).annotate(
            n_questions=Count("modules__questions", distinct=True),
        ).values("id", "title", "subject", "is_published", "is_practice_test", "updated_at", "n_questions"):
            found[("pastpaper", t["id"])] = {
                "kind": "pastpaper", "id": t["id"], "title": t["title"], "subject": t["subject"],
                "live": t["is_published"], "practice": t["is_practice_test"], "questions": t["n_questions"],
                "updated_at": t["updated_at"],
            }
    return [found[k] for k in items if k in found]


def studio_summary(*, user, recent: list[tuple[str, int]] | None = None) -> dict:
    bank = _bank()
    imports = _imports()
    mocks, mock_states = _mocks()
    return {
        "review": {"count": bank["review"], "oldest_at": bank["review_oldest"], "with_suggestion": bank["review_suggested"]},
        "no_key": {"count": bank["no_key"], "live": bank["no_key_live"]},
        "no_skill": {"count": bank["no_skill"]},
        "imports": imports,
        "mocks": mocks,
        "team_today": _team_today(user),
        "coverage": _coverage(),
        "library": _library(bank, imports, mocks),
        "recent": _recent(recent, mock_states) if recent else [],
    }


# ──────────────────────────────────────────────────────────────────────────────
# The endpoint
# ──────────────────────────────────────────────────────────────────────────────
@extend_schema(tags=["questionbank"])
class StudioSummaryView(APIView):
    """Studio home's numbers. ``?recent=question:30,set:12,mock:5,pastpaper:9`` (≤ 8) adds those items' state."""

    permission_classes = QB_PERMISSIONS  # the bank list's own gate (teachers pass it too, as on the bank)

    def get(self, request):
        return Response(studio_summary(user=request.user, recent=parse_recent(request.query_params.get("recent"))))
