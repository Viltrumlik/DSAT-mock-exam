from __future__ import annotations

from django.db import transaction
from django.db.models import (
    Avg,
    Q as models_Q,
)
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes
from django.http import HttpResponse
from django.conf import settings as dj_settings
from access.permissions import (
    CanManageQuestions,
    CanViewTests,
)
from access.services import is_global_scope_staff
from users.permissions import IsAuthenticatedAndNotFrozen
from .models import (
    AssessmentAttempt,
    AssessmentResult,
    AssessmentAttemptAuditEvent,
)
from .async_tasks import grade_attempt_task
from .grading_service import grade_attempt
from .prometheus import render_assessments_prometheus_text
from .prometheus_homework import render_assessments_homework_prometheus_text
from .metrics import incr as assessments_metric_incr
from .worker_metrics import get_celery_worker_snapshot
from .redis_health import get_redis_health_snapshot
from .serializers import (
    AttemptSerializer,
    ResultSerializer,
)
from .helpers import (
    _audit_attempt,
    _summarise_governance_payload,
)


def _attempt_in_scope(request, att) -> bool:
    """Whether the requester may read/act on this attempt.

    Global-scope staff are unrestricted; otherwise the attempt's homework
    classroom must be one the requester owns (classroom.teacher) or teaches
    (ROLE_TEACHER membership). Mirrors TeacherSubmissionQueueView scoping so a
    teacher can't touch another class's attempts platform-wide.
    """
    if is_global_scope_staff(request.user):
        return True
    from classes.models import Classroom, ClassroomMembership

    classroom_id = getattr(getattr(att, "homework", None), "classroom_id", None)
    if not classroom_id:
        return False
    if Classroom.objects.filter(pk=classroom_id, teacher=request.user).exists():
        return True
    return ClassroomMembership.objects.filter(
        classroom_id=classroom_id,
        user=request.user,
        role=ClassroomMembership.ROLE_TEACHER,
    ).exists()


