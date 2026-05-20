from rest_framework import viewsets, status, generics
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.permissions import IsAuthenticated
from rest_framework.permissions import IsAdminUser
from rest_framework.exceptions import PermissionDenied
from rest_framework.exceptions import ValidationError as DRFValidationError
import logging
from django.shortcuts import get_object_or_404
from django.utils import timezone
import time
from time import monotonic

from django.db import IntegrityError, OperationalError, transaction
from django.conf import settings
from django.http import HttpResponse
from datetime import timedelta
import hashlib
import json
from django.db.models import Prefetch

from access import constants as acc_const
from access.permissions import CanManageQuestions, RequiresSubmitTest
from access.policies import (
    BulkAssignAccess,
    BulkAssignmentHistoryAccess,
)
from core.authz import actor_subject_probe_for_domain_perm, authorize, can_manage_questions, normalized_role
from access.services import (
    bulk_assign_request_platform_subjects,
    can_browse_standalone_practice_library,
    filter_mock_exams_for_user,
    filter_practice_tests_for_user,
    get_effective_permission_codenames,
    student_has_any_subject_grant,
)
from access.subject_mapping import platform_subject_to_domain

from .library_bulk_assign import (
    execute_library_bulk_assign,
    infer_dispatch_kind,
    subject_summary_from_subjects,
)
from .models import (
    AuditLog,
    BulkAssignmentDispatch,
    MockExam,
    Module,
    PastpaperPack,
    PortalMockExam,
    PracticeTest,
    Question,
    TestAttempt,
    ensure_full_mock_practice_test_modules,
)
from .serializers import (
    MockExamSerializer,
    PastpaperPackStudentSerializer,
    PortalMockExamStudentSerializer,
    PracticeTestSerializer,
    TestAttemptSerializer,
    ModuleSerializer,
    AdminMockExamSerializer,
    AdminPastpaperPackSerializer,
    AdminPracticeTestSerializer,
    AdminModuleSerializer,
    AdminQuestionSerializer,
    BulkAssignmentDispatchSerializer,
    BulkAssignmentDispatchDetailSerializer,
)
from core.idempotency import consume as consume_idempotency
from .tasks import score_attempt_async
from core.metrics import incr as metric_incr, incr_role as metric_incr_role
from .metrics import get_counter
from .prometheus import render_exams_prometheus_text
from .attempt_timing import get_active_module_timing
from .engine_integrity import autoheal_attempt_for_runtime
from config.error_reporting import report_error
from config.reliability import conflict_response

from exams.engine_db_guard import TransitionConflict

logger = logging.getLogger(__name__)


def _enforce_attempt_student(request, attempt: TestAttempt) -> None:
    if getattr(attempt, "student_id", None) != getattr(request.user, "pk", None):
        raise PermissionDenied("This attempt belongs to another user.")

def _expected_attempt_version(request) -> int | None:
    raw = request.data.get("expected_version_number")
    if raw is None:
        raw = request.headers.get("If-Match")
    if raw is None:
        return None
    try:
        return int(str(raw).strip().strip('"'))
    except (TypeError, ValueError):
        return None


def _enqueue_scoring_when_in_scoring_state(*, attempt_id: int, request=None) -> None:
    """After module-2 submission the attempt is persisted as SCORING; worker completes scoring."""
    trace_id = getattr(request, "trace_id", None) if request is not None else None
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        score_attempt_async.delay(attempt_id, trace_id=trace_id)
    elif bool(getattr(settings, "EXAMS_SCORE_INLINE_IF_NO_CELERY", False)):
        score_attempt_async(attempt_id, trace_id=trace_id)
    metric_incr("scoring_enqueued")


def _version_conflict_response(view, request, *, attempt: TestAttempt) -> Response:
    metric_incr("version_conflict")
    # Always return canonical state so client can resync.
    attempt = TestAttempt.objects.get(pk=attempt.pk)
    return Response(
        {
            "error": "Version conflict.",
            "detail": "Attempt was updated elsewhere; refresh required.",
            "attempt": view.get_serializer(attempt).data,
        },
        status=status.HTTP_409_CONFLICT,
    )


def _refetch_attempt_for_api(view, pk: int) -> TestAttempt:
    return (
        TestAttempt.objects.select_related("practice_test", "current_module")
        .prefetch_related("practice_test__modules", "current_module__questions")
        .get(pk=pk)
    )


def _transition_conflict_response(view, *, attempt_pk: int, detail: str | None = None) -> Response:
    """After a guarded state transition misses (0-row update), reload and return authoritative attempt JSON."""
    metric_incr("exam_engine_transition_conflict_total")
    refreshed = _refetch_attempt_for_api(view, attempt_pk)
    return conflict_response(
        detail=detail
        or "Exam engine state changed concurrently; use the snapshot in this response and retry if needed.",
        code="exam_engine_transition_conflict",
        extra={"attempt": view.get_serializer(refreshed).data},
    )


def _exam_deadline_hit_response(view, *, attempt_pk: int) -> Response:
    """Explicit submit after module deadline (server timers); autosave-only path submits on timer expiry."""
    refreshed = _refetch_attempt_for_api(view, attempt_pk)
    setattr(refreshed, "is_expired", True)
    return conflict_response(
        detail="Module time limit has elapsed; explicit submit is not accepted. Answers are persisted via autosave before the cutoff.",
        code="exam_module_deadline_passed",
        extra={"attempt": view.get_serializer(refreshed).data},
    )

def _is_student(user) -> bool:
    return str(getattr(user, "role", "") or "").strip().lower() == "student"


def _actor_snapshot(user, *, subject: str | None) -> dict:
    if not getattr(user, "is_authenticated", False):
        return {}
    role = normalized_role(user)
    username = getattr(user, "username", None) or ""
    email = getattr(user, "email", None) or ""
    first_name = getattr(user, "first_name", None) or ""
    last_name = getattr(user, "last_name", None) or ""
    return {
        "id": user.pk,
        "role": role,
        "subject": subject,
        "username": username,
        "email": email,
        "name": (f"{first_name} {last_name}".strip() or username or email) or f"User #{user.pk}",
    }


