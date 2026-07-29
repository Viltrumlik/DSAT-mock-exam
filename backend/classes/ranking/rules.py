"""The two leaderboard rules, as the school actually explains them to students.

    SAT      — your most recent pastpaper, out of the ones this class was given.
    Academic — the points you have banked on this class's assessments since it opened.

Both are deliberately plain arithmetic. They replaced a weighted model
(0.50·RecentForm + 0.30·PeakAbility + 0.20·Consistency, and a category-weighted academic
score × completion factor) that was accurate but that no teacher could explain at the board
and no student could predict. A leaderboard nobody can reason about is not a motivator.

Gathering only — no ranking, no persistence, no DB writes. ``service.py`` orders and stores.
"""

from __future__ import annotations

import datetime as dt
import logging

from django.utils import timezone

from exams.models import PracticeTest, TestAttempt

from ..models import Assignment, assignment_target_practice_test_ids

logger = logging.getLogger(__name__)

# Levels whose classes rank on SAT. Foundation and junior students sit pastpapers to build
# stamina, not to be ranked against each other on a college-entrance scale; showing them a
# SAT board measures them against a bar they are not being taught to yet.
SAT_LEVELS = ("middle", "senior")


def classroom_ranks_on_sat(classroom) -> bool:
    """True when this classroom's level should see a SAT leaderboard at all.

    An untagged classroom (``level == ""``) is excluded on purpose: the pastpaper assignment
    picker already filters by level, so an untagged class has nothing assigned and its board
    would be empty anyway. Hiding it is more honest than showing an empty table.
    """
    return str(getattr(classroom, "level", "") or "").strip().lower() in SAT_LEVELS


# ── SAT: each student's own last assigned pastpaper ───────────────────────────

def assigned_pastpaper_ids(classroom) -> list[int]:
    """The pastpapers this classroom was actually given, newest-agnostic.

    Resolution cannot be a single ORM filter: an Assignment can point at a pastpaper through
    a plain FK, a JSON id list, or a pack that has to be expanded, so the ids are
    materialised in Python via the shared helper.

    Two filters matter for correctness:
      * ``mock_exam__isnull=True`` — a PracticeTest belonging to a MockExam is a mock/midterm
        section, not a pastpaper.
      * subject — nothing validates that an assigned pastpaper's subject matches the class's,
        so a Math paper CAN be assigned to an English class. Without this filter that paper
        would become an English student's "latest pastpaper" and rank them on it.
    """
    ids: set[int] = set()
    for assignment in classroom.assignments.exclude(status=Assignment.STATUS_DRAFT):
        ids.update(assignment_target_practice_test_ids(assignment))
    if not ids:
        return []

    qs = PracticeTest.objects.filter(pk__in=ids, mock_exam__isnull=True)
    subject = classroom.platform_subject
    if subject:
        qs = qs.filter(subject=subject)
    return list(qs.values_list("id", flat=True))


def latest_pastpaper_per_student(student_ids: list[int], pastpaper_ids: list[int]) -> dict[int, dict]:
    """``{student_id: {score, practice_test_id, attempt_id, finished_at}}`` — each student's
    OWN most recent completed attempt.

    Not "the class's latest paper": if Ali sat paper 4 and Vali only ever sat paper 3, they
    are ranked on 4 and 3 respectively. That is what the teacher asked for — the board shows
    where each student currently stands, not who kept up with the schedule.

    Reduced in Python rather than with a window function: a classroom is ~20 students, and
    the alternative reads differently across database backends (the suite runs on SQLite,
    production on Postgres) for no measurable gain.

    ``is_completed`` AND ``current_state`` are both required. They are separate fields that
    have drifted apart before (see exams/engine_integrity.py), and a half-finished attempt
    carrying a partial score would otherwise become someone's rank.
    """
    if not student_ids or not pastpaper_ids:
        return {}

    rows = TestAttempt.objects.filter(
        student_id__in=student_ids,
        practice_test_id__in=pastpaper_ids,
        is_completed=True,
        current_state=TestAttempt.STATE_COMPLETED,
        score__isnull=False,
    ).values("id", "student_id", "practice_test_id", "score", "completed_at", "submitted_at")

    latest: dict[int, dict] = {}
    for row in rows:
        finished_at = row["completed_at"] or row["submitted_at"]
        if finished_at is None:
            # Completed but undated — cannot be ordered against anything, and guessing would
            # let it outrank a genuinely newer sitting.
            continue
        current = latest.get(row["student_id"])
        # Ties on the timestamp (seeded and backfilled rows share them) break on attempt id.
        if current is None or (finished_at, row["id"]) > (current["finished_at"], current["attempt_id"]):
            latest[row["student_id"]] = {
                "score": float(row["score"]),
                "practice_test_id": row["practice_test_id"],
                "attempt_id": row["id"],
                "finished_at": finished_at,
            }
    return latest


# ── Academic: assessment points banked since the class opened ─────────────────

def classroom_opened_at(classroom, *, now=None):
    """When this classroom's academic window starts.

    ``start_date`` is the teacher-entered opening day and is what they mean by "guruh
    ochilgan kun", but it is nullable and unset on most existing classrooms — fall back to
    ``created_at``, the same precedence the lesson scheduler uses.
    """
    start_date = getattr(classroom, "start_date", None)
    if start_date:
        naive = dt.datetime.combine(start_date, dt.time.min)
        return timezone.make_aware(naive, timezone.get_current_timezone())
    return classroom.created_at or (now or timezone.now())