class AdminGradingMetricsView(APIView):
    """
    DB-derived grading metrics (broker-agnostic):
    - "queue size" approximated by pending submitted attempts
    - latency measured from submitted_at -> result.graded_at
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    def get(self, request):
        now = timezone.now()
        pending = AssessmentAttempt.objects.filter(
            status=AssessmentAttempt.STATUS_SUBMITTED,
            grading_status=AssessmentAttempt.GRADING_PENDING,
        ).count()
        processing = AssessmentAttempt.objects.filter(
            status=AssessmentAttempt.STATUS_SUBMITTED,
            grading_status=AssessmentAttempt.GRADING_PROCESSING,
        ).count()
        failed = AssessmentAttempt.objects.filter(grading_status=AssessmentAttempt.GRADING_FAILED).count()

        # Rolling 24h outcomes
        since = now - timezone.timedelta(hours=24)
        completed_24h = AssessmentAttempt.objects.filter(
            grading_status=AssessmentAttempt.GRADING_COMPLETED,
            grading_last_attempt_at__gte=since,
        ).count()
        failed_24h = AssessmentAttempt.objects.filter(
            grading_status=AssessmentAttempt.GRADING_FAILED,
            grading_last_attempt_at__gte=since,
        ).count()
        retries_24h = (
            AssessmentAttempt.objects.filter(grading_last_attempt_at__gte=since)
            .aggregate(avg_attempts=Avg("grading_attempts"))
            .get("avg_attempts")
        )

        # Latency samples (last 500 results)
        res_qs = (
            AssessmentResult.objects.select_related("attempt")
            .order_by("-graded_at")
            .only("graded_at", "attempt__submitted_at")[:500]
        )
        latencies = []
        for r in res_qs:
            sub = getattr(getattr(r, "attempt", None), "submitted_at", None)
            if sub and r.graded_at:
                latencies.append((r.graded_at - sub).total_seconds())
        latencies.sort()
        def pctl(p: float) -> float | None:
            if not latencies:
                return None
            i = int(round((len(latencies) - 1) * p))
            return float(latencies[max(0, min(len(latencies) - 1, i))])

        # Trend analysis windows
        w5 = now - timezone.timedelta(minutes=5)
        w60 = now - timezone.timedelta(minutes=60)
        submitted_5m = AssessmentAttempt.objects.filter(submitted_at__gte=w5).count()
        graded_5m = AssessmentResult.objects.filter(graded_at__gte=w5).count()
        failed_5m = AssessmentAttempt.objects.filter(grading_status=AssessmentAttempt.GRADING_FAILED, grading_last_attempt_at__gte=w5).count()

        submitted_60m = AssessmentAttempt.objects.filter(submitted_at__gte=w60).count()
        graded_60m = AssessmentResult.objects.filter(graded_at__gte=w60).count()
        failed_60m = AssessmentAttempt.objects.filter(grading_status=AssessmentAttempt.GRADING_FAILED, grading_last_attempt_at__gte=w60).count()

        # Pending age distribution (proxy for queue growth/health).
        pending_rows = list(
            AssessmentAttempt.objects.filter(
                status=AssessmentAttempt.STATUS_SUBMITTED,
                grading_status=AssessmentAttempt.GRADING_PENDING,
            )
            .exclude(submitted_at__isnull=True)
            .values_list("submitted_at", flat=True)[:2000]
        )
        pending_ages = [float((now - t).total_seconds()) for t in pending_rows if t]
        pending_ages.sort()
        def pctl_age(p: float) -> float | None:
            if not pending_ages:
                return None
            i = int(round((len(pending_ages) - 1) * p))
            return float(pending_ages[max(0, min(len(pending_ages) - 1, i))])

        # Broker-aware queue size (optional, Redis only; best-effort).
        broker_url = str(getattr(dj_settings, "CELERY_BROKER_URL", "") or "").strip()
        broker_metrics = {"enabled": False, "transport": None, "queue_len": None, "detail": None}
        if broker_url.lower().startswith("redis"):
            try:
                import redis  # type: ignore

                r = redis.Redis.from_url(broker_url, socket_connect_timeout=0.5, socket_timeout=0.5)
                qname = "celery"
                qlen = int(r.llen(qname))
                broker_metrics = {"enabled": True, "transport": "redis", "queue_len": qlen, "detail": {"queue": qname}}
            except Exception as exc:
                broker_metrics = {"enabled": True, "transport": "redis", "queue_len": None, "detail": str(exc)}

        return Response(
            {
                "queue": {
                    "pending": pending,
                    "processing": processing,
                    "failed_total": failed,
                },
                "rates_24h": {
                    "completed": completed_24h,
                    "failed": failed_24h,
                    "failure_rate": round((failed_24h / (failed_24h + completed_24h)) * 100, 2)
                    if (failed_24h + completed_24h) > 0
                    else 0.0,
                    "avg_grading_attempts": float(retries_24h) if retries_24h is not None else None,
                },
                "latency_seconds": {
                    "p50": pctl(0.50),
                    "p90": pctl(0.90),
                    "p99": pctl(0.99),
                    "sample_n": len(latencies),
                },
                "trend": {
                    "submitted_per_min_5m": round(submitted_5m / 5.0, 2),
                    "graded_per_min_5m": round(graded_5m / 5.0, 2),
                    "failed_per_min_5m": round(failed_5m / 5.0, 2),
                    "submitted_per_min_60m": round(submitted_60m / 60.0, 2),
                    "graded_per_min_60m": round(graded_60m / 60.0, 2),
                    "failed_per_min_60m": round(failed_60m / 60.0, 2),
                    "pending_age_seconds": {
                        "p50": pctl_age(0.50),
                        "p90": pctl_age(0.90),
                        "p99": pctl_age(0.99),
                        "sample_n": len(pending_ages),
                    },
                },
                "broker": broker_metrics,
                "redis": get_redis_health_snapshot(),
                "workers": get_celery_worker_snapshot(),
                "backpressure": {
                    "max_inflight": int(getattr(dj_settings, "ASSESSMENT_GRADING_MAX_INFLIGHT", 500) or 500),
                    "dispatch_batch": int(getattr(dj_settings, "ASSESSMENT_GRADING_DISPATCH_BATCH", 50) or 50),
                },
                "server_time": now.isoformat(),
            }
        )


class AdminAttemptStatusView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    def get(self, request, attempt_id: int):
        att = (
            AssessmentAttempt.objects.select_related("homework", "homework__assessment_set")
            .prefetch_related("answers", "audit_events")
            .filter(pk=attempt_id)
            .first()
        )
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _attempt_in_scope(request, att):
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        res = AssessmentResult.objects.filter(attempt=att).first()
        return Response({"attempt": AttemptSerializer(att).data, "result": ResultSerializer(res).data if res else None})


class AdminRequeueAttemptView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    @transaction.atomic
    def post(self, request, attempt_id: int):
        att = AssessmentAttempt.objects.select_for_update().filter(pk=attempt_id).first()
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _attempt_in_scope(request, att):
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if att.status != AssessmentAttempt.STATUS_SUBMITTED:
            return Response({"detail": "Only submitted attempts can be requeued."}, status=status.HTTP_400_BAD_REQUEST)
        if att.grading_status != AssessmentAttempt.GRADING_FAILED:
            return Response({"detail": "Only failed attempts can be requeued."}, status=status.HTTP_400_BAD_REQUEST)
        cooldown = int(getattr(dj_settings, "ASSESSMENT_ADMIN_REQUEUE_COOLDOWN_SECONDS", 60) or 60)
        max_requeues = int(getattr(dj_settings, "ASSESSMENT_ADMIN_REQUEUE_MAX_PER_ATTEMPT", 6) or 6)
        cooldown = max(5, min(3600, cooldown))
        max_requeues = max(1, min(50, max_requeues))
        if att.grading_attempts >= max_requeues:
            return Response({"detail": "Requeue limit reached for this attempt."}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        if att.grading_last_attempt_at and (timezone.now() - att.grading_last_attempt_at).total_seconds() < cooldown:
            return Response({"detail": "Requeue cooldown active."}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        att.grading_status = AssessmentAttempt.GRADING_PENDING
        att.grading_error = ""
        att.save(update_fields=["grading_status", "grading_error"])
        grade_attempt_task.delay(att.pk)
        _audit_attempt(att, actor=request.user, event_type=AssessmentAttemptAuditEvent.EVENT_SUBMITTED, payload={"admin_requeue": True})
        return Response({"detail": "Requeued.", "attempt": AttemptSerializer(att).data}, status=status.HTTP_200_OK)


class AdminForceGradeAttemptView(APIView):
    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    def post(self, request, attempt_id: int):
        confirm = str((request.data or {}).get("confirm") or "").strip().upper()
        if confirm not in ("FORCE", "YES"):
            return Response(
                {"detail": "Confirmation required. Send { confirm: 'FORCE' } to force grading."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Resolve + scope-check BEFORE grading so an out-of-scope teacher can't
        # force-grade another class's attempt as a side effect.
        att = AssessmentAttempt.objects.select_related("homework").filter(pk=attempt_id).first()
        if not att:
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        if not _attempt_in_scope(request, att):
            return Response({"detail": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)
        res = grade_attempt(attempt_id=int(attempt_id))
        att.refresh_from_db()
        _audit_attempt(att, actor=request.user, event_type=AssessmentAttemptAuditEvent.EVENT_GRADED, payload={"admin_force": True})
        return Response({"attempt": AttemptSerializer(att).data, "result": ResultSerializer(res).data if res else None}, status=status.HTTP_200_OK)


class AdminGradingPrometheusMetricsView(APIView):
    """
    Prometheus scrape endpoint for grading/worker gauges.
    Keep it dependency-free (mirrors realtime.prometheus pattern).
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    def get(self, request):
        txt = render_assessments_prometheus_text()
        return HttpResponse(txt, content_type="text/plain; version=0.0.4")


