from __future__ import annotations

from django.db import (
    IntegrityError,
    transaction,
)
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from time import monotonic
from access.permissions import CanAssignTests
from access.services import (
    is_global_scope_staff,
    user_domain_subject,
    normalized_role,
)
from access import constants as acc_const
from users.permissions import IsAuthenticatedAndNotFrozen
from classes.models import (
    Assignment,
    Classroom,
)
from classes.security import classroom_authz_for_user
from .models import (
    AssessmentSet,
    AssessmentSetVersion,
    HomeworkAssignment,
)
from .throttles import (
    AssessmentAssignHomeworkGlobalThrottle,
    AssessmentAssignHomeworkPerClassroomThrottle,
    AssessmentAssignHomeworkThrottle,
)
from .metrics import incr as assessments_metric_incr
from core.metrics import (
    incr as metric_incr,
    incr_role as metric_incr_role,
)
from config.error_reporting import report_error
from .serializers import (
    AssignHomeworkSerializer,
    HomeworkAssignmentSerializer,
)


class AssignAssessmentHomeworkView(APIView):
    """
    Teacher assigns an AssessmentSet into a classroom.
    Creates a linked `classes.Assignment` so it appears in the normal homework feed.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]
    throttle_classes = [
        AssessmentAssignHomeworkThrottle,
        AssessmentAssignHomeworkPerClassroomThrottle,
        AssessmentAssignHomeworkGlobalThrottle,
    ]

    def post(self, request):
        t0 = monotonic()
        ser = AssignHomeworkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        from .mitigation import is_global_assignment_blocked, is_user_assignment_blocked

        if is_global_assignment_blocked():
            metric_incr("slo_homework_assign_fail_total")
            metric_incr_role("slo_homework_assign_fail_total", actor=getattr(request, "user", None))
            return Response(
                {"detail": "Assignment temporarily rate-limited system-wide. Retry shortly."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        if is_user_assignment_blocked(request.user.pk):
            metric_incr("slo_homework_assign_fail_total")
            metric_incr_role("slo_homework_assign_fail_total", actor=getattr(request, "user", None))
            return Response(
                {"detail": "Your account is temporarily blocked from assigning tests due to abuse controls."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        classroom = get_object_or_404(Classroom, pk=data["classroom_id"])
        c_authz = classroom_authz_for_user(classroom=classroom, user=request.user)
        if not c_authz.is_class_admin:
            metric_incr("slo_homework_assign_fail_total")
            metric_incr_role("slo_homework_assign_fail_total", actor=getattr(request, "user", None))
            return Response({"detail": "Only class admins can assign homework."}, status=status.HTTP_403_FORBIDDEN)

        aset = get_object_or_404(AssessmentSet.objects.prefetch_related("questions"), pk=data["set_id"])

        # Assignment permission gate (backend-enforced; never rely on frontend filtering):
        # - must have can_assign_tests in the actor context
        # - teachers must "own" the classroom (classroom.teacher == actor)
        actor = request.user
        if not CanAssignTests().has_permission(request, self):
            metric_incr("slo_homework_assign_fail_total")
            metric_incr_role("slo_homework_assign_fail_total", actor=getattr(request, "user", None))
            return Response({"detail": "You do not have permission to assign tests."}, status=status.HTTP_403_FORBIDDEN)

        role = normalized_role(actor)
        if role == acc_const.ROLE_TEACHER:
            # Classroom ownership: teacher can only assign within classes they teach.
            if not c_authz.is_teacher_owner:
                metric_incr("slo_homework_assign_fail_total")
                metric_incr_role("slo_homework_assign_fail_total", actor=getattr(request, "user", None))
                return Response({"detail": "Only the classroom teacher can assign tests in this class."}, status=status.HTTP_403_FORBIDDEN)
            # Subject scope: teachers can only assign their own subject.
            ds = user_domain_subject(actor)
            if ds and aset.subject != ds:
                metric_incr("slo_homework_assign_fail_total")
                metric_incr_role("slo_homework_assign_fail_total", actor=getattr(request, "user", None))
                return Response({"detail": "You cannot assign tests outside your subject."}, status=status.HTTP_403_FORBIDDEN)

        title = (data.get("title") or "").strip() or aset.title
        instructions = (data.get("instructions") or "").strip()
        due_at = data.get("due_at")

        # Create core homework row in existing system — UNIQUE(classroom, assessment_set) + locks.
        # Nested ``atomic()`` establishes a SAVEPOINT so an IntegrityError on duplicate insert
        # does not invalidate the outer transaction under PostgreSQL.
        with transaction.atomic():
            hw = (
                HomeworkAssignment.objects.select_for_update(of=("self",))
                .select_related("assignment")
                .filter(classroom=classroom, assessment_set=aset)
                .order_by("id")
                .first()
            )
            if hw:
                assessments_metric_incr("homework_duplicate_prevented")
            else:
                assignment = Assignment.objects.create(
                    classroom=classroom,
                    created_by=request.user,
                    title=title[:200],
                    instructions=instructions,
                    due_at=due_at,
                )
                # Resolve the latest published version to pin on this assignment.
                # NULL = set has never been published (legacy / pre-snapshot path).
                pinned_version = (
                    AssessmentSetVersion.objects.filter(assessment_set=aset)
                    .order_by("-version_number")
                    .first()
                )

                try:
                    with transaction.atomic():
                        hw = HomeworkAssignment.objects.create(
                            classroom=classroom,
                            assessment_set=aset,
                            assignment=assignment,
                            assigned_by=request.user,
                            set_version=pinned_version,
                        )
                except IntegrityError:
                    assessments_metric_incr("homework_duplicate_prevented")
                    Assignment.objects.filter(pk=assignment.pk).delete()
                    hw = (
                        HomeworkAssignment.objects.select_for_update(of=("self",))
                        .select_related("assignment")
                        .filter(classroom=classroom, assessment_set=aset)
                        .order_by("id")
                        .first()
                    )
                    if not hw:
                        report_error(
                            "assessments.homework_assign_integrity_error_no_canonical",
                            context={"actor_id": request.user.pk, "classroom_id": classroom.pk, "set_id": aset.pk},
                        )
                        raise
        from .models import AssessmentHomeworkAuditEvent, GovernanceEvent

        AssessmentHomeworkAuditEvent.objects.create(
            classroom=classroom,
            assessment_set=aset,
            homework=hw,
            actor=request.user,
            event_type=AssessmentHomeworkAuditEvent.EVENT_ASSIGNED,
            payload={"host": request.get_host(), "title": title},
        )

        # Governance event: track which version (if any) was pinned to this assignment.
        from .domain.governance_events import emit_governance_event
        emit_governance_event(
            event_type=GovernanceEvent.EVENT_ASSIGNMENT_PIN,
            actor=request.user,
            entity_type="HomeworkAssignment",
            entity_id=hw.pk,
            payload={
                "set_id": aset.pk,
                "classroom_id": classroom.pk,
                "pinned_version_id": hw.set_version_id,
                "pinned_version_number": (
                    hw.set_version.version_number if hw.set_version_id else None
                ),
                "snapshot_pinned": hw.set_version_id is not None,
            },
            correlation_id=request.META.get("HTTP_X_REQUEST_ID", ""),
        )

        from .homework_abuse import evaluate_abuse_after_assignment

        evaluate_abuse_after_assignment(
            actor_id=request.user.pk,
            classroom_id=classroom.pk,
            actor_role=normalized_role(request.user),
            actor_is_global_staff=is_global_scope_staff(request.user) or bool(getattr(request.user, "is_superuser", False)),
        )

        metric_incr("slo_homework_assign_ok_total")
        metric_incr_role("slo_homework_assign_ok_total", actor=getattr(request, "user", None))
        metric_incr("slo_homework_assign_latency_ms_sum", int((monotonic() - t0) * 1000))
        metric_incr("slo_homework_assign_latency_ms_count")
        return Response(HomeworkAssignmentSerializer(hw, context={"request": request}).data, status=status.HTTP_201_CREATED)
