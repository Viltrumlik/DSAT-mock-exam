"""Read-only Question Bank admin API (Phase A).

Exposure over the existing ``questionbank`` models for the admin browsing UI.
No writes here — triage/import mutations live in their own milestone. Auth gate is
global-staff-only (``CanManageQuestions``); ``IsAuthenticatedAndNotFrozen`` is the
project default but is listed explicitly for clarity.
"""
from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status as http_status
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import CanManageQuestions
from users.permissions import IsAuthenticatedAndNotFrozen

from . import audit, serializers as qb, triage
from .import_pipeline import promote_batch
from .models import (
    BankDomain,
    BankPassage,
    BankQuestion,
    BankQuestionVersion,
    BankSkill,
    ImportBatch,
    ImportCandidate,
)
from .triage import TriageError

QB_PERMISSIONS = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

_TRUTHY = {"1", "true", "yes", "on"}


def _truthy(raw) -> bool:
    return str(raw or "").strip().lower() in _TRUTHY


def _int_or_none(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class QbPagination(LimitOffsetPagination):
    """Project has no global PAGE_SIZE, so plain LimitOffset would return an
    unwrapped list; this gives a paginated envelope with sane bounds."""

    default_limit = 50
    max_limit = 200


@extend_schema(tags=["questionbank"])
class BankQuestionListView(generics.ListAPIView):
    """GET /api/questionbank/questions/ — filter/search the bank."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.BankQuestionListSerializer
    pagination_class = QbPagination

    def get_queryset(self):
        qs = BankQuestion.objects.select_related(
            "domain", "skill", "passage", "import_batch",
            "suggested_domain", "suggested_skill",
        )
        p = self.request.query_params
        if p.get("subject"):
            qs = qs.filter(subject=p["subject"])
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("difficulty"):
            qs = qs.filter(difficulty=p["difficulty"])
        source = p.get("source") or p.get("source_type")
        if source:
            qs = qs.filter(source_type=source)
        if (domain_id := _int_or_none(p.get("domain"))) is not None:
            qs = qs.filter(domain_id=domain_id)
        if (skill_id := _int_or_none(p.get("skill"))) is not None:
            qs = qs.filter(skill_id=skill_id)
        if (batch_id := _int_or_none(p.get("import_batch"))) is not None:
            qs = qs.filter(import_batch_id=batch_id)
        term = (p.get("search") or p.get("q") or "").strip()
        if term:
            qs = qs.filter(Q(qb_id__icontains=term) | Q(question_text__icontains=term))
        return qs.order_by("-created_at", "-id")


@extend_schema(tags=["questionbank"])
class BankQuestionDetailView(generics.RetrieveAPIView):
    """GET /api/questionbank/questions/<id>/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.BankQuestionDetailSerializer
    queryset = BankQuestion.objects.select_related(
        "domain", "skill", "passage", "import_batch",
        "suggested_domain", "suggested_skill", "current_version",
    )


@extend_schema(tags=["questionbank"])
class BankPassageListView(generics.ListAPIView):
    """GET /api/questionbank/passages/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.BankPassageSerializer
    pagination_class = QbPagination

    def get_queryset(self):
        qs = BankPassage.objects.all()
        p = self.request.query_params
        if p.get("subject"):
            qs = qs.filter(subject=p["subject"])
        if (batch_id := _int_or_none(p.get("import_batch"))) is not None:
            qs = qs.filter(import_batch_id=batch_id)
        term = (p.get("search") or p.get("q") or "").strip()
        if term:
            qs = qs.filter(passage_text__icontains=term)
        return qs.order_by("-created_at", "-id")


@extend_schema(tags=["questionbank"])
class BankPassageDetailView(generics.RetrieveAPIView):
    """GET /api/questionbank/passages/<id>/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.BankPassageSerializer
    queryset = BankPassage.objects.all()


@extend_schema(
    tags=["questionbank"],
    parameters=[
        OpenApiParameter("bank_question", int, description="Filter to one question's lineage."),
        OpenApiParameter("include_snapshot", bool, description="Include immutable snapshot_json."),
    ],
)
class BankQuestionVersionListView(generics.ListAPIView):
    """GET /api/questionbank/versions/ — append-only version lineage."""

    permission_classes = QB_PERMISSIONS
    pagination_class = QbPagination

    def get_serializer_class(self):
        if _truthy(self.request.query_params.get("include_snapshot")):
            return qb.BankQuestionVersionDetailSerializer
        return qb.BankQuestionVersionSerializer

    def get_queryset(self):
        qs = BankQuestionVersion.objects.all()
        if (bq_id := _int_or_none(self.request.query_params.get("bank_question"))) is not None:
            qs = qs.filter(bank_question_id=bq_id)
        return qs.order_by("bank_question_id", "-version_number")


@extend_schema(tags=["questionbank"], parameters=[OpenApiParameter("subject", str)])
class BankDomainListView(generics.ListAPIView):
    """GET /api/questionbank/domains/ — unpaginated taxonomy for filter dropdowns."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.BankDomainSerializer
    pagination_class = None

    def get_queryset(self):
        qs = BankDomain.objects.all()
        if self.request.query_params.get("subject"):
            qs = qs.filter(subject=self.request.query_params["subject"])
        return qs.order_by("subject", "display_order", "name")


@extend_schema(
    tags=["questionbank"],
    parameters=[OpenApiParameter("domain", int), OpenApiParameter("subject", str)],
)
class BankSkillListView(generics.ListAPIView):
    """GET /api/questionbank/skills/ — unpaginated; filter by domain or subject."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.BankSkillSerializer
    pagination_class = None

    def get_queryset(self):
        qs = BankSkill.objects.select_related("domain")
        p = self.request.query_params
        if (domain_id := _int_or_none(p.get("domain"))) is not None:
            qs = qs.filter(domain_id=domain_id)
        if p.get("subject"):
            qs = qs.filter(domain__subject=p["subject"])
        return qs.order_by("domain__display_order", "display_order", "name")


# ══════════════════════════════════════════════════════════════════════════════
# Triage write API (Phase B) — wraps triage.py; audit iff committed.
# ══════════════════════════════════════════════════════════════════════════════
def _question_response(question: BankQuestion) -> Response:
    return Response(qb.BankQuestionDetailSerializer(question).data)


@extend_schema(tags=["questionbank"])
class BankQuestionClassifyView(APIView):
    """POST /api/questionbank/questions/<id>/classify/ — assign real taxonomy."""

    permission_classes = QB_PERMISSIONS

    def post(self, request, pk):
        question = get_object_or_404(BankQuestion, pk=pk)
        data = qb.TriageClassifyInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        prev = question.status
        v = data.validated_data
        try:
            with transaction.atomic():
                triage.classify_question(
                    question, domain=v["domain"], skill=v["skill"],
                    difficulty=v["difficulty"], user=request.user,
                )
                audit.record_question_event(
                    event_type=audit.EVT_CLASSIFY, question=question, actor=request.user,
                    previous_state=prev, new_state=question.status,
                    extra={"domain_id": v["domain"].id, "skill_id": v["skill"].id, "difficulty": v["difficulty"]},
                )
        except TriageError as exc:
            return Response({"detail": exc.messages}, status=http_status.HTTP_400_BAD_REQUEST)
        return _question_response(question)


@extend_schema(tags=["questionbank"])
class BankQuestionApproveView(APIView):
    """POST /api/questionbank/questions/<id>/approve/ — gate to APPROVED."""

    permission_classes = QB_PERMISSIONS

    def post(self, request, pk):
        question = get_object_or_404(BankQuestion, pk=pk)
        prev = question.status
        try:
            with transaction.atomic():
                triage.approve_question(question, user=request.user)
                audit.record_question_event(
                    event_type=audit.EVT_APPROVE, question=question, actor=request.user,
                    previous_state=prev, new_state=question.status,
                )
        except TriageError as exc:
            return Response({"detail": exc.messages}, status=http_status.HTTP_400_BAD_REQUEST)
        return _question_response(question)


@extend_schema(tags=["questionbank"])
class BankQuestionRejectView(APIView):
    """POST /api/questionbank/questions/<id>/reject/."""

    permission_classes = QB_PERMISSIONS

    def post(self, request, pk):
        question = get_object_or_404(BankQuestion, pk=pk)
        data = qb.TriageRejectInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        prev = question.status
        with transaction.atomic():
            triage.reject_question(question, reason=data.validated_data["reason"], user=request.user)
            audit.record_question_event(
                event_type=audit.EVT_REJECT, question=question, actor=request.user,
                previous_state=prev, new_state=question.status,
                extra={"reason": data.validated_data["reason"]} if data.validated_data["reason"] else None,
            )
        return _question_response(question)


@extend_schema(tags=["questionbank"])
class BankQuestionAcceptSuggestionView(APIView):
    """POST /api/questionbank/questions/<id>/accept-suggestion/ — human applies the advisory hint."""

    permission_classes = QB_PERMISSIONS

    def post(self, request, pk):
        question = get_object_or_404(BankQuestion, pk=pk)
        prev = question.status
        try:
            with transaction.atomic():
                triage.accept_suggestion(question, user=request.user)
                audit.record_question_event(
                    event_type=audit.EVT_ACCEPT_SUGGESTION, question=question, actor=request.user,
                    previous_state=prev, new_state=question.status,
                    extra={"domain_id": question.domain_id, "skill_id": question.skill_id,
                           "difficulty": question.difficulty},
                )
        except TriageError as exc:
            return Response({"detail": exc.messages}, status=http_status.HTTP_400_BAD_REQUEST)
        return _question_response(question)


_BULK_EVENT = {
    "approve": audit.EVT_APPROVE,
    "reject": audit.EVT_REJECT,
    "classify": audit.EVT_CLASSIFY,
}


@extend_schema(tags=["questionbank"])
class BankQuestionBulkView(APIView):
    """POST /api/questionbank/questions/bulk/ — apply one action to many ids; per-id results."""

    permission_classes = QB_PERMISSIONS

    def post(self, request):
        data = qb.BulkTriageInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        action, ids = v["action"], v["ids"]
        results = []
        for qid in ids:
            question = BankQuestion.objects.filter(pk=qid).first()
            if question is None:
                results.append({"id": qid, "ok": False, "error": "not found"})
                continue
            prev = question.status
            try:
                with transaction.atomic():
                    if action == "approve":
                        triage.approve_question(question, user=request.user)
                        extra = None
                    elif action == "reject":
                        triage.reject_question(question, reason=v.get("reason", ""), user=request.user)
                        extra = {"reason": v["reason"]} if v.get("reason") else None
                    else:  # classify
                        triage.classify_question(
                            question, domain=v["domain"], skill=v["skill"],
                            difficulty=v["difficulty"], user=request.user,
                        )
                        extra = {"domain_id": v["domain"].id, "skill_id": v["skill"].id, "difficulty": v["difficulty"]}
                    audit.record_question_event(
                        event_type=_BULK_EVENT[action], question=question, actor=request.user,
                        previous_state=prev, new_state=question.status, extra=extra,
                    )
                results.append({"id": qid, "ok": True, "status": question.status})
            except TriageError as exc:
                results.append({"id": qid, "ok": False, "error": "; ".join(exc.messages)})
        return Response({"action": action, "results": results})


# ══════════════════════════════════════════════════════════════════════════════
# Import batch management (Phase B) — read + promote. Exact-only dedup.
# ══════════════════════════════════════════════════════════════════════════════
@extend_schema(tags=["questionbank"])
class ImportBatchListView(generics.ListAPIView):
    """GET /api/questionbank/import-batches/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.ImportBatchSerializer
    pagination_class = QbPagination

    def get_queryset(self):
        qs = ImportBatch.objects.all()
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs.order_by("-created_at", "-id")


@extend_schema(tags=["questionbank"])
class ImportBatchDetailView(generics.RetrieveAPIView):
    """GET /api/questionbank/import-batches/<id>/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.ImportBatchSerializer
    queryset = ImportBatch.objects.all()


@extend_schema(
    tags=["questionbank"],
    parameters=[OpenApiParameter("validation_status", str, description="VALID|WARNING|ERROR|DUPLICATE")],
)
class ImportCandidateListView(generics.ListAPIView):
    """GET /api/questionbank/import-batches/<batch_id>/candidates/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.ImportCandidateSerializer
    pagination_class = QbPagination

    def get_queryset(self):
        qs = ImportCandidate.objects.filter(batch_id=self.kwargs["batch_id"]).select_related(
            "duplicate_of", "promoted_question"
        )
        vs = self.request.query_params.get("validation_status")
        if vs:
            qs = qs.filter(validation_status=vs)
        return qs.order_by("order", "id")


@extend_schema(tags=["questionbank"])
class ImportCandidateDetailView(generics.RetrieveAPIView):
    """GET /api/questionbank/import-candidates/<id>/."""

    permission_classes = QB_PERMISSIONS
    serializer_class = qb.ImportCandidateSerializer
    queryset = ImportCandidate.objects.select_related("duplicate_of", "promoted_question")


@extend_schema(tags=["questionbank"])
class ImportBatchPromoteView(APIView):
    """POST /api/questionbank/import-batches/<id>/promote/ — VALID/WARNING → TRIAGE bank rows."""

    permission_classes = QB_PERMISSIONS

    def post(self, request, pk):
        batch = get_object_or_404(ImportBatch, pk=pk)
        raw = request.data.get("include_warnings")
        include_warnings = True if raw is None else _truthy(raw)
        with transaction.atomic():
            promoted = promote_batch(batch, include_warnings=include_warnings, user=request.user)
            audit.record_batch_event(batch=batch, actor=request.user, promoted_count=promoted)
        return Response(qb.ImportBatchSerializer(batch).data, status=http_status.HTTP_200_OK)
