"""Teacher-facing HTTP for the past-paper item analysis.

    GET /api/exams/teacher/pastpaper-item-analysis/?classroom=<id>&practice_test=<id>[&threshold=25]
    GET /api/exams/teacher/pastpaper-item-analysis/?assignment=<id>[&threshold=25]

Everything about *what the numbers mean* lives in ``exams.pastpaper_item_analysis``; this
module only answers two questions — may this user see this classroom, and which students are
on its roster — and hands the rest over.

The two forms are alternatives and never combine. The first is the standalone question
analysis page: one named paper, across a class. The second is the same report *inside one
homework* — it resolves the classroom from the assignment (a teacher who opened a homework has
its id, not the classroom's), analyses every past paper that homework attaches, and returns
nothing but the ``homework`` block until the homework's deadline has passed.

**The classroom scope is deliberately not the one in** ``assessments/views_review.py``. That
one matches ``role=ROLE_TEACHER`` and ignores ``status``, so a class owner or TA sees nothing
of their own classroom while a teacher who was removed from it still does. The scope here is
the class owner FK plus any non-removed staff membership (``STAFF_ROLES`` covers
ADMIN/OWNER/TEACHER/TA), which is the rule the rest of the classroom surface enforces.

The roster is the student memberships that are not removed — ``NON_REMOVED_STATUSES``, not a
bare ACTIVE compare, because removal is a soft delete and an INVITED student who sat the paper
is a real data point.
"""

from __future__ import annotations

from rest_framework import status as http
from rest_framework.response import Response
from rest_framework.views import APIView

from access.services import is_global_scope_staff
from classes.models import Assignment, Classroom, ClassroomMembership
from users.permissions import IsAuthenticatedAndNotFrozen

from .models import PracticeTest
from .pastpaper_item_analysis import (
    DEFAULT_THRESHOLD,
    build_homework_pastpaper_item_analysis,
    build_pastpaper_item_analysis,
)


def _int_param(request, name: str) -> int | None:
    raw = request.query_params.get(name)
    if raw is None:
        return None
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def teacher_classroom_scope_ids(user) -> set[int]:
    """Classrooms this user may read staff-level data for. ``None`` means unrestricted."""
    return set(
        Classroom.objects.filter(teacher=user).values_list("id", flat=True)
    ) | set(
        ClassroomMembership.objects.filter(
            user=user,
            role__in=ClassroomMembership.STAFF_ROLES,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ).values_list("classroom_id", flat=True)
    )


def _classroom_block(classroom: Classroom) -> dict:
    """The classroom header both forms carry, spelled once."""
    return {
        "id": classroom.pk,
        "name": classroom.name,
        "subject": classroom.subject,
        "subject_label": classroom.get_subject_display(),
    }


def classroom_student_ids(classroom_id: int) -> list[int]:
    """The roster: student memberships that have not been removed."""
    return list(
        ClassroomMembership.objects.filter(
            classroom_id=classroom_id,
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ).values_list("user_id", flat=True)
    )


class PastpaperItemAnalysisView(APIView):
    """Per-question item analysis of one past paper for one classroom."""

    permission_classes = [IsAuthenticatedAndNotFrozen]

    def get(self, request):
        raw_assignment = request.query_params.get("assignment")
        if raw_assignment is not None and str(raw_assignment).strip():
            return self._homework(request, raw_assignment)

        classroom_id = _int_param(request, "classroom")
        if classroom_id is None:
            return Response(
                {"detail": "A numeric `classroom` query parameter is required."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        practice_test_id = _int_param(request, "practice_test")
        if practice_test_id is None:
            return Response(
                {"detail": "A numeric `practice_test` query parameter is required."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        if not is_global_scope_staff(request.user):
            if classroom_id not in teacher_classroom_scope_ids(request.user):
                # 404 rather than 403: whether a classroom exists is not this user's business.
                return Response({"detail": "Not found."}, status=http.HTTP_404_NOT_FOUND)

        classroom = Classroom.objects.filter(pk=classroom_id).first()
        if classroom is None:
            return Response({"detail": "Not found."}, status=http.HTTP_404_NOT_FOUND)

        # Past papers only. A mock or midterm section carries a ``mock_exam`` and is scored,
        # sat and repaired under different rules — it is not "not allowed here", it is a
        # different kind of thing, and the queryset says so rather than a branch below.
        practice_test = PracticeTest.objects.filter(
            pk=practice_test_id, mock_exam__isnull=True
        ).first()
        if practice_test is None:
            return Response({"detail": "Past paper not found."}, status=http.HTTP_404_NOT_FOUND)

        payload = build_pastpaper_item_analysis(
            practice_test,
            classroom_student_ids(classroom.pk),
            threshold=request.query_params.get("threshold", DEFAULT_THRESHOLD),
        )
        payload["classroom"] = _classroom_block(classroom)
        return Response(payload)

    # ── the in-homework form ─────────────────────────────────────────────────
    def _homework(self, request, raw_assignment):
        """``?assignment=<id>`` — every past paper this homework attaches, after its deadline.

        Same 404-not-403 rule as the classroom form above and for the same reason, one step
        further in: a homework id is a bare integer, and answering 403 for the ones that exist
        and 404 for the ones that do not would let anyone enumerate the school's homework.
        """
        try:
            assignment_id = int(str(raw_assignment).strip())
        except (TypeError, ValueError):
            return Response(
                {"detail": "'assignment' must be a numeric id."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        if request.query_params.get("practice_test"):
            return Response(
                {
                    "detail": (
                        "Pass either 'assignment' or 'practice_test', not both — a homework "
                        "already says which past papers it carries."
                    )
                },
                status=http.HTTP_400_BAD_REQUEST,
            )

        assignment = (
            Assignment.objects.select_related("classroom").filter(pk=assignment_id).first()
        )
        if assignment is None:
            return Response({"detail": "Not found."}, status=http.HTTP_404_NOT_FOUND)

        classroom = assignment.classroom
        if not is_global_scope_staff(request.user):
            if classroom.pk not in teacher_classroom_scope_ids(request.user):
                return Response({"detail": "Not found."}, status=http.HTTP_404_NOT_FOUND)

        stated_classroom = _int_param(request, "classroom")
        if stated_classroom is not None and stated_classroom != classroom.pk:
            # A caller that sent both and disagrees with us is confused about which class it
            # is looking at; answering about ours anyway is how a teacher reads another
            # class's numbers without noticing.
            return Response(
                {"detail": "'classroom' does not match the homework's classroom."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        payload = build_homework_pastpaper_item_analysis(
            assignment,
            classroom_student_ids(classroom.pk),
            threshold=request.query_params.get("threshold", DEFAULT_THRESHOLD),
        )
        payload["classroom"] = _classroom_block(classroom)
        return Response(payload)