def _idempotency_key_for_bulk_assign(actor, payload_core: dict) -> str:
    """
    Stable idempotency key derived from actor + normalized payload core.
    """
    base = {
        "actor_id": getattr(actor, "pk", None),
        "exam_ids": payload_core.get("exam_ids") or [],
        "practice_test_ids": payload_core.get("practice_test_ids") or [],
        "user_ids": payload_core.get("user_ids") or [],
        "assignment_type": payload_core.get("assignment_type") or "",
        "form_type": payload_core.get("form_type") or "",
    }
    blob = json.dumps(base, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class MockExamViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Timed diagnostic mocks (staff-authored sections, not the pastpaper library).
    List: PortalMockExam rows for students. Retrieve: mock shell + sections for /mock/:id.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = MockExamSerializer

    def list(self, request, *args, **kwargs):
        user = request.user
        perms = get_effective_permission_codenames(user)
        if acc_const.WILDCARD in perms:
            return super().list(request, *args, **kwargs)
        if acc_const.PERM_MANAGE_TESTS in perms or acc_const.PERM_ASSIGN_ACCESS in perms:
            return super().list(request, *args, **kwargs)

        qs = (
            PortalMockExam.objects.filter(
                is_active=True,
                mock_exam__is_active=True,
                mock_exam__is_published=True,
                assigned_users=user,
            )
            .select_related("mock_exam")
            .prefetch_related("mock_exam__tests")
        )
        return Response(PortalMockExamStudentSerializer(qs, many=True).data)

    def get_queryset(self):
        user = self.request.user
        perms = get_effective_permission_codenames(user)
        base = MockExam.objects.filter(is_active=True)
        tests_prefetch = Prefetch(
            "tests",
            queryset=PracticeTest.objects.all().prefetch_related("modules"),
        )
        if acc_const.WILDCARD in perms:
            return base.prefetch_related(tests_prefetch)
        if acc_const.PERM_MANAGE_TESTS in perms or acc_const.PERM_ASSIGN_ACCESS in perms:
            return filter_mock_exams_for_user(user, base).prefetch_related(tests_prefetch)

        allowed_mock_ids = PortalMockExam.objects.filter(
            is_active=True,
            mock_exam__is_active=True,
            mock_exam__is_published=True,
            assigned_users=user,
        ).values_list("mock_exam_id", flat=True)
        return (
            base.filter(id__in=allowed_mock_ids)
            .prefetch_related(tests_prefetch)
            .distinct()
        )


class PastpaperPackStudentListView(generics.ListAPIView):
    """
    Student-facing pastpaper pack hub: returns packs that have at least one
    section with questions.  Students see only published packs that have at
    least one section explicitly assigned to them.
    Teachers/admins/super_admins see all packs (published or not).
    """

    permission_classes = [AllowAny]
    serializer_class = PastpaperPackStudentSerializer

    def get_queryset(self):
        base = (
            PastpaperPack.objects.filter(
                sections__mock_exam__isnull=True,
                sections__modules__questions__isnull=False,
            )
            .prefetch_related("sections__modules")
            .distinct()
            .order_by("-practice_date", "-created_at")
        )
        user = self.request.user
        if not user.is_authenticated:
            return base.none()
        if normalized_role(user) == acc_const.ROLE_STUDENT:
            # Students only see published packs they are assigned to.
            return base.filter(
                is_published=True,
                sections__assigned_users=user,
            ).distinct()
        # Teachers, admins, super_admins: full catalog (published + unpublished).
        return base


class PastpaperPackStudentDetailView(generics.RetrieveAPIView):
    """Single pack detail — same serializer as the list view."""

    permission_classes = [AllowAny]
    serializer_class = PastpaperPackStudentSerializer

    def get_queryset(self):
        base = (
            PastpaperPack.objects.filter(
                sections__mock_exam__isnull=True,
                sections__modules__questions__isnull=False,
            )
            .prefetch_related("sections__modules")
            .distinct()
        )
        user = self.request.user
        if not user.is_authenticated:
            return base.none()
        if normalized_role(user) == acc_const.ROLE_STUDENT:
            # Students can only access their assigned published packs.
            return base.filter(is_published=True, sections__assigned_users=user).distinct()
        return base


class PracticeTestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Pastpaper / skill practice only: standalone PracticeTest rows (no mock_exam).
    Timed mocks and their sections are only exposed via mock-exams + /mock/:id.

    List/retrieve are **AllowAny** so the Next.js practice catalog can load without cookies;
    starting an attempt still requires auth on ``TestAttemptViewSet``.
    """

    permission_classes = [AllowAny]
    serializer_class = PracticeTestSerializer

    def get_queryset(self):
        """
        Anonymous + students + staff who can browse: ``filter_practice_tests_for_user`` (full bank
        for anon/students; subject-scoped for teachers). Other authenticated roles: ``assigned_users``
        only (legacy).
        """
        user = self.request.user
        # Student practice library must never surface empty tests (no questions); the exam runner
        # requires a non-empty `current_module_details.questions` payload.
        base = (
            PracticeTest.objects.filter(mock_exam__isnull=True, modules__questions__isnull=False)
            .select_related("mock_exam", "pastpaper_pack")
            .prefetch_related("modules")
            .distinct()
        )
        if can_browse_standalone_practice_library(user):
            return filter_practice_tests_for_user(user, base).distinct()
        if not user.is_authenticated:
            # Unauthenticated: show nothing (assignment required)
            return base.none()
        if normalized_role(user) == acc_const.ROLE_STUDENT:
            # Students see only tests explicitly assigned to them by a teacher/admin.
            return base.filter(assigned_users=user).distinct()
        return base.filter(assigned_users=user).distinct()

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticated, BulkAssignAccess])
    def bulk_assign(self, request):
        def _as_int_ids(seq):
            out = []
            for x in seq or []:
                try:
                    out.append(int(x))
                except (TypeError, ValueError):
                    continue
            return out

        exam_ids = _as_int_ids(request.data.get("exam_ids"))
        practice_test_ids = _as_int_ids(request.data.get("practice_test_ids"))
        user_ids = _as_int_ids(request.data.get("user_ids"))
        assignment_type = request.data.get("assignment_type", "FULL")
        form_type = request.data.get("form_type")

        from django.contrib.auth import get_user_model

        User = get_user_model()
        users = list(User.objects.filter(id__in=user_ids))

        if not user_ids:
            return Response({"detail": "user_ids is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not users:
            return Response({"detail": "No matching users for the given user_ids."}, status=status.HTTP_400_BAD_REQUEST)
        if not exam_ids and not practice_test_ids:
            return Response(
                {"detail": "Provide exam_ids (mock exams) and/or practice_test_ids (pastpaper tests)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload_core = {
            "exam_ids": exam_ids,
            "practice_test_ids": practice_test_ids,
            "user_ids": user_ids,
            "assignment_type": str(assignment_type or "FULL"),
            "form_type": str(form_type).strip() if form_type else None,
        }
        idempotency_key = _idempotency_key_for_bulk_assign(request.user, payload_core)
        window_start = timezone.now() - timedelta(minutes=10)
        existing = (
            BulkAssignmentDispatch.objects.filter(
                assigned_by=request.user,
                idempotency_key=idempotency_key,
                created_at__gte=window_start,
            )
            .exclude(status=BulkAssignmentDispatch.STATUS_FAILED)
            .order_by("-created_at")
            .first()
        )
        if existing:
            body = {
                "detail": "Duplicate bulk assignment detected within idempotency window.",
                "dispatch_id": existing.pk,
                "dispatch_status": existing.status,
            }
            if isinstance(existing.result, dict):
                body["result"] = existing.result
            return Response(body, status=status.HTTP_409_CONFLICT)

        raw_cc = request.data.get("client_context")
        allowed_cc = {
            "wizard_kind",
            "pastpaper_pack_id",
            "pastpaper_scope",
            "mock_exam_id",
            "content_label",
            "track_filter",
        }
        client_context = (
            {k: raw_cc[k] for k in allowed_cc if k in raw_cc}
            if isinstance(raw_cc, dict)
            else {}
        )
        payload = {
            **payload_core,
            "client_context": client_context,
        }

        subjects = bulk_assign_request_platform_subjects(payload_core)
        snapshot = _actor_snapshot(
            request.user,
            subject=(getattr(request.user, "subject", None) or ""),
        )

        dispatch = BulkAssignmentDispatch.objects.create(
            assigned_by=request.user,
            kind=infer_dispatch_kind(exam_ids, practice_test_ids),
            subject_summary="",
            students_requested_count=0,
            students_granted_count=0,
            status=BulkAssignmentDispatch.STATUS_PROCESSING,
            payload=payload,
            result={},
            actor_snapshot=snapshot,
            idempotency_key=idempotency_key,
            idempotency_expires_at=timezone.now() + timedelta(minutes=10),
        )

        try:
            with transaction.atomic():
                result = execute_library_bulk_assign(
                    actor=request.user,
                    exam_ids=exam_ids,
                    practice_test_ids=practice_test_ids,
                    user_ids=user_ids,
                    assignment_type=str(assignment_type or "FULL"),
                    form_type=str(form_type).strip() if form_type else None,
                )
        except Exception as exc:  # defensive: persist failure outcome
            dispatch.status = BulkAssignmentDispatch.STATUS_FAILED
            dispatch.result = {
                "error": exc.__class__.__name__,
                "detail": str(exc),
            }
            dispatch.save(update_fields=["status", "result"])
            raise

        dispatch.subject_summary = subject_summary_from_subjects(result.get("subjects_touched") or [])
        dispatch.students_requested_count = int(result.get("students_requested_count") or 0)
        dispatch.students_granted_count = int(result.get("students_granted_count") or 0)
        dispatch.status = BulkAssignmentDispatch.STATUS_COMPLETED
        dispatch.result = result
        dispatch.save(
            update_fields=[
                "subject_summary",
                "students_requested_count",
                "students_granted_count",
                "status",
                "result",
            ]
        )

        out = {
            **result,
            "dispatch_id": dispatch.pk,
            "dispatch_status": dispatch.status,
        }
        return Response(out)

class TestAttemptViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, RequiresSubmitTest]
    serializer_class = TestAttemptSerializer
    throttle_scope = "burst"
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return (
            TestAttempt.objects.filter(student=self.request.user)
            .select_related(
                "current_module",
                "practice_test",
                "practice_test__mock_exam",
                "practice_test__pastpaper_pack",
            )
            .prefetch_related(
                "practice_test__modules",
                "current_module__questions",
            )
        )

    def create(self, request, *args, **kwargs):
        t0 = monotonic()
        test_id = request.data.get("practice_test")
        user = request.user
        # Permission scope for which PracticeTest rows this user may target (questions checked next).
        unrestricted = PracticeTest.objects.all().select_related("mock_exam", "pastpaper_pack")
        if can_browse_standalone_practice_library(user):
            allowed = filter_practice_tests_for_user(user, unrestricted).distinct()
        elif normalized_role(user) == acc_const.ROLE_STUDENT:
            allowed = filter_practice_tests_for_user(user, unrestricted).distinct()
        else:
            allowed = unrestricted.filter(assigned_users=user).distinct()

        test = get_object_or_404(allowed, id=test_id)
        if not test.has_questions_for_attempts():
            return Response(
                {
                    "code": "practice_test_empty",
                    "message": "Practice test has no questions",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── SAT section-order + break enforcement (MOCK_SAT and Pastpapers) ────
        # R&W must be completed before Math. After R&W completes the student
        # must wait SAT_BREAK_SECONDS before the Math section unlocks.
        # Both MOCK_SAT exams and standalone PastpaperPacks are full SAT
        # simulations and therefore inherit identical realism enforcement.
        test_mock = getattr(test, "mock_exam", None)
        test_pack = getattr(test, "pastpaper_pack", None)
        is_sat_simulation = (
            (test_mock is not None and test_mock.kind == MockExam.KIND_MOCK_SAT)
            or test_pack is not None
        )
        if is_sat_simulation and test.subject == "MATH":
            from .sat_rules import SAT_BREAK_SECONDS
            from datetime import timedelta
            # Locate the student's completed R&W attempt for the same exam context.
            if test_mock is not None:
                rw_filter: dict = {
                    "practice_test__mock_exam": test_mock,
                    "practice_test__subject": "READING_WRITING",
                }
            else:
                rw_filter = {
                    "practice_test__pastpaper_pack": test_pack,
                    "practice_test__subject": "READING_WRITING",
                }
            rw_attempt = (
                TestAttempt.objects.filter(
                    student=user,
                    is_completed=True,
                    **rw_filter,
                )
                .order_by("-completed_at")
                .first()
            )
            if rw_attempt is None:
                return Response(
                    {
                        "code": "section_order_violation",
                        "detail": "Complete the Reading & Writing section before starting Math.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Break timer starts when R&W module 2 was submitted (or at completion).
            break_start = rw_attempt.module_2_submitted_at or rw_attempt.completed_at
            if break_start is not None:
                break_ends_at = break_start + timedelta(seconds=SAT_BREAK_SECONDS)
                now = timezone.now()
                if now < break_ends_at:
                    return Response(
                        {
                            "code": "break_required",
                            "detail": "break_required",
                            "break_ends_at": break_ends_at.isoformat(),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        # Get-or-create active attempt (concurrency-safe under DB constraint).
        # Business rule: abandoning is recoverable, so we reuse the latest abandoned attempt
        # only if there is no other canonical active (non-abandoned) attempt.
        # SQLite can raise "database table is locked" under thread races.
        # In production (Postgres) this path is not expected, but in tests we retry briefly.
        last_exc: Exception | None = None
        attempt = None
        for _ in range(4):
            try:
                with transaction.atomic():
                    # Important for SQLite (test runner): avoid SELECT ... FOR UPDATE on the table
                    # before attempting an insert, as it can trigger "database table is locked" under threads.
                    try:
                        attempt = TestAttempt.objects.create(
                        student=request.user,
                        practice_test=test,
                        mock_exam=getattr(test, "mock_exam", None),
                    )
                    except IntegrityError:
                        # Reset rollback flag after IntegrityError so we can still query in this atomic block.
                        transaction.set_rollback(False)
                        metric_incr("active_attempt_duplicates_prevented")
                        attempt = (
                            TestAttempt.objects.select_for_update()
                            .select_related("practice_test", "current_module")
                            .filter(student=request.user, practice_test=test, is_completed=False)
                            .exclude(current_state=TestAttempt.STATE_ABANDONED)
                            .order_by("-id")
                            .first()
                        )
                        if attempt is None:
                            attempt = (
                                TestAttempt.objects.select_for_update()
                                .select_related("practice_test", "current_module")
                                .filter(
                                    student=request.user,
                                    practice_test=test,
                                    is_completed=False,
                                    current_state=TestAttempt.STATE_ABANDONED,
                                )
                                .order_by("-id")
                                .first()
                            )
                        if attempt is None:
                            report_error(
                                "exams.attempt_create_integrity_error_no_canonical",
                                context={"user_id": request.user.pk, "practice_test_id": test.pk},
                            )
                            raise

                    _enforce_attempt_student(request, attempt)
                    # Authoritative start/resume: entering the runner should immediately be in MODULE_1_ACTIVE
                    # for new attempts, or return canonical current state for existing incomplete attempts.
                    ensure_full_mock_practice_test_modules(attempt.practice_test)
                    autoheal_attempt_for_runtime(attempt)
                    attempt.start_attempt()
                last_exc = None
                break
            except TransitionConflict:
                return _transition_conflict_response(
                    self,
                    attempt_pk=attempt.pk,
                    detail="Exam attempt raced while starting; use the snapshot in this response and retry.",
                )
            except OperationalError as exc:
                last_exc = exc
                time.sleep(0.05)
                continue

        if last_exc is not None or attempt is None:
            metric_incr("slo_exam_start_fail_total")
            metric_incr_role("slo_exam_start_fail_total", actor=getattr(request, "user", None))
            raise last_exc or OperationalError("Could not create attempt due to database lock.")

        # Re-fetch canonical state for response (start_attempt mutates state/FKs).
        refreshed = None
        for _ in range(6):
            try:
                refreshed = TestAttempt.objects.select_related("practice_test", "current_module").get(pk=attempt.pk)
                break
            except OperationalError:
                time.sleep(0.05)
        if refreshed is None:
            raise OperationalError("Could not load attempt after create due to database lock.")
        attempt = refreshed
        
        AuditLog.objects.create(
            user=request.user,
            action="START_TEST",
            details=f"Started practice test: {test}"
        )
            
        serializer = self.get_serializer(attempt)
        metric_incr("slo_exam_start_ok_total")
        metric_incr_role("slo_exam_start_ok_total", actor=getattr(request, "user", None))
        metric_incr("slo_exam_start_latency_ms_sum", int((monotonic() - t0) * 1000))
        metric_incr("slo_exam_start_latency_ms_count")
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # NOTE: `status` is defined once below (canonical resume payload).

    @action(detail=True, methods=["post"], url_path="resume")
    def resume(self, request, pk=None):
        """
        Locks the attempt row and normalizes canonical engine state via ``start_attempt`` only.
        Legacy ``*_SUBMITTED`` repairs are CLI-only (`repair_exam_integrity`).
        """
        attempt0 = self.get_object()
        _enforce_attempt_student(request, attempt0)

        def _compute():
            try:
                t0 = monotonic()
                with transaction.atomic():
                    locked = (
                        TestAttempt.objects.select_for_update()
                        .select_related("practice_test", "current_module")
                        .get(pk=attempt0.pk)
                    )
                    _enforce_attempt_student(request, locked)
                    ensure_full_mock_practice_test_modules(locked.practice_test)
                    autoheal_attempt_for_runtime(locked)
                    locked.start_attempt()
                attempt = (
                    TestAttempt.objects.select_related("practice_test", "current_module")
                    .prefetch_related("practice_test__modules", "current_module__questions")
                    .get(pk=attempt0.pk)
                )
                metric_incr("slo_exam_resume_ok_total")
                metric_incr_role("slo_exam_resume_ok_total", actor=getattr(request, "user", None))
                metric_incr("slo_exam_resume_latency_ms_sum", int((monotonic() - t0) * 1000))
                metric_incr("slo_exam_resume_latency_ms_count")
                return Response(self.get_serializer(attempt).data)
            except TransitionConflict:
                return _transition_conflict_response(
                    self,
                    attempt_pk=attempt0.pk,
                    detail="Exam attempt state conflict; refresh from the snapshot.",
                )
            except Exception as exc:
                metric_incr("slo_exam_resume_fail_total")
                metric_incr_role("slo_exam_resume_fail_total", actor=getattr(request, "user", None))
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return consume_idempotency(attempt=attempt0, endpoint="resume", request=request, compute=_compute)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """
        Start the attempt: always starts Module 1 (backend authoritative).
        """
        attempt = self.get_object()
        if attempt.is_completed:
            return Response({"error": "Cannot start a completed attempt."}, status=status.HTTP_400_BAD_REQUEST)
        _enforce_attempt_student(request, attempt)

        ensure_full_mock_practice_test_modules(attempt.practice_test)
        m1 = attempt.practice_test.modules.filter(module_order=1).order_by("id").first()
        if not m1:
            return Response({"error": "Module 1 is missing."}, status=status.HTTP_400_BAD_REQUEST)

        def _compute():
            try:
                t0 = monotonic()
                with transaction.atomic():
                    locked = TestAttempt.objects.select_for_update().get(pk=attempt.pk)
                    _enforce_attempt_student(request, locked)
                    autoheal_attempt_for_runtime(locked)
                    locked.start_attempt()
                metric_incr("slo_exam_engine_start_ok_total")
                metric_incr_role("slo_exam_engine_start_ok_total", actor=getattr(request, "user", None))
                metric_incr("slo_exam_engine_start_latency_ms_sum", int((monotonic() - t0) * 1000))
                metric_incr("slo_exam_engine_start_latency_ms_count")
                refreshed = (
                    TestAttempt.objects.select_related("practice_test", "current_module")
                    .prefetch_related("practice_test__modules", "current_module__questions")
                    .get(pk=attempt.pk)
                )
                return Response(self.get_serializer(refreshed).data)
            except TransitionConflict:
                return _transition_conflict_response(self, attempt_pk=attempt.pk, detail="Exam attempt state conflict; refresh from the snapshot.")
            except Exception as exc:
                metric_incr("slo_exam_engine_start_fail_total")
                metric_incr_role("slo_exam_engine_start_fail_total", actor=getattr(request, "user", None))
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return consume_idempotency(attempt=attempt, endpoint="start", request=request, compute=_compute)

    @action(detail=True, methods=['post'])
    def start_module(self, request, pk=None):
        attempt = self.get_object()
        module_id = request.data.get('module_id')
        
        # Defensive: ensure full mock sections always have both modules provisioned.
        ensure_full_mock_practice_test_modules(attempt.practice_test)

        module = get_object_or_404(Module, id=module_id, practice_test=attempt.practice_test)
        
        if attempt.is_completed:
            return Response({'error': 'Cannot start module for a completed test'}, status=status.HTTP_400_BAD_REQUEST)
        _enforce_attempt_student(request, attempt)

        def _compute():
            try:
                with transaction.atomic():
                    locked_pre = (
                        TestAttempt.objects.select_for_update()
                        .select_related("practice_test", "current_module")
                        .get(pk=attempt.pk)
                    )
                    _enforce_attempt_student(request, locked_pre)
                    timing = get_active_module_timing(locked_pre)
                    if timing and timing.is_expired and locked_pre.current_state in (
                        TestAttempt.STATE_MODULE_1_ACTIVE,
                        TestAttempt.STATE_MODULE_2_ACTIVE,
                    ):
                        locked_pre.is_expired = True  # serializer reads this attribute
                        return Response({"error": "Module time expired."}, status=status.HTTP_409_CONFLICT)

                    locked = locked_pre
                    autoheal_attempt_for_runtime(locked)
                    # Legacy endpoint: keep for compatibility, but enforce canonical rules:
                    # - module 1 start → start_attempt
                    # - module 2 start → only allowed if engine is already MODULE_2_ACTIVE
                    if int(getattr(module, "module_order", 0) or 0) == 1:
                        locked.start_attempt()
                    else:
                        locked.start_module(module)
                return Response(self.get_serializer(TestAttempt.objects.get(pk=attempt.pk)).data)
            except TransitionConflict:
                return _transition_conflict_response(self, attempt_pk=attempt.pk, detail="Exam attempt state conflict; refresh from the snapshot.")
            except Exception as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        
        AuditLog.objects.create(
            user=request.user,
            action="START_MODULE",
            details=f"Started module {module.module_order} of {attempt.practice_test}"
        )

        return consume_idempotency(attempt=attempt, endpoint="start_module", request=request, compute=_compute)

    @action(detail=True, methods=['post'])
    def submit_module(self, request, pk=None):
        attempt0 = self.get_object()
        _enforce_attempt_student(request, attempt0)
        expected_v = _expected_attempt_version(request)

        def _compute():
            try:
                t0 = monotonic()
                with transaction.atomic():
                    # Defensive: ensure full mock sections always have both modules provisioned.
                    ensure_full_mock_practice_test_modules(attempt0.practice_test)
                    
                    # Lock row to prevent race conditions.
                    # Postgres limitation: FOR UPDATE cannot target the nullable side of an OUTER JOIN.
                    # Since `current_module` is nullable, avoid joining it in the locked query.
                    attempt = TestAttempt.objects.select_for_update().get(pk=attempt0.pk)
                    _enforce_attempt_student(request, attempt)
                    attempt = (
                        TestAttempt.objects.select_related("practice_test", "current_module")
                        .get(pk=attempt.pk)
                    )
                    autoheal_attempt_for_runtime(attempt)

                    # IMPORTANT (production): submit must not be blocked by expected_version_number mismatches.
                    # Autosave/polling can legitimately bump version_number right before a user clicks Submit.
                    # For submit we treat this as a SOFT conflict: we log it, but continue under the row lock
                    # and return canonical state after commit.
                    if expected_v is not None and int(attempt.version_number or 0) != int(expected_v):
                        logger.warning(
                            "[FORENSIC] submit_module_soft_version_conflict attempt_id=%s req_v=%s db_v=%s",
                            attempt.id,
                            expected_v,
                            attempt.version_number,
                        )
                    
                    if not attempt.current_module:
                        logger.error("[FORENSIC] submit_module_no_active_module attempt_id=%s", attempt.id)
                        return Response({'error': 'No active module to submit'}, status=status.HTTP_400_BAD_REQUEST)

                    timing = get_active_module_timing(attempt)
                    if timing and timing.is_expired:
                        metric_incr("exam_module_deadline_blocked_submit_total")
                        return _exam_deadline_hit_response(self, attempt_pk=attempt.pk)

                    module_answers = request.data.get('answers', {})
                    flagged = request.data.get('flagged', [])
                    
                    submitting_module_order = int(getattr(attempt.current_module, "module_order", 0) or 0)

                    transitioned_to_scoring = False
                    if submitting_module_order == 1:
                        attempt.submit_module_1(module_answers, flagged)
                    elif submitting_module_order == 2:
                        transitioned_to_scoring = bool(attempt.submit_module_2(module_answers, flagged))
                    else:
                        raise DRFValidationError(
                            f"Cannot submit: invalid current module order {submitting_module_order} (state={attempt.current_state})"
                        )

                    # First successful M2→SCORING transition enqueues; duplicate submits noop (no duplicate jobs).
                    if transitioned_to_scoring:
                        _enqueue_scoring_when_in_scoring_state(attempt_id=attempt.pk, request=request)

                # Re-fetch canonical state after transaction commit for response.
                attempt = TestAttempt.objects.select_related("practice_test", "current_module").prefetch_related(
                    "practice_test__modules", "current_module__questions"
                ).get(pk=attempt0.pk)

                serializer = self.get_serializer(attempt)
                resp_data = serializer.data
                logger.info(
                    "[FORENSIC] submit_module_response attempt_id=%s state=%s mod=%s v=%s",
                    attempt.id, attempt.current_state, attempt.current_module_id, attempt.version_number
                )
                metric_incr("slo_module_submit_ok_total")
                metric_incr_role("slo_module_submit_ok_total", actor=getattr(request, "user", None))
                metric_incr("slo_module_submit_latency_ms_sum", int((monotonic() - t0) * 1000))
                metric_incr("slo_module_submit_latency_ms_count")
                return Response(resp_data)

            except TransitionConflict as e:
                logger.warning(
                    "[FORENSIC] submit_module_transition_conflict attempt_id=%s error=%s",
                    getattr(attempt0, "id", None),
                    str(e),
                )
                return _transition_conflict_response(self, attempt_pk=attempt0.pk)
            except Exception as e:
                logger.exception("[FORENSIC] submit_module_exception attempt_id=%s error=%s", getattr(attempt0, "id", None), str(e))
                metric_incr("slo_module_submit_fail_total")
                metric_incr_role("slo_module_submit_fail_total", actor=getattr(request, "user", None))
                return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return consume_idempotency(attempt=attempt0, endpoint="submit_module", request=request, compute=_compute)


    @action(detail=True, methods=['post'])
    def save_attempt(self, request, pk=None):
        attempt0 = self.get_object()
        _enforce_attempt_student(request, attempt0)
        expected_v = _expected_attempt_version(request)

        def _compute():
            expired = False
            scoring_from_timeout = False
            try:
                with transaction.atomic():
                    attempt = (
                        TestAttempt.objects.select_for_update()
                        .select_related("current_module")
                        .get(pk=attempt0.pk)
                    )
                    _enforce_attempt_student(request, attempt)
                    if not attempt.current_module:
                        return Response({'error': 'No active module to save'}, status=status.HTTP_400_BAD_REQUEST)
                    if expected_v is not None and int(attempt.version_number or 0) != int(expected_v):
                        return _version_conflict_response(self, request, attempt=attempt)

                    timing = get_active_module_timing(attempt)
                    if timing and timing.is_expired:
                        module_answers = request.data.get('answers', {}) or {}
                        flagged = request.data.get('flagged', []) or []
                        order = int(getattr(attempt.current_module, "module_order", 0) or 0)
                        if order == 1:
                            attempt.submit_module_1(module_answers, flagged)
                        elif order == 2:
                            scoring_from_timeout = bool(attempt.submit_module_2(module_answers, flagged))
                        else:
                            attempt.is_expired = True
                            return Response({"error": "Module time expired."}, status=status.HTTP_409_CONFLICT)
                        expired = True

                    module_answers = request.data.get('answers', {}) if not (timing and timing.is_expired) else None
                    flagged = request.data.get('flagged', []) if not (timing and timing.is_expired) else None

                    if module_answers is not None:
                        attempt.module_answers[str(attempt.current_module.id)] = module_answers
                        attempt.flagged_questions[str(attempt.current_module.id)] = flagged
                        attempt.version_number = int(attempt.version_number or 0) + 1
                        attempt.save(update_fields=["module_answers", "flagged_questions", "version_number", "updated_at"])

                attempt = (
                    TestAttempt.objects.select_related("practice_test", "current_module")
                    .prefetch_related("practice_test__modules", "current_module__questions")
                    .get(pk=attempt0.pk)
                )
                if expired:
                    attempt.is_expired = True
                if scoring_from_timeout and attempt.current_state == TestAttempt.STATE_SCORING:
                    _enqueue_scoring_when_in_scoring_state(attempt_id=attempt.pk, request=request)
                return Response(self.get_serializer(attempt).data)
            except TransitionConflict:
                return _transition_conflict_response(self, attempt_pk=attempt0.pk)

        return consume_idempotency(attempt=attempt0, endpoint="save_attempt", request=request, compute=_compute)

    @action(detail=True, methods=["get"], url_path="status")
    def status(self, request, pk=None):
        """
        Read-only attempt payload for polling/status UI.

        IMPORTANT: do not lock or mutate state in GET requests.
        All state transitions happen in POST endpoints (start/save/submit).
        """
        attempt0 = self.get_object()
        attempt = (
            TestAttempt.objects.select_related("practice_test", "current_module")
            .prefetch_related("practice_test__modules", "current_module__questions")
            .get(pk=attempt0.pk)
        )
        return Response(self.get_serializer(attempt).data)

    @action(detail=True, methods=['get'])
    def review(self, request, pk=None):
        attempt = self.get_object()
        if attempt.current_state != TestAttempt.STATE_COMPLETED or not getattr(attempt, "is_completed", False):
            raise PermissionDenied("Review is available only after you submit the test.")
        module_id_param = request.query_params.get('module_id')
        
        questions_data = []
        total_answered = 0
        total_correct = 0
        total_questions = 0
        
        # Performance optimization: Fetch all relevant modules and questions at once
        relevant_module_ids = [mid for mid in attempt.module_answers.keys() 
                             if not module_id_param or str(mid) == str(module_id_param)]
        
        modules = Module.objects.filter(id__in=relevant_module_ids).prefetch_related('questions')
        modules_map = {str(m.id): m for m in modules}

        for module_id, answers in attempt.module_answers.items():
            if module_id_param and str(module_id) != str(module_id_param):
                continue
                
            module = modules_map.get(str(module_id))
            if not module:
                continue
            
            for q in module.questions.all():
                total_questions += 1
                ans = answers.get(str(q.id))
                
                is_correct = q.check_answer(ans)
                if ans is not None and str(ans).strip() != "": 
                    total_answered += 1
                    if is_correct:
                        total_correct += 1
                
                questions_data.append({
                    'id': q.id,
                    'text': q.question_text,
                    'question_prompt': q.question_prompt,
                    'image': q.question_image.url if q.question_image else None,
                    'type': q.get_question_type_display(),
                    'student_answer': ans,
                    'correct_answers': q.correct_answers,
                    'is_correct': is_correct,
                    'is_math_input': q.is_math_input,
                    'options': q.get_options(),
                })
        
        total_skipped = total_questions - total_answered
        
        pt = attempt.practice_test
        mock = getattr(pt, "mock_exam", None)
        return Response({
            'questions': questions_data,
            'module_results': attempt.get_module_results(),
            'total_questions': total_questions,
            'total_answered': total_answered,
            'total_correct': total_correct,
            'total_incorrect': total_questions - total_correct - total_skipped,
            'total_skipped': total_skipped,
            'total_score': attempt.score,
            'score_percentage': (total_correct / total_questions * 100) if total_questions > 0 else 0,
            # Section context — used by the review page to render the correct score label.
            'subject': getattr(pt, 'subject', None),
            'mock_kind': getattr(mock, 'kind', None),
        })

    @action(detail=True, methods=["get"])
    def results(self, request, pk=None):
        """
        Final results payload (answers/analytics) only when COMPLETED.
        """
        attempt = self.get_object()
        if attempt.current_state != TestAttempt.STATE_COMPLETED or not attempt.is_completed:
            raise PermissionDenied("Results are available only after the attempt is completed.")
        # Reuse existing review payload shape for now (single source for analytics).
        # Frontend can call /results for gatekeeping without exposing review early.
        return self.review(request, pk=pk)


class ExamsMetricsView(APIView):
    """Operational counters for the exam engine (staff)."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(
            {
                "submit_module": get_counter("submit_module"),
                "idempotency_replay": get_counter("idempotency_replay"),
                "submit_duplicate_prevented": get_counter("submit_duplicate_prevented"),
                "version_conflict": get_counter("version_conflict"),
                "scoring_enqueued": get_counter("scoring_enqueued"),
                "scoring_completed": get_counter("scoring_completed"),
            }
        )


