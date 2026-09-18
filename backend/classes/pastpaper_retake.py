"""A pastpaper set again as homework is a new sitting; the one before it becomes history.

The owner, 2026-09-18: *"keyingi safar yana homework assign qilinganda yangi urunish ochib
beriladi pastpaperni ishlash uchun eskisi historyga qo'yiladi. assign qilinganda automatic
ochilishi kerak."* A student who had already sat a paper could not sit it again when a teacher
set it as homework. The library card and the homework launcher both turned any finished attempt
into "Review", and the homework was handed in with the old attempt the moment it went live.

**One floor decides which sitting belongs to which homework**: an attempt counts for a homework
only if it was finished at or after the homework was set. ``rewards.homework._assigned_at`` has
paid homework by that floor since the reward overhaul, for this exact reason, so the grade, the
launcher, the library card and the reward now agree on it.

**The floor is ``Assignment.created_at``**, the one rewards uses, not ``published_at``:

- ``published_at`` is NULL on almost every homework, because create never stamps it, and
  ``unarchive`` stamps it on homework that was live all along. That would move the floor past
  work the class had already done and reopen a paper everyone finished.
- Work finished while the homework was still a draft is still handed in at publish, as #198
  decided: it was finished after ``created_at``.
- A journal release creates its homework at release time, so ``created_at`` is when it reached
  the class there too.

**Nothing is written to "open" the new attempt.** The paper is open again because the old
sitting no longer counts for the new homework, and starting it creates an attempt the way any
start does. Pre-creating attempt rows would mean minting them on every path that puts homework
in front of a class (create, publish, unarchive, a journal release, a join, a reinstatement),
and one missed path is a student who cannot start.
"""

from __future__ import annotations

from django.db.models import Q
from django.db.models.functions import Coalesce


def homework_set_at(assignment):
    """The floor: an attempt finished at or after this moment counts for ``assignment``."""
    return assignment.created_at


def finished_at_expr():
    """When a finished attempt was finished, as a query expression.

    The runner always writes ``completed_at`` (prod, 2026-09-18: all 976 finished pastpapers
    have it). A row without it, from a repair or an admin edit, falls back to ``submitted_at``
    and then to when the attempt was started, so it is still placed in time instead of silently
    never counting for any homework.
    """
    return Coalesce("completed_at", "submitted_at", "created_at")


def finished_at(attempt):
    """``finished_at_expr`` for an attempt instance or a ``values()`` row."""
    if isinstance(attempt, dict):
        return attempt.get("completed_at") or attempt.get("submitted_at") or attempt.get("created_at")
    return attempt.completed_at or attempt.submitted_at or attempt.created_at


def reopened_papers(user) -> dict[int, dict]:
    """The pastpapers a live homework has set this student again since they last finished them.

    Keyed by practice test id, and only papers the student HAS finished: a paper they never sat
    is just new, and the library already offers it as Start. Each carries the most recently set
    homework asking for it. That one has the highest floor, so a sitting that satisfies it
    satisfies every older homework on the same paper too.

    ACTIVE members and PUBLISHED homework only, the library grant's rule (#198): a removed
    student and a draft have not been given anything.
    """
    from exams.models import PracticeTest, TestAttempt

    from .models import Assignment, ClassroomMembership, assignment_target_practice_test_ids

    if user is None or not getattr(user, "is_authenticated", False):
        return {}
    class_ids = list(
        ClassroomMembership.objects.filter(
            user=user,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        ).values_list("classroom_id", flat=True)
    )
    if not class_ids:
        return {}

    # Only rows that can carry a standalone section. A mock exam's sections are not pastpapers,
    # and its target list is exclusive, so a mock row has nothing here to reopen.
    homework = (
        Assignment.objects.filter(classroom_id__in=class_ids, status=Assignment.STATUS_PUBLISHED)
        .filter(
            Q(practice_test__isnull=False)
            | Q(practice_test_ids__isnull=False)
            | Q(practice_test_pack__isnull=False)
            | Q(practice_test_pack_ids__isnull=False)
        )
        .select_related("classroom")
    )
    latest: dict[int, Assignment] = {}
    for assignment in homework:
        for pt_id in assignment_target_practice_test_ids(assignment):
            held = latest.get(pt_id)
            if held is None or homework_set_at(assignment) > homework_set_at(held):
                latest[pt_id] = assignment
    if not latest:
        return {}

    standalone = PracticeTest.objects.filter(pk__in=list(latest), mock_exam__isnull=True)
    finished = TestAttempt.objects.filter(
        student=user,
        practice_test__in=standalone,
        is_completed=True,
        current_state=TestAttempt.STATE_COMPLETED,
    ).values("practice_test_id", "completed_at", "submitted_at", "created_at")

    sat_before: set[int] = set()
    sat_since: set[int] = set()
    for row in finished:
        pt_id = row["practice_test_id"]
        if finished_at(row) >= homework_set_at(latest[pt_id]):
            sat_since.add(pt_id)
        else:
            sat_before.add(pt_id)

    out: dict[int, dict] = {}
    for pt_id in sorted(sat_before - sat_since):
        assignment = latest[pt_id]
        out[pt_id] = {
            "practice_test_id": pt_id,
            "assignment_id": assignment.pk,
            "assignment_title": assignment.title,
            "classroom_id": assignment.classroom_id,
            "classroom_name": getattr(assignment.classroom, "name", "") or "",
            "set_at": homework_set_at(assignment),
            "due_at": assignment.due_at,
        }
    return out
