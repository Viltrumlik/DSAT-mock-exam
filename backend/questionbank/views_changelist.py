"""``GET /api/questionbank/questions/changelist/`` — the builder's Question Bank as a Django-admin changelist.

The owner (2026-10-15): "question builderni opsga styledan ko'chirib builderni ham o'zgartiring" — the
builder takes the /ops console's look, and its Question Bank becomes the same changelist as /ops
Students: search, filters with a count beside every choice (counted with the search and every OTHER
filter applied, as a facet is), ordering and pages. The response has the shape ``/users/admin/people/``
answers with, so the frontend's shared ``ChangeList`` draws it unchanged.

``questions/`` stays as it is: the pickers and the triage queue read its limit/offset envelope.
"""
from __future__ import annotations

from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from . import serializers as qb
from .models import BankQuestion, Difficulty, QuestionStatus, SourceType, Subject
from .views import QB_PERMISSIONS, _int_or_none

PAGE_SIZES = (25, 50, 100)
DEFAULT_PAGE_SIZE = 50
DEFAULT_ORDERING = "-created"

# The short labels the builder already shows (domains/questionBank/utils.ts), not the model's long ones.
_STATUS_LABELS = (
    (QuestionStatus.IMPORTED.value, "Imported"),
    (QuestionStatus.TRIAGE.value, "In triage"),
    (QuestionStatus.APPROVED.value, "Approved"),
    (QuestionStatus.REJECTED.value, "Rejected"),
    (QuestionStatus.ARCHIVED.value, "Archived"),
)
_DIFFICULTY = {
    **{d.value: Q(difficulty=d.value) for d in Difficulty},
    "none": Q(difficulty=""),
}
_CLASSIFIED = {"yes": Q(domain__isnull=False), "no": Q(domain__isnull=True)}


def _fixed(qs, values: dict, labels):
    """One option per known value, in the given order — zero counts included, so a filter never jumps."""
    return [(v, label, qs.filter(values[v]).count()) for v, label in labels]


def _present(qs, field, labels: dict):
    """Only the values the rows actually carry, A–Z by label."""
    rows = qs.order_by().values(field).annotate(n=Count("pk"))
    return sorted(((r[field], labels.get(r[field], r[field]), r["n"]) for r in rows if r[field]), key=lambda c: c[1])


def _choice_q(field, allowed):
    return lambda v: Q(**{field: v}) if v in allowed else None


#: key → (label, choices(qs) → [(value, label, count)], value → Q | None)
FILTERS = {
    "subject": (
        "Subject",
        lambda qs: _fixed(qs, {s.value: Q(subject=s.value) for s in Subject}, [(s.value, s.label) for s in Subject]),
        _choice_q("subject", set(Subject.values)),
    ),
    "status": (
        "Status",
        lambda qs: _fixed(qs, {s: Q(status=s) for s, _ in _STATUS_LABELS}, _STATUS_LABELS),
        _choice_q("status", set(QuestionStatus.values)),
    ),
    "difficulty": (
        "Difficulty",
        lambda qs: _fixed(qs, _DIFFICULTY, [*((d.value, d.label) for d in Difficulty), ("none", "Not set")]),
        _DIFFICULTY.get,
    ),
    "classified": (
        "Domain",
        lambda qs: _fixed(qs, _CLASSIFIED, (("yes", "Classified"), ("no", "Unclassified"))),
        _CLASSIFIED.get,
    ),
    "source": (
        "Source",
        lambda qs: _present(qs, "source_type", dict(SourceType.choices)),
        _choice_q("source_type", set(SourceType.values)),
    ),
}

_ORDERING = {
    "qb_id": ("qb_id",),
    "-qb_id": ("-qb_id",),
    "created": ("created_at",),
    "-created": ("-created_at",),
    "updated": ("updated_at",),
    "-updated": ("-updated_at",),
}


@extend_schema(tags=["questionbank"])
class BankQuestionChangeListView(APIView):
    permission_classes = QB_PERMISSIONS

    def get(self, request):
        params = request.query_params
        qs = BankQuestion.objects.all()

        # Every word must appear somewhere — the QB-ID, the external id or the question text.
        for term in (params.get("q") or "").split()[:5]:
            qs = qs.filter(
                Q(qb_id__icontains=term) | Q(external_id__icontains=term) | Q(question_text__icontains=term)
            )

        chosen = {}
        for key, (_, _, to_q) in FILTERS.items():
            value = (params.get(key) or "").strip()
            q = to_q(value) if value else None
            if q is not None:
                chosen[key] = (value, q)

        def applied(base, skip=None):
            for key, (_, q) in chosen.items():
                if key != skip:
                    base = base.filter(q)
            return base

        filters = [
            {
                "key": key,
                "label": label,
                "options": [{"value": v, "label": lab, "count": n} for v, lab, n in choices(applied(qs, skip=key))],
                "selected": chosen[key][0] if key in chosen else None,
            }
            for key, (label, choices, _) in FILTERS.items()
        ]

        ordering = params.get("o") or DEFAULT_ORDERING
        if ordering not in _ORDERING:
            ordering = DEFAULT_ORDERING
        qs = applied(qs).order_by(*_ORDERING[ordering], "-pk")

        count = qs.count()
        size = _int_or_none(params.get("page_size"))
        size = size if size in PAGE_SIZES else DEFAULT_PAGE_SIZE
        pages = max(1, -(-count // size))
        page = min(max(_int_or_none(params.get("page")) or 1, 1), pages)
        window = qs.select_related(
            "domain", "skill", "passage", "import_batch", "suggested_domain", "suggested_skill",
        )[(page - 1) * size: page * size]
        return Response({
            "count": count,
            "page": page,
            "page_size": size,
            "pages": pages,
            "ordering": ordering,
            "results": qb.BankQuestionListSerializer(window, many=True).data,
            "filters": filters,
        })