class ExamsPrometheusMetricsView(APIView):
    """Prometheus text exposition for exam engine counters (staff endpoint)."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        body = render_exams_prometheus_text()
        return HttpResponse(body, content_type="text/plain; version=0.0.4; charset=utf-8")

# ── Admin CRUD Viewsets ───────────────────────────────────────────────────────

class AdminMockExamViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminMockExamSerializer

    def get_queryset(self):
        base = MockExam.objects.all().prefetch_related(
            "tests__modules",
            "tests__modules__questions",
        )
        if not can_manage_questions(self.request.user):
            return base.none()
        return base

    def perform_create(self, serializer):
        exam = serializer.save()
        self._provision_exam_after_create(exam)

    def _provision_exam_after_create(self, exam: MockExam):
        """Auto-create practice tests: full mock → RW + Math; midterm → one test + custom modules."""
        if exam.kind == MockExam.KIND_MIDTERM:
            if exam.tests.exists():
                return
            cnt = min(2, max(1, exam.midterm_module_count or 1))
            m1 = max(1, exam.midterm_module1_minutes or 60)
            m2 = max(1, exam.midterm_module2_minutes or 60)
            subj = exam.midterm_subject or "READING_WRITING"
            pt = PracticeTest.objects.create(
                mock_exam=exam,
                subject=subj,
                form_type="INTERNATIONAL",
                skip_default_modules=True,
            )
            Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=m1)
            if cnt >= 2:
                Module.objects.create(practice_test=pt, module_order=2, time_limit_minutes=m2)
            return

        # Full SAT mock: admin adds R&W / Math sections via add_test (no forced two-section shell).

    @action(detail=True, methods=['post'])
    def assign_users(self, request, pk=None):
        exam = self.get_object()
        from django.contrib.auth import get_user_model

        User = get_user_model()
        users = list(User.objects.filter(id__in=request.data.get("user_ids", [])))

        tests = list(exam.tests.all())
        required_domains: set[str] = set()
        for t in tests:
            d = platform_subject_to_domain(t.subject)
            if d is not None:
                required_domains.add(d)

        def _may_receive_mock_portal(u) -> bool:
            if normalized_role(u) != acc_const.ROLE_STUDENT:
                return True
            if not required_domains:
                return True
            return all(student_has_any_subject_grant(u, dom) for dom in required_domains)

        users = [u for u in users if _may_receive_mock_portal(u)]
        if not users and request.data.get("user_ids"):
            return Response(
                {
                    "detail": "No eligible users: students must have subject access matching this mock.",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        exam.assigned_users.set(users)
        for test in tests:
            test.assigned_users.set(users)
        portal = PortalMockExam.objects.filter(mock_exam=exam).first()
        if portal:
            portal.assigned_users.set(exam.assigned_users.all())

        actor = request.user
        if getattr(actor, "is_superuser", False) or normalized_role(actor) == acc_const.ROLE_SUPER_ADMIN:
            logger.info(
                "mock_exam_assign_users super_actor_id=%s exam_id=%s user_count=%s",
                actor.pk,
                exam.pk,
                len(users),
            )
        return Response({"status": "assigned", "users_count": len(users)})

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        from django.utils import timezone

        from .publish_service import mock_exam_publish_ready

        exam = self.get_object()
        ok, msg = mock_exam_publish_ready(exam)
        if not ok:
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
        exam.is_published = True
        exam.published_at = timezone.now()
        exam.save(update_fields=["is_published", "published_at", "updated_at"])
        portal, _ = PortalMockExam.objects.get_or_create(
            mock_exam=exam,
            defaults={"is_active": True},
        )
        portal.is_active = True
        portal.save(update_fields=["is_active", "updated_at"])
        if exam.assigned_users.exists():
            portal.assigned_users.set(exam.assigned_users.all())
        exam = MockExam.objects.prefetch_related("tests__modules__questions").get(pk=exam.pk)
        return Response(AdminMockExamSerializer(exam).data)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        exam = self.get_object()
        exam.is_published = False
        exam.published_at = None
        exam.save(update_fields=["is_published", "published_at", "updated_at"])
        PortalMockExam.objects.filter(mock_exam=exam).update(is_active=False)
        exam = MockExam.objects.prefetch_related("tests__modules__questions").get(pk=exam.pk)
        return Response(AdminMockExamSerializer(exam).data)

    @action(detail=True, methods=['post'])
    def add_test(self, request, pk=None):
        """Create a mock-only section (new items; do not reuse pastpaper PracticeTest rows)."""
        exam = self.get_object()
        if exam.kind == MockExam.KIND_MIDTERM:
            return Response(
                {
                    "error": "Midterm exams have a single section with custom modules; add questions under that test."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        subject = request.data.get('subject')
        label = request.data.get('label', '')
        form_type = request.data.get('form_type', 'INTERNATIONAL')
        
        if subject not in ('READING_WRITING', 'MATH'):
            return Response({'error': 'Invalid subject'}, status=status.HTTP_400_BAD_REQUEST)
        
        test = PracticeTest.objects.create(
            mock_exam=exam, 
            subject=subject,
            label=label,
            form_type=form_type
        )
        ensure_full_mock_practice_test_modules(test)
        from .serializers import AdminPracticeTestSerializer
        return Response(AdminPracticeTestSerializer(test).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'])
    def remove_test(self, request, pk=None):
        """Remove a PracticeTest from this MockExam."""
        test_id = request.data.get('test_id')
        test = get_object_or_404(PracticeTest, id=test_id, mock_exam=self.get_object())
        test.delete()
        return Response({'status': 'removed'})


class AdminPastpaperPackViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminPastpaperPackSerializer

    def get_queryset(self):
        base = PastpaperPack.objects.all().prefetch_related(
            "sections__modules",
            "sections__assigned_users",
        )
        if not can_manage_questions(self.request.user):
            return base.none()
        return base.order_by("-practice_date", "-id")

    def perform_update(self, serializer):
        pack = serializer.save()
        PracticeTest.objects.filter(pastpaper_pack=pack).update(
            practice_date=pack.practice_date,
            label=pack.label,
            form_type=pack.form_type,
        )

    @action(detail=True, methods=["post"])
    def add_section(self, request, pk=None):
        pack = self.get_object()
        subject = request.data.get("subject")
        if subject not in ("READING_WRITING", "MATH"):
            return Response({"detail": "Invalid subject."}, status=status.HTTP_400_BAD_REQUEST)
        if pack.sections.filter(subject=subject).exists():
            return Response(
                {"detail": "This pack already has that section."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        title = (request.data.get("title") or "").strip()
        pt = PracticeTest.objects.create(
            mock_exam=None,
            pastpaper_pack=pack,
            subject=subject,
            title=title,
            label=pack.label or "",
            form_type=pack.form_type or "INTERNATIONAL",
            practice_date=pack.practice_date,
        )
        pt = (
            PracticeTest.objects.filter(pk=pt.pk)
            .prefetch_related("modules", "assigned_users")
            .first()
        )
        return Response(AdminPracticeTestSerializer(pt).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        """Mark a pastpaper pack as published (visible to assigned students)."""
        from .sat_rules import pastpaper_pack_publish_violations
        pack = self.get_object()
        violations = pastpaper_pack_publish_violations(pack)
        blocking = [v for v in violations if v.blocking]
        if blocking:
            return Response(
                {
                    "detail": "Cannot publish: pack has blocking SAT violations.",
                    "violations": [{"code": v.code, "message": v.message} for v in blocking],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        pack.is_published = True
        pack.published_at = timezone.now()
        pack.save(update_fields=["is_published", "published_at", "updated_at"])
        return Response(self.get_serializer(pack).data)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        """Retract a pastpaper pack from student view."""
        pack = self.get_object()
        pack.is_published = False
        pack.save(update_fields=["is_published", "updated_at"])
        return Response(self.get_serializer(pack).data)


class AdminPracticeTestViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminPracticeTestSerializer

    def get_queryset(self):
        base = PracticeTest.objects.all().prefetch_related("modules", "assigned_users")
        standalone = self.request.query_params.get("standalone")
        if standalone in ("1", "true", "yes"):
            return base.filter(mock_exam__isnull=True)
        return base


class AdminModuleViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminModuleSerializer

    def get_queryset(self):
        return Module.objects.filter(practice_test_id=self.kwargs['test_pk'])

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['test'] = get_object_or_404(PracticeTest, pk=self.kwargs['test_pk'])
        return ctx

    def perform_create(self, serializer):
        test = get_object_or_404(PracticeTest, pk=self.kwargs['test_pk'])
        serializer.save(practice_test=test)


from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .question_ordering import (
    dense_compact_module_orders_locked,
    reindex_module_questions_dense_locked,
)


def _mutable_admin_question_payload(request) -> dict:
    """Plain dict for merging create defaults (JSON, multipart, or QueryDict)."""
    raw = request.data
    if isinstance(raw, dict):
        return {k: raw[k] for k in raw}
    out: dict = {}
    for key in raw:
        out[key] = raw.get(key)
    return out


def _merge_admin_question_create_defaults(request, kwargs) -> dict:
    """
    Defaults when fields are omitted so admin UI can POST {} for a stub question.
    ``question_type`` is derived from the module's practice test subject (not client-provided).
    """
    data = _mutable_admin_question_payload(request)
    module = get_object_or_404(Module, pk=kwargs["module_pk"], practice_test_id=kwargs["test_pk"])
    pt = module.practice_test

    def absent(key: str) -> bool:
        v = data.get(key)
        return v is None or v == ""

    if absent("question_type"):
        data["question_type"] = "MATH" if pt.subject == "MATH" else "READING"
    if absent("correct_answer") and absent("correct_answers"):
        data["correct_answer"] = "a"
    if absent("score"):
        data["score"] = 10

    return data


class AdminQuestionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, CanManageQuestions]
    serializer_class = AdminQuestionSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]


    def get_queryset(self):
        return (
            Question.objects.filter(
                module_id=self.kwargs["module_pk"],
                module__practice_test_id=self.kwargs["test_pk"],
            )
            .order_by("order", "id")
        )

    def create(self, request, *args, **kwargs):
        merged = _merge_admin_question_create_defaults(request, self.kwargs)
        serializer = self.get_serializer(data=merged)
        # Stub creation: skip content validators (empty text, options, correct_answer
        # cross-check) so the admin can create a blank question and fill it in.
        serializer.context['is_stub_create'] = True
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        module = get_object_or_404(Module, pk=self.kwargs['module_pk'], practice_test_id=self.kwargs['test_pk'])

        # ── SAT question-count gate ───────────────────────────────────────────
        # For full SAT simulations (pastpapers + mock exams), enforce the official
        # per-module question count BEFORE insert.  Midterms are exempt.
        from .sat_rules import SAT_MODULE_QUESTION_COUNT
        from .models import MockExam as _MockExam

        pt = module.practice_test
        exam = getattr(pt, "mock_exam", None) or (
            _MockExam.objects.filter(pk=pt.mock_exam_id).first() if pt.mock_exam_id else None
        )
        is_midterm = bool(exam and exam.kind == _MockExam.KIND_MIDTERM)
        subject = getattr(pt, "subject", None)

        if not is_midterm and subject in SAT_MODULE_QUESTION_COUNT:
            limit = SAT_MODULE_QUESTION_COUNT[subject]
            current = Question.objects.filter(module_id=module.pk).count()
            if current >= limit:
                subj_label = "Reading & Writing" if subject == "READING_WRITING" else "Math"
                raise DRFValidationError(
                    {
                        "non_field_errors": [
                            f"{subj_label} Module {module.module_order} already has "
                            f"{current} question{'s' if current != 1 else ''} — the maximum for this module is {limit}. "
                            f"Remove a question before adding another."
                        ]
                    }
                )

        n = Question.objects.filter(module_id=module.pk).count()
        # ``order`` is the dense insert index (append); ``Question.save`` reindexes under a module lock.
        serializer.save(module=module, order=n)

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        module_id = instance.module_id
        super().perform_destroy(instance)
        dense_compact_module_orders_locked(module_id)

    @action(detail=True, methods=['post'])
    def reorder(self, request, test_pk=None, module_pk=None, pk=None):
        question = self.get_object()
        action_type = request.data.get("action")
        if action_type not in ("up", "down"):
            return Response({"error": "Invalid action"}, status=status.HTTP_400_BAD_REQUEST)

        mid = question.module_id
        with transaction.atomic():
            Module.objects.select_for_update().get(pk=mid)
            rows = list(
                Question.objects.filter(module_id=mid).order_by("order", "id")
            )
            idx = next((i for i, q in enumerate(rows) if q.pk == question.pk), None)
            if idx is None:
                return Response({"error": "Question not in module."}, status=status.HTTP_400_BAD_REQUEST)

            if action_type == "up":
                if idx == 0:
                    return Response(
                        {"message": "Already at boundary"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                rows[idx - 1], rows[idx] = rows[idx], rows[idx - 1]
            else:
                if idx >= len(rows) - 1:
                    return Response(
                        {"message": "Already at boundary"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                rows[idx + 1], rows[idx] = rows[idx], rows[idx + 1]

            reindex_module_questions_dense_locked(mid, rows)

        return Response({"status": "reordered"})

    @action(detail=False, methods=["post"], url_path="bulk-reorder")
    def bulk_reorder(self, request, test_pk=None, module_pk=None):
        """
        Atomically reorder all questions in a module in a single round-trip.

        Request body: { "ordered_ids": [id1, id2, id3, ...] }

        Validation:
        - ``ordered_ids`` must be a non-empty list.
        - Every ID must belong to this module (no cross-module moves).
        - The list must be complete — partial reorders are rejected to prevent
          silent ordering corruption.
        - Duplicate IDs are rejected.

        Concurrency: holds a SELECT FOR UPDATE lock on the Module row for the
        full duration, using the same two-phase dense-reindex path as the
        per-question reorder action.
        """
        raw_ids = request.data.get("ordered_ids")
        if not isinstance(raw_ids, list) or len(raw_ids) == 0:
            return Response(
                {"error": "ordered_ids must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Coerce to ints and reject any non-integer values.
        try:
            ordered_ids = [int(x) for x in raw_ids]
        except (TypeError, ValueError):
            return Response(
                {"error": "All values in ordered_ids must be integers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reject duplicates.
        if len(ordered_ids) != len(set(ordered_ids)):
            return Response(
                {"error": "ordered_ids contains duplicate values."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            module = get_object_or_404(
                Module,
                pk=module_pk,
                practice_test_id=test_pk,
            )
            Module.objects.select_for_update().filter(pk=module.pk).get()

            # Fetch all questions that currently belong to this module.
            existing_qs = list(
                Question.objects.filter(module_id=module.pk).order_by("order", "id")
            )
            existing_ids = {q.pk for q in existing_qs}

            # Validate completeness: every existing ID must appear in the request.
            if existing_ids != set(ordered_ids):
                missing = existing_ids - set(ordered_ids)
                extra = set(ordered_ids) - existing_ids
                detail_parts = []
                if missing:
                    detail_parts.append(f"Missing from ordered_ids: {sorted(missing)}")
                if extra:
                    detail_parts.append(f"Not in module: {sorted(extra)}")
                return Response(
                    {"error": "ordered_ids must contain exactly the questions in this module. " + ". ".join(detail_parts)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Build the ordered list in the requested sequence.
            by_id = {q.pk: q for q in existing_qs}
            ordered = [by_id[qid] for qid in ordered_ids]

            reindex_module_questions_dense_locked(module.pk, ordered)

        return Response({"status": "reordered", "count": len(ordered_ids)})


def _as_int_ids_bulk(seq):
    out = []
    for x in seq or []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _can_rerun_dispatch(actor, dispatch: BulkAssignmentDispatch) -> bool:
    if not getattr(actor, "is_authenticated", False):
        return False
    perms = get_effective_permission_codenames(actor)
    if acc_const.WILDCARD in perms:
        return True
    if dispatch.assigned_by_id and dispatch.assigned_by_id == actor.pk:
        return True
    subj = actor_subject_probe_for_domain_perm(actor)
    if subj and authorize(actor, acc_const.PERM_MANAGE_USERS, subject=subj):
        return True
    return False


class BulkAssignmentHistoryListView(generics.ListAPIView):
    """GET /api/exams/assignments/history/ — persisted library bulk-assign runs."""

    permission_classes = [IsAuthenticated, BulkAssignmentHistoryAccess]
    serializer_class = BulkAssignmentDispatchSerializer

    def get_queryset(self):
        user = self.request.user
        perms = get_effective_permission_codenames(user)
        qs = BulkAssignmentDispatch.objects.select_related("assigned_by").order_by("-created_at")
        if acc_const.WILDCARD in perms:
            return qs
        return qs.filter(assigned_by=user)


class BulkAssignmentHistoryDetailView(generics.RetrieveAPIView):
    """
    GET /api/exams/assignments/history/<id>/ — single dispatch detail.
    """

    permission_classes = [IsAuthenticated, BulkAssignmentHistoryAccess]
    serializer_class = BulkAssignmentDispatchDetailSerializer

    def get_queryset(self):
        """
        Defense-in-depth: match list scoping.
        Non-wildcard actors may only view their own dispatches unless they have manage_users.
        """
        user = self.request.user
        qs = BulkAssignmentDispatch.objects.select_related("assigned_by").order_by("-created_at")
        perms = get_effective_permission_codenames(user)
        if acc_const.WILDCARD in perms:
            return qs
        subj = actor_subject_probe_for_domain_perm(user)
        if subj and authorize(user, acc_const.PERM_MANAGE_USERS, subject=subj):
            return qs
        return qs.filter(assigned_by=user)


class BulkAssignmentHistoryRerunView(APIView):
    """POST /api/exams/assignments/history/<id>/rerun/ — replay stored payload."""

    permission_classes = [IsAuthenticated, BulkAssignmentHistoryAccess]

    def post(self, request, pk):
        dispatch = get_object_or_404(
            BulkAssignmentDispatch.objects.select_related("assigned_by"),
            pk=pk,
        )
        if not _can_rerun_dispatch(request.user, dispatch):
            raise PermissionDenied("You may only re-run dispatches you created, unless you are a directory admin.")

        p = dispatch.payload or {}
        exam_ids = _as_int_ids_bulk(p.get("exam_ids"))
        practice_test_ids = _as_int_ids_bulk(p.get("practice_test_ids"))
        user_ids = _as_int_ids_bulk(p.get("user_ids"))
        assignment_type = p.get("assignment_type") or "FULL"
        form_type = p.get("form_type")
        form_type = str(form_type).strip() if form_type else None

        from django.contrib.auth import get_user_model

        User = get_user_model()
        users = list(User.objects.filter(id__in=user_ids))
        if not user_ids or not users:
            return Response({"detail": "Stored payload is missing valid user_ids."}, status=status.HTTP_400_BAD_REQUEST)
        if not exam_ids and not practice_test_ids:
            return Response({"detail": "Stored payload is missing content ids."}, status=status.HTTP_400_BAD_REQUEST)

        subjects = bulk_assign_request_platform_subjects(
            {
                "exam_ids": exam_ids,
                "practice_test_ids": practice_test_ids,
                "assignment_type": assignment_type,
                "form_type": form_type,
            }
        )
        if not subjects or not all(
            authorize(request.user, acc_const.PERM_ASSIGN_ACCESS, subject=s) for s in subjects
        ):
            raise PermissionDenied("You are not allowed to re-run this assignment for the current subjects.")

        # Validate that at least one student is still eligible for the current subjects.
        eligible_any = False
        for u in users:
            if normalized_role(u) != acc_const.ROLE_STUDENT:
                continue
            for subj in subjects:
                dom = platform_subject_to_domain(subj)
                if dom and student_has_any_subject_grant(u, dom):
                    eligible_any = True
                    break
            if eligible_any:
                break
        if not eligible_any:
            return Response(
                {
                    "detail": "Rerun would skip all target students for the current subjects; no eligible students remain.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        prev_cc = p.get("client_context")
        client_context = prev_cc if isinstance(prev_cc, dict) else {}
        payload = {
            "exam_ids": exam_ids,
            "practice_test_ids": practice_test_ids,
            "user_ids": user_ids,
            "assignment_type": str(assignment_type or "FULL"),
            "form_type": form_type or "",
            "client_context": client_context,
        }

        snapshot = _actor_snapshot(
            request.user,
            subject=(getattr(request.user, "subject", None) or ""),
        )

        new_dispatch = BulkAssignmentDispatch.objects.create(
            assigned_by=request.user,
            kind=infer_dispatch_kind(exam_ids, practice_test_ids),
            subject_summary="",
            students_requested_count=0,
            students_granted_count=0,
            status=BulkAssignmentDispatch.STATUS_PROCESSING,
            payload=payload,
            result={},
            rerun_of=dispatch,
            actor_snapshot=snapshot,
        )

        try:
            with transaction.atomic():
                result = execute_library_bulk_assign(
                    actor=request.user,
                    exam_ids=exam_ids,
                    practice_test_ids=practice_test_ids,
                    user_ids=user_ids,
                    assignment_type=str(assignment_type or "FULL"),
                    form_type=form_type,
                )
        except Exception as exc:  # defensive: persist failure outcome
            new_dispatch.status = BulkAssignmentDispatch.STATUS_FAILED
            new_dispatch.result = {
                "error": exc.__class__.__name__,
                "detail": str(exc),
            }
            new_dispatch.save(update_fields=["status", "result"])
            raise

        new_dispatch.subject_summary = subject_summary_from_subjects(result.get("subjects_touched") or [])
        new_dispatch.students_requested_count = int(result.get("students_requested_count") or 0)
        new_dispatch.students_granted_count = int(result.get("students_granted_count") or 0)
        new_dispatch.status = BulkAssignmentDispatch.STATUS_COMPLETED
        new_dispatch.result = result
        new_dispatch.save(
            update_fields=[
                "subject_summary",
                "students_requested_count",
                "students_granted_count",
                "status",
                "result",
            ]
        )

        return Response(
            {
                **result,
                "dispatch_id": new_dispatch.pk,
                "dispatch_status": new_dispatch.status,
                "rerun_of_id": dispatch.pk,
            }
        )
