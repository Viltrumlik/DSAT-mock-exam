"""Admin/builder endpoints for authoring full mocks + their 4 modules of questions.

Reuses the exams Question editor (AdminQuestionSerializer + dense ordering). A mock owns 2
sections (English/Math), each with 2 exams.Modules provisioned at create.
"""

from __future__ import annotations

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from access.permissions import CanManageQuestions
from core.authz import can_manage_questions
from exams.models import Module, Question
from exams.question_ordering import dense_compact_module_orders_locked, reindex_module_questions_dense_locked
from exams.sat_rules import SAT_MODULE_QUESTION_COUNT, SAT_MODULE_TIME_LIMIT_MINUTES
from exams.serializers import AdminQuestionSerializer
from exams.views import _mutable_admin_question_payload

from .admin_serializers import AdminMockSerializer, publish_check
from .models import Mock, MockSection

READING_WRITING = "READING_WRITING"
MATH = "MATH"


class AdminMockViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminMockSerializer

    def get_queryset(self):
        if not can_manage_questions(self.request.user):
            return Mock.objects.none()
        return Mock.objects.all().order_by("-created_at")

    def perform_create(self, serializer):
        mock = serializer.save(created_by=self.request.user)
        if not mock.sections.exists():
            for subject in (READING_WRITING, MATH):
                mins = SAT_MODULE_TIME_LIMIT_MINUTES.get(subject, 32)
                m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=mins)
                m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=mins)
                MockSection.objects.create(mock=mock, subject=subject, module1=m1, module2=m2)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        mock = self.get_object()
        ready, reason = publish_check(mock)
        if not ready:
            return Response({"detail": reason}, status=status.HTTP_400_BAD_REQUEST)
        mock.is_published = True
        mock.published_at = timezone.now()
        mock.save(update_fields=["is_published", "published_at", "updated_at"])
        return Response(self.get_serializer(mock).data)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        mock = self.get_object()
        mock.is_published = False
        mock.save(update_fields=["is_published", "updated_at"])
        return Response(self.get_serializer(mock).data)


class AdminMockModuleQuestionViewSet(viewsets.ModelViewSet):
    """Question editor for one module of a mock (module must belong to the mock)."""

    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminQuestionSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _module(self) -> Module:
        mock_pk = self.kwargs["mock_pk"]
        module_pk = self.kwargs["module_pk"]
        section = MockSection.objects.filter(
            mock_id=mock_pk
        ).filter(Q(module1_id=module_pk) | Q(module2_id=module_pk)).first()
        if section is None:
            raise DRFValidationError({"detail": "Module does not belong to this mock."})
        return section.module1 if section.module1_id == int(module_pk) else section.module2

    def _subject(self) -> str:
        mock_pk = self.kwargs["mock_pk"]
        module_pk = self.kwargs["module_pk"]
        section = MockSection.objects.filter(
            mock_id=mock_pk
        ).filter(Q(module1_id=module_pk) | Q(module2_id=module_pk)).first()
        return section.subject if section else READING_WRITING

    def get_queryset(self):
        module_pk = self.kwargs.get("module_pk")
        return Question.objects.filter(module_id=module_pk).order_by("order", "id")

    def create(self, request, *args, **kwargs):
        module = self._module()
        subject = self._subject()
        data = _mutable_admin_question_payload(request)

        def absent(key):
            v = data.get(key)
            return v is None or v == ""

        if absent("question_type"):
            data["question_type"] = "MATH" if subject == MATH else "READING"
        if absent("correct_answer") and absent("correct_answers"):
            data["correct_answer"] = "a"
        if absent("score"):
            data["score"] = 10

        serializer = self.get_serializer(data=data)
        serializer.context["is_stub_create"] = True
        serializer.is_valid(raise_exception=True)
        current = Question.objects.filter(module_id=module.pk).count()
        cap = SAT_MODULE_QUESTION_COUNT.get(subject, 30)
        if current >= cap:
            raise DRFValidationError({"non_field_errors": [f"This module already has the maximum {cap} questions."]})
        serializer.save(module=module, order=current)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_destroy(self, instance):
        module_id = instance.module_id
        instance.delete()
        dense_compact_module_orders_locked(module_id)

    @action(detail=False, methods=["post"], url_path="bulk-import")
    def bulk_import(self, request, mock_pk=None, module_pk=None):
        """
        Append questions to this mock module from an uploaded CSV (multipart field
        ``file``). All-or-nothing: every row is validated through AdminQuestionSerializer;
        if any row is invalid or the SAT per-module cap would be exceeded, nothing is
        imported and a 400 lists the offending rows.
        """
        from exams.question_csv_import import import_questions_csv

        module = self._module()
        subject = self._subject()
        upload = request.FILES.get("file")
        if upload is None:
            return Response(
                {"detail": "Attach a CSV file in the 'file' field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cap = SAT_MODULE_QUESTION_COUNT.get(subject, 30)
        subj_label = "Reading & Writing" if subject == READING_WRITING else "Math"
        cap_label = f"{subj_label} Module {module.module_order}"
        created, err = import_questions_csv(
            module=module,
            subject=subject,
            raw_bytes=upload.read(),
            cap=cap,
            cap_label=cap_label,
        )
        if err is not None:
            return Response(err, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"module_id": module.pk, "created_count": len(created), "question_ids": created},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="bulk-reorder")
    def bulk_reorder(self, request, mock_pk=None, module_pk=None):
        ordered = request.data.get("ordered_ids") or []
        reindex_module_questions_dense_locked(int(module_pk), list(ordered))
        return Response(self.get_serializer(self.get_queryset(), many=True).data)