class AdminHomeworkPrometheusMetricsView(APIView):
    """
    Prometheus scrape endpoint for homework integrity counters.
    Keep it dependency-free (mirrors other prometheus endpoints).
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    def get(self, request):
        txt = render_assessments_homework_prometheus_text()
        return HttpResponse(txt, content_type="text/plain; version=0.0.4")


class AdminBuilderTelemetryView(APIView):
    """
    Minimal telemetry ingestion endpoint for questions-console builder recovery events.
    Best-effort counters only (Prometheus-exposed via assessments homework metrics endpoint).
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanManageQuestions]

    def post(self, request):
        key = str((request.data or {}).get("key") or "").strip()
        allowed = {
            "invalid_selection_recovered_total",
            "stale_id_blocked_total",
            "builder_refetch_recovery_total",
        }
        if key not in allowed:
            return Response({"detail": "Invalid telemetry key."}, status=status.HTTP_400_BAD_REQUEST)
        assessments_metric_incr(key)
        return Response({"ok": True}, status=status.HTTP_200_OK)


class AdminGovernanceEventListView(APIView):
    """
    GET /assessments/admin/governance-events/

    Queryable audit log for operators. Supports filtering by entity_type,
    event_type, actor_email, set_id (payload filter), and date range.
    Returns newest-first with cursor-style limit/offset pagination.

    Operators use this instead of Django admin for routine audit review.
    Never exposes payload fields that contain correct_answer data.

    Query params:
        event_type     — filter by event type (e.g. "publish", "fallback_path_used")
        entity_type    — filter by entity type (e.g. "AssessmentSetVersion")
        actor_email    — filter by actor
        since          — ISO datetime, show events after this timestamp
        until          — ISO datetime, show events before this timestamp
        limit          — default 50, max 200
        offset         — default 0
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanViewTests]

    @extend_schema(
        tags=["assessments"],
        summary="Query governance audit log",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        from assessments.models import GovernanceEvent

        qs = GovernanceEvent.objects.select_related("actor").order_by("-occurred_at")

        event_type = request.query_params.get("event_type", "").strip()
        entity_type = request.query_params.get("entity_type", "").strip()
        actor_email = request.query_params.get("actor_email", "").strip()
        since = request.query_params.get("since", "").strip()
        until = request.query_params.get("until", "").strip()

        if event_type:
            qs = qs.filter(event_type=event_type)
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if actor_email:
            qs = qs.filter(actor_email__icontains=actor_email)
        if since:
            from django.utils.dateparse import parse_datetime
            dt = parse_datetime(since)
            if dt:
                qs = qs.filter(occurred_at__gte=dt)
        if until:
            from django.utils.dateparse import parse_datetime
            dt = parse_datetime(until)
            if dt:
                qs = qs.filter(occurred_at__lte=dt)

        try:
            limit = min(int(request.query_params.get("limit", 50)), 200)
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except (ValueError, TypeError):
            limit, offset = 50, 0

        total = qs.count()
        page = qs[offset : offset + limit]

        results = [
            {
                "id": ev.pk,
                "event_type": ev.event_type,
                "entity_type": ev.entity_type,
                "entity_id": ev.entity_id,
                "actor_email": ev.actor_email or None,
                "occurred_at": ev.occurred_at.isoformat(),
                "correlation_id": ev.correlation_id or None,
                # Summarise payload without exposing correct_answer
                "payload_summary": _summarise_governance_payload(ev.payload),
            }
            for ev in page
        ]

        return Response({
            "count": total,
            "limit": limit,
            "offset": offset,
            "results": results,
        })


class AdminFailedAttemptsListView(APIView):
    """
    GET /assessments/admin/attempts/failed/

    List AssessmentAttempt rows that are in a failed/stuck state, newest first.

    An attempt is considered "stuck" if:
      - grading_status is "failed" (all automatic retries exhausted), OR
      - status is "submitted" AND submitted_at is more than 30 minutes ago
        (grading job appears to have been lost)

    Returns enough context for the operator to triage and retry without
    needing to open Django admin.

    Query params:
        limit  — default 50, max 200
        offset — default 0
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, CanViewTests]

    @extend_schema(
        tags=["assessments"],
        summary="List failed/stuck scoring attempts",
        responses={200: OpenApiTypes.OBJECT},
    )
    def get(self, request):
        from django.utils import timezone
        from datetime import timedelta
        from assessments.models import AssessmentAttempt

        stuck_threshold = timezone.now() - timedelta(minutes=30)

        qs = (
            AssessmentAttempt.objects.filter(
                models_Q(grading_status="failed")
                | models_Q(status="submitted", submitted_at__lt=stuck_threshold)
            )
            .select_related("student", "homework__assessment_set", "homework__assignment")
            .order_by("-submitted_at", "-id")
        )

        try:
            limit = min(int(request.query_params.get("limit", 50)), 200)
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except (ValueError, TypeError):
            limit, offset = 50, 0

        total = qs.count()
        page = qs[offset : offset + limit]

        results = [
            {
                "id": att.pk,
                "student_email": att.student.email if att.student else None,
                "student_name": (
                    f"{att.student.first_name} {att.student.last_name}".strip()
                    if att.student else None
                ),
                "status": att.status,
                "grading_status": att.grading_status,
                "grading_attempts": att.grading_attempts,
                "submitted_at": att.submitted_at.isoformat() if att.submitted_at else None,
                "set_title": (
                    att.homework.assessment_set.title
                    if att.homework and att.homework.assessment_set else None
                ),
                "assignment_title": (
                    att.homework.assignment.title
                    if att.homework and att.homework.assignment else None
                ),
                "stuck_reason": (
                    "grading_failed"
                    if att.grading_status == "failed"
                    else "submitted_not_graded"
                ),
            }
            for att in page
        ]

        return Response({
            "count": total,
            "limit": limit,
            "offset": offset,
            "results": results,
        })
