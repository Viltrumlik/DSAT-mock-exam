"""Assignment completion primitives, read by ``roadmap.py`` and ``progress.py``.

This module used to be the service behind the classroom analytics endpoints
(``class_analytics``, ``student_analytics``, ``sat_topic_accuracy``). Nothing called those
endpoints after the classroom Analytics tab was removed, so they were deleted. These helpers
stayed because the roadmap and the progress report take their notion of "done" from them.
"""

from __future__ import annotations

from collections import defaultdict

from .models import Assignment, Submission

_COMPLETED_SUB = (Submission.STATUS_SUBMITTED, Submission.STATUS_REVIEWED)


def _academic_assignments(classroom):
    """Non-DRAFT academic assignments (PUBLISHED + ARCHIVED) — grades/history source."""
    return list(
        classroom.assignments.filter(category__in=Assignment.ACADEMIC_CATEGORIES)
        .exclude(status=Assignment.STATUS_DRAFT)
    )


def _completion_map(classroom, student_ids, assignments):
    """Return {student_id: set(completed_assignment_ids)} from real submissions/results."""
    completed: dict[int, set[int]] = defaultdict(set)
    asg_ids = [a.id for a in assignments]
    for student_id, assignment_id, status in Submission.objects.filter(
        assignment_id__in=asg_ids, student_id__in=student_ids
    ).values_list("student_id", "assignment_id", "status"):
        if status in _COMPLETED_SUB:
            completed[student_id].add(assignment_id)
    try:
        from assessments.models import AssessmentResult

        for student_id, assignment_id in (
            AssessmentResult.objects.filter(
                attempt__homework__classroom=classroom, attempt__student_id__in=student_ids
            ).values_list("attempt__student_id", "attempt__homework__assignment_id")
        ):
            if assignment_id in set(asg_ids):
                completed[student_id].add(assignment_id)
    except Exception:
        pass
    return completed
