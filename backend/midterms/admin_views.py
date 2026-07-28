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
        # BOTH modules follow their own authored duration, or module 2's Module row silently
        # drifts from Midterm.duration_minutes_2.
        if midterm.question_module_id:
            Module.objects.filter(pk=midterm.question_module_id).update(
                time_limit_minutes=max(1, midterm.duration_for_order(1) or 60)
            )
        if midterm.question_module_2_id:
            Module.objects.filter(pk=midterm.question_module_2_id).update(
                time_limit_minutes=max(1, midterm.duration_for_order(2) or 60)
            )

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
    """Question editor for a midterm's module(s) (reuses exams AdminQuestionSerializer).

    Reading with NO ``?module=`` returns the WHOLE paper — module 1 then module 2. The only
    consumer is the Review Center, which fetches this endpoint once and passes no param, so
    scoping reads to module 1 would show an auditor half a two-module midterm and let them
    approve a paper they never saw (and 404 on any module-2 question by id). Pass ``?module=1``
    or ``?module=2`` to work on one module.
    """

    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminQuestionSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _module_order(self, default: int = 1) -> int:
        # `module_order`, never `module`, on the write path: `module` is the Question model's
        # own FK attname, so a payload that ever carries the module PK would silently route
        # creation into module 2 whenever that PK happened to be 2.
        raw = self.request.query_params.get("module") or self.request.data.get("module_order")
        if raw is None:
            return default
        try:
            return 2 if int(raw) == 2 else 1
        except (TypeError, ValueError):
            return default

    def _midterm(self) -> Midterm:
        return get_object_or_404(Midterm, pk=self.kwargs["midterm_pk"])

    def _module(self) -> Module:
        """The module a WRITE targets. Module 1 is provisioned on demand; module 2 is NOT.

        Auto-creating module 2 here would silently convert a single-module midterm into a
        two-module one the moment a question was added to it — the runtime is opt-in via
        ``MockExam.midterm_two_module_runtime`` precisely so it is never inferred (see
        midterms/sync.py). Every student starting that published midterm would suddenly be
        served a two-part paper.
        """
        midterm = self._midterm()
        order = self._module_order()
        if order == 2:
            if not midterm.question_module_2_id:
                raise DRFValidationError(
                    {
                        "non_field_errors": [
                            "This midterm has no second module. Enable the two-module runtime "
                            "for it in the builder before adding module-2 questions."
                        ]
                    }
                )
            return midterm.question_module_2
        if not midterm.question_module_id:
            module = Module.objects.create(
                practice_test=None,
                module_order=1,
                time_limit_minutes=max(1, midterm.duration_for_order(1) or 60),
            )
            midterm.question_module = module
            midterm.save(update_fields=["question_module"])
        return midterm.question_module

    def get_queryset(self):
        midterm = Midterm.objects.filter(pk=self.kwargs.get("midterm_pk")).first()
        if midterm is None:
            return Question.objects.none()
        requested = self.request.query_params.get("module")
        if requested is not None:
            return midterm.questions_for_order(self._module_order())
        # Whole paper, in sitting order (module 1 then module 2).
        module_ids = [i for i in (midterm.question_module_id, midterm.question_module_2_id) if i]
        if not module_ids:
            return Question.objects.none()
        return Question.objects.filter(module_id__in=module_ids).order_by(
            "module__module_order", "order", "id"
        )

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
        # question_limit is a PER-MODULE authoring cap (it sizes one timed module), so it is
        # counted against this module's own rows — but the message names the module so a
        # two-module midterm's "30" doesn't read as a whole-paper limit of 30.
        limit = int(midterm.question_limit or 30)
        current = Question.objects.filter(module_id=module.pk).count()
        if current >= limit:
            where = f"Module {module.module_order}" if midterm.question_module_2_id else "This midterm"
            raise DRFValidationError(
                {"non_field_errors": [f"{where} already has {current} questions — the maximum is {limit}."]}
            )
        serializer.save(module=module, order=current)

    def perform_destroy(self, instance):
        module_id = instance.module_id
        instance.delete()
        dense_compact_module_orders_locked(module_id)

    @action(detail=False, methods=["post"], url_path="bulk-reorder")
    def bulk_reorder(self, request, midterm_pk=None):
        # Reordering never PROVISIONS anything — _module() only creates module 1 on demand,
        # and rejects a module-2 request on a midterm that has no second module.
        module = self._module()
        ordered = request.data.get("ordered_ids") or []
        reindex_module_questions_dense_locked(module.id, list(ordered))
        return Response(self.get_serializer(self.get_queryset(), many=True).data)
