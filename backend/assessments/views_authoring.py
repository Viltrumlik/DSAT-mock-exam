from __future__ import annotations

from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
import logging
from access.permissions import (
    CanAuthorAssessmentContent,
    CanViewTests,
)
from access.services import (
    is_global_scope_staff,
    user_domain_subject,
)
from access import constants as acc_const
from users.permissions import IsAuthenticatedAndNotFrozen
from .models import (
    AssessmentSet,
    AssessmentSetVersion,
    AssessmentQuestion,
)
from .serializers import (
    AssessmentSetSerializer,
    AssessmentSetAdminSerializer,
    AssessmentSetAdminWriteSerializer,
    AssessmentSetVersionSerializer,
    AdminPublishResponseSerializer,
    AssessmentQuestionAdminWriteSerializer,
    ApiAssessmentDetailSerializer,
)


class AdminAssessmentSetListCreateView(APIView):
    # Default; method-specific permissions are enforced in get_permissions().
    permission_classes = [IsAuthenticatedAndNotFrozen]

    def get_permissions(self):
        if (self.request.method or "GET").upper() == "GET":
            return [p() for p in (IsAuthenticatedAndNotFrozen, CanViewTests)]
        return [p() for p in (IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent)]

    def get(self, request):
        subject = (request.query_params.get("subject") or "").strip().lower()
        category = (request.query_params.get("category") or "").strip()
        qs = AssessmentSet.objects.all().prefetch_related("questions")

        # Subject scoping:
        # - teachers: forced to their own domain subject (ignore query param)
        # - admin/test_admin/super_admin: may see all subjects; optional filter via query param
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds in (acc_const.DOMAIN_MATH, acc_const.DOMAIN_ENGLISH):
                qs = qs.filter(subject=ds)
        else:
            if subject in (acc_const.DOMAIN_MATH, acc_const.DOMAIN_ENGLISH):
                qs = qs.filter(subject=subject)

        if category:
            qs = qs.filter(category__iexact=category)
        qs = qs.order_by("-created_at", "-id")

        paginator = LimitOffsetPagination()
        paginator.default_limit = 50
        paginator.max_limit = 200
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            return paginator.get_paginated_response(AssessmentSetSerializer(page, many=True).data)
        return Response(AssessmentSetSerializer(qs, many=True).data)

    def post(self, request):
        s = AssessmentSetAdminWriteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        inst = s.save(created_by=request.user)
        inst = AssessmentSet.objects.filter(pk=inst.pk).prefetch_related("questions").first()
        return Response(AssessmentSetSerializer(inst).data, status=status.HTTP_201_CREATED)


