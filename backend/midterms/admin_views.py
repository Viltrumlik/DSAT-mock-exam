"""Admin/builder endpoints for authoring midterms + their single module of questions.

Reuses the exams Question editor (AdminQuestionSerializer + dense ordering) but resolves the
midterm's single owned exams.Module from ``midterm_pk`` — so the builder never deep-links
through the mock-exam/test/module route.
"""

from __future__ import annotations

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
from exams.question_ordering import (
    dense_compact_module_orders_locked,
    reindex_module_questions_dense_locked,
)
from exams.serializers import AdminQuestionSerializer
from exams.views import _mutable_admin_question_payload

from .admin_serializers import AdminMidtermSerializer, _publish_check
from .models import Midterm


class AdminMidtermViewSet(viewsets.ModelViewSet):
    """CRUD + publish for midterm definitions (staff only)."""

    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminMidtermSerializer

    def get_queryset(self):
        if not can_manage_questions(self.request.user):
            return Midterm.objects.none()
        return Midterm.objects.all().order_by("-created_at")

    def _sync_module_time(self, midterm):
        if midterm.question_module_id:
            mins = max(1, int(midterm.duration_minutes or 60))
            Module.objects.filter(pk=midterm.question_module_id).update(time_limit_minutes=mins)

    def perform_create(self, serializer):
        midterm = serializer.save(created_by=self.request.user)
        # Provision the single owned Module (module_order=1, practice_test=NULL).
        if not midterm.question_module_id:
            module = Module.objects.create(
                practice_test=None, module_order=1, time_limit_minutes=max(1, int(midterm.duration_minutes or 60))
            )
            midterm.question_module = module
            midterm.save(update_fields=["question_module"])

    def perform_update(self, serializer):
        midterm = serializer.save()
        self._sync_module_time(midterm)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        midterm = self.get_object()
        ready, reason = _publish_check(midterm)
        if not ready:
            return Response({"detail": reason}, status=status.HTTP_400_BAD_REQUEST)
        midterm.is_published = True
        midterm.published_at = timezone.now()
        midterm.save(update_fields=["is_published", "published_at", "updated_at"])
        return Response(self.get_serializer(midterm).data)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        midterm = self.get_object()
        midterm.is_published = False
        midterm.save(update_fields=["is_published", "updated_at"])
        return Response(self.get_serializer(midterm).data)


class AdminMidtermQuestionViewSet(viewsets.ModelViewSet):
    """Question editor for a midterm's single module (reuses exams AdminQuestionSerializer)."""

    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminQuestionSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _midterm(self) -> Midterm:
        return get_object_or_404(Midterm, pk=self.kwargs["midterm_pk"])

    def _module(self) -> Module:
        midterm = self._midterm()
        if not midterm.question_module_id:
            module = Module.objects.create(
                practice_test=None, module_order=1, time_limit_minutes=max(1, int(midterm.duration_minutes or 60))
            )
            midterm.question_module = module
            midterm.save(update_fields=["question_module"])
        return midterm.question_module

    def get_queryset(self):
        midterm = Midterm.objects.filter(pk=self.kwargs.get("midterm_pk")).first()
        if midterm is None or not midterm.question_module_id:
            return Question.objects.none()
        return Question.objects.filter(module_id=midterm.question_module_id).order_by("order", "id")

    def create(self, request, *args, **kwargs):
        midterm = self._midterm()
        data = _mutable_admin_question_payload(request)

        def absent(key):
            v = data.get(key)
            return v is None or v == ""

        if absent("question_type"):
            data["question_type"] = "MATH" if midterm.subject == Midterm.MATH else "READING"
        if absent("correct_answer") and absent("correct_answers"):
            data["correct_answer"] = "a"
        if absent("score"):
            data["score"] = 10

        serializer = self.get_serializer(data=data)
        serializer.context["is_stub_create"] = True  # allow a blank question to be filled later
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        midterm = self._midterm()
        module = self._module()
        limit = int(midterm.question_limit or 30)
        current = Question.objects.filter(module_id=module.pk).count()
        if current >= limit:
            raise DRFValidationError(
                {"non_field_errors": [f"This midterm already has {current} questions — the maximum is {limit}."]}
            )
        serializer.save(module=module, order=current)

    def perform_destroy(self, instance):
        module_id = instance.module_id
        instance.delete()
        dense_compact_module_orders_locked(module_id)

    @action(detail=False, methods=["post"], url_path="bulk-reorder")
    def bulk_reorder(self, request, midterm_pk=None):
        module = self._module()
        ordered = request.data.get("ordered_ids") or []
        reindex_module_questions_dense_locked(module.id, list(ordered))
        return Response(self.get_serializer(self.get_queryset(), many=True).data)