def assessment_points_per_student(classroom, student_ids: list[int], *, since, until) -> dict[int, dict]:
    """``{student_id: {points, max_points, assessments_count}}`` — banked assessment points.

    Sum of the student's BEST attempt per assessment set, not of every attempt. Retakes are
    unlimited here (the uniqueness constraint only covers in-progress attempts, and "retry
    incorrect only" mints a fresh attempt over a subset), so summing every attempt would
    make re-sitting the same quiz the fastest way to the top of the board — which students
    work out immediately. Best-per-set keeps the "more work done, more points" meaning the
    teacher wants while removing that shortcut.

    Raw ``score_points``, not percent: a 50-point assessment is meant to count for more than
    a 5-point one. Hand-graded homework is added in the same currency (see
    ``_hand_graded_points``) — an ungraded submission contributes nothing rather than zero.
    """
    if not student_ids:
        return {}

    from assessments.models import AssessmentAttempt, AssessmentResult

    rows = AssessmentResult.objects.filter(
        attempt__homework__classroom=classroom,
        attempt__student_id__in=student_ids,
        attempt__status=AssessmentAttempt.STATUS_GRADED,
    ).exclude(
        # A draft has not been given to anyone yet, so its points are not banked. Students
        # cannot normally reach one, but the SAT side excludes drafts too and a leaderboard
        # that disagrees with itself about what "assigned" means is not defensible.
        attempt__homework__assignment__status=Assignment.STATUS_DRAFT,
    ).values(
        "score_points",
        "max_points",
        "attempt__student_id",
        "attempt__homework__assessment_set_id",
        "attempt__submitted_at",
        "attempt__started_at",
    )

    # (student, assessment_set) -> best (points, max_points)
    best: dict[tuple[int, int], tuple[float, float]] = {}
    for row in rows:
        # `submitted_at` is the real completion moment; `started_at` is defaulted and always
        # present, so it keeps a graded-but-undated attempt inside a window it belongs to
        # rather than silently dropping the student's points.
        when = row["attempt__submitted_at"] or row["attempt__started_at"]
        if when is None or when < since or when > until:
            continue
        key = (row["attempt__student_id"], row["attempt__homework__assessment_set_id"])
        points = float(row["score_points"] or 0)
        current = best.get(key)
        if current is None or points > current[0]:
            best[key] = (points, float(row["max_points"] or 0))

    totals: dict[int, dict] = {}
    for (student_id, _set_id), (points, max_points) in best.items():
        bucket = totals.setdefault(
            student_id, {"points": 0.0, "max_points": 0.0, "assessments_count": 0, "graded_count": 0}
        )
        bucket["points"] += points
        bucket["max_points"] += max_points
        bucket["assessments_count"] += 1

    for student_id, points, max_points in _hand_graded_points(
        classroom, student_ids, since=since, until=until
    ):
        bucket = totals.setdefault(
            student_id, {"points": 0.0, "max_points": 0.0, "assessments_count": 0, "graded_count": 0}
        )
        bucket["points"] += points
        bucket["max_points"] += max_points
        bucket["graded_count"] += 1

    for bucket in totals.values():
        bucket["points"] = round(bucket["points"], 2)
        bucket["max_points"] = round(bucket["max_points"], 2)
    return totals


def _hand_graded_points(classroom, student_ids: list[int], *, since, until):
    """Yield ``(student_id, points, max_points)`` for work the teacher graded by hand.

    Only a submission that actually carries a grade counts. **Work the teacher has not got to
    yet contributes nothing at all** — not a zero. That distinction is the whole point: a
    leaderboard that scored ungraded work as 0 would punish students for their teacher's
    backlog, and would move every rank the moment marking started.

    The grade is added as raw points, the same currency as an assessment's ``score_points``,
    so a 50-point essay counts for more than a 5-point quiz. ``Submission`` is unique per
    (assignment, student), so there is nothing to deduplicate.
    """
    from ..models import Submission, SubmissionReview

    rows = SubmissionReview.objects.filter(
        submission__assignment__classroom=classroom,
        submission__student_id__in=student_ids,
        submission__assignment__category__in=Assignment.ACADEMIC_CATEGORIES,
        submission__status=Submission.STATUS_REVIEWED,
        grade__isnull=False,
    ).exclude(
        submission__assignment__status=Assignment.STATUS_DRAFT,
    ).values(
        "grade",
        "max_score",
        "reviewed_at",
        "submission__student_id",
        "submission__submitted_at",
        "submission__assignment__max_score",
    )

    for row in rows:
        # The work belongs to the day it was HANDED IN, not the day it happened to be
        # marked — otherwise a teacher clearing a backlog would drag old work into the
        # current window. `reviewed_at` only stands in when nothing was ever submitted.
        when = row["submission__submitted_at"] or row["reviewed_at"]
        if when is None or when < since or when > until:
            continue
        ceiling = row["max_score"] or row["submission__assignment__max_score"] or 0
        yield (
            row["submission__student_id"],
            float(row["grade"] or 0),
            float(ceiling),
        )