class AdminAssessmentSetDetailView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen]

    def get_permissions(self):
        if (self.request.method or "GET").upper() == "GET":
            return [p() for p in (IsAuthenticatedAndNotFrozen, CanViewTests)]
        return [p() for p in (IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent)]

    def get(self, request, pk: int):
        inst = get_object_or_404(AssessmentSet.objects.prefetch_related("questions"), pk=pk)
        # Teacher scoping defense-in-depth (detail endpoints).
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and inst.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        # Use admin serializer so the builder UI receives correct_answer + grading_config
        # (the student-facing AssessmentSetSerializer intentionally omits correct_answer).
        return Response(AssessmentSetAdminSerializer(inst).data)

    def patch(self, request, pk: int):
        inst = get_object_or_404(AssessmentSet, pk=pk)
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and inst.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        s = AssessmentSetAdminWriteSerializer(inst, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        inst = s.save()
        inst = AssessmentSet.objects.filter(pk=inst.pk).prefetch_related("questions").first()
        return Response(AssessmentSetSerializer(inst).data)

    def delete(self, request, pk: int):
        inst = get_object_or_404(AssessmentSet, pk=pk)
        actor = request.user
        if not is_global_scope_staff(actor) and not getattr(actor, "is_superuser", False):
            ds = user_domain_subject(actor)
            if ds and inst.subject != ds:
                return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        inst.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


_bank_sync_logger = logging.getLogger(__name__)


def _sync_question_to_bank(q) -> None:
    """Best-effort mirror of an authored assessment question into the Question Bank.
    Runs after commit; a failure is logged but never blocks assessment authoring."""
    def _run():
        try:
            from .domain.bank_sync import sync_assessment_question_to_bank
            sync_assessment_question_to_bank(q)
        except Exception:  # noqa: BLE001
            _bank_sync_logger.exception(
                "assessment→bank sync failed for question %s", getattr(q, "pk", None)
            )

    transaction.on_commit(_run)


class AdminAssessmentQuestionCreateView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def post(self, request, set_pk: int):
        aset = get_object_or_404(AssessmentSet, pk=set_pk)
        s = AssessmentQuestionAdminWriteSerializer(data={**request.data, "assessment_set": aset.pk})
        s.is_valid(raise_exception=True)
        # Default append order if not specified.
        if "order" not in s.validated_data:
            mx = (
                AssessmentQuestion.objects.filter(assessment_set=aset).aggregate(Max("order")).get("order__max")
                or 0
            )
            s.validated_data["order"] = int(mx) + 1
        q = s.save(assessment_set=aset)
        _sync_question_to_bank(q)
        return Response(AssessmentQuestionAdminWriteSerializer(q).data, status=status.HTTP_201_CREATED)


class AdminAssessmentQuestionDetailView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def patch(self, request, pk: int):
        q = get_object_or_404(AssessmentQuestion, pk=pk)
        s = AssessmentQuestionAdminWriteSerializer(q, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        q = s.save()
        _sync_question_to_bank(q)
        return Response(AssessmentQuestionAdminWriteSerializer(q).data)

    def delete(self, request, pk: int):
        q = get_object_or_404(AssessmentQuestion, pk=pk)
        q.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminQuestionBankSelectView(APIView):
    """
    M4 — list APPROVED Question Bank questions for the builder's
    'Select From Question Bank' picker. Only status=APPROVED is ever returned;
    TRIAGE/IMPORTED/REJECTED/ARCHIVED questions are never selectable.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def get(self, request):
        from .domain.bank_integration import selectable_bank_questions

        qs = selectable_bank_questions(
            subject=request.query_params.get("subject") or None,
            domain_id=request.query_params.get("domain_id") or None,
            skill_id=request.query_params.get("skill_id") or None,
            difficulty=request.query_params.get("difficulty") or None,
            search=request.query_params.get("search") or None,
        )
        paginator = LimitOffsetPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        data = [
            {
                "id": q.id,
                "qb_id": q.qb_id,
                "subject": q.subject,
                "domain": q.domain.name if q.domain_id else None,
                "skill": q.skill.name if q.skill_id else None,
                "difficulty": q.difficulty,
                "question_type": q.question_type,
                "question_text": q.question_text,
                "current_version": q.current_version.version_number if q.current_version_id else None,
            }
            for q in page
        ]
        return paginator.get_paginated_response(data)


class AdminAssessmentQuestionFromBankView(APIView):
    """M4 — create an AssessmentQuestion sourced from an APPROVED bank question."""

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def post(self, request, set_pk: int):
        from django.core.exceptions import ValidationError as DjangoValidationError

        from questionbank.models import BankQuestion

        from .domain.bank_integration import create_question_from_bank

        aset = get_object_or_404(AssessmentSet, pk=set_pk)
        bank = get_object_or_404(BankQuestion, pk=request.data.get("bank_question_id"))
        try:
            aq = create_question_from_bank(aset, bank, order=request.data.get("order"))
        except DjangoValidationError as exc:
            msg = exc.messages[0] if getattr(exc, "messages", None) else str(exc)
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
        return Response(AssessmentQuestionAdminWriteSerializer(aq).data, status=status.HTTP_201_CREATED)


class AdminQuestionBankTaxonomyView(APIView):
    """
    M4 — domains & skills actually used by APPROVED bank questions, for the builder
    picker's filter dropdowns.

    Lives here (not in questionbank's own API) because the questionbank taxonomy
    endpoint is gated by CanManageQuestions (global staff only) and would 403 for
    teachers — who CAN author assessments and therefore use the picker.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    def get(self, request):
        from questionbank.models import BankDomain, BankQuestion, BankSkill

        approved = BankQuestion.objects.approved()
        subject = request.query_params.get("subject") or None
        if subject:
            approved = approved.filter(subject=subject)
        domain_ids = list(approved.values_list("domain_id", flat=True).distinct())
        skill_ids = list(approved.values_list("skill_id", flat=True).distinct())
        domains = BankDomain.objects.filter(id__in=domain_ids).order_by(
            "subject", "display_order", "name"
        )
        skills = BankSkill.objects.filter(id__in=skill_ids).select_related("domain").order_by(
            "display_order", "name"
        )
        return Response(
            {
                "domains": [
                    {"id": d.id, "subject": d.subject, "name": d.name, "code": d.code}
                    for d in domains
                ],
                "skills": [
                    {
                        "id": s.id,
                        "domain": s.domain_id,
                        "subject": s.domain.subject,
                        "name": s.name,
                        "code": s.code,
                    }
                    for s in skills
                ],
            }
        )


class AdminPublishAssessmentSetView(APIView):
    """
    POST /assessments/admin/sets/{pk}/publish/

    Transition an AssessmentSet from DRAFT → PUBLISHED state by building an
    immutable AssessmentSetVersion snapshot.

    GOVERNANCE:
      - Enforces all publish preconditions (INV-001 through INV-003 from PublishService).
      - Idempotent: re-publishing identical content returns existing version (HTTP 200).
      - Creating a new version returns HTTP 201.
      - Concurrency-safe via select_for_update() inside publish_assessment_set().

    FRONTEND INTEGRATION:
      Currently the publish page calls PATCH is_active=true (legacy toggle).
      Sprint 5: swap publishSet() in builder/sets/[id]/publish/page.tsx to call this endpoint.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanAuthorAssessmentContent]

    @extend_schema(
        tags=["assessments"],
        summary="Publish assessment set (create immutable snapshot)",
        responses={
            200: AdminPublishResponseSerializer,
            201: AdminPublishResponseSerializer,
            400: ApiAssessmentDetailSerializer,
            404: ApiAssessmentDetailSerializer,
        },
    )
    def post(self, request, pk: int):
        from .domain.publish_service import publish_assessment_set, PublishValidationError

        # Determine whether a version already exists before publishing so we can
        # return the correct HTTP status (200 = idempotent / 201 = new version).
        existing_count = AssessmentSetVersion.objects.filter(assessment_set_id=pk).count()

        try:
            version = publish_assessment_set(set_id=pk, actor=request.user)
        except AssessmentSet.DoesNotExist:
            return Response({"detail": f"AssessmentSet #{pk} not found."}, status=status.HTTP_404_NOT_FOUND)
        except PublishValidationError as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

        new_count = AssessmentSetVersion.objects.filter(assessment_set_id=pk).count()
        created = new_count > existing_count

        data = {
            "version": AssessmentSetVersionSerializer(version).data,
            "created": created,
        }
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class AdminValidatePublishView(APIView):
    """
    GET /assessments/admin/sets/{pk}/validate-publish/

    Dry-run publish validation — returns the full validation report without
    creating a version or changing any state.

    Used by the builder pre-publish checklist page to surface blocking and
    warning findings before the user commits to publishing.

    Response shape:
        {
            "is_publishable": bool,
            "blocking_count": int,
            "warning_count": int,
            "findings": [
                {"severity": "blocking"|"warning", "code": str, "message": str,
                 "question_id": int|null, "context": dict},
                ...
            ]
        }
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanViewTests]

    @extend_schema(
        tags=["assessments"],
        summary="Dry-run publish validation (no state change)",
        responses={200: None, 404: ApiAssessmentDetailSerializer},
    )
    def get(self, request, pk: int):
        from .domain.publish_validator import validate_for_publish

        aset = get_object_or_404(AssessmentSet, pk=pk)
        active_questions = list(
            AssessmentQuestion.objects.filter(
                assessment_set=aset, is_active=True
            ).order_by("order", "id")
        )
        report = validate_for_publish(aset, active_questions)
        return Response(report.to_dict())


class AdminAssessmentSetVersionListView(APIView):
    """
    GET /assessments/admin/sets/{pk}/versions/

    List all published versions for an AssessmentSet, newest first.
    Used by the builder version history panel.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanViewTests]

    @extend_schema(
        tags=["assessments"],
        summary="List published versions for a set",
        responses={200: AssessmentSetVersionSerializer(many=True)},
    )
    def get(self, request, pk: int):
        aset = get_object_or_404(AssessmentSet, pk=pk)
        versions = AssessmentSetVersion.objects.filter(assessment_set=aset).select_related(
            "published_by"
        ).order_by("-version_number")
        return Response(AssessmentSetVersionSerializer(versions, many=True).data)
