"""The SAT leaderboard rule, as the school actually explains it to students.

    SAT — your most recent pastpaper, out of the ones this class was given.

Deliberately plain arithmetic. It replaced a weighted model (0.50·RecentForm +
0.30·PeakAbility + 0.20·Consistency) that was accurate but that no teacher could explain at
the board and no student could predict. A leaderboard nobody can reason about is not a
motivator.

**Academic no longer lives here.** It used to be a third helper in this module summing raw
``AssessmentResult.score_points`` and hand-graded ``SubmissionReview.grade`` over a window
opening at ``classroom.start_date``. The rewards cutover retired all three: the academic board
is now a projection of ``rewards.PointAward``, read directly by ``service._recompute_academic``.
Do not reintroduce a points calculation here — a number derived inside a pipeline that
re-derives and deletes its own rows every 20 minutes cannot be explained to the student whose
total moved. See §0 of docs/rewards/PLAN.md.

Gathering only — no ranking, no persistence, no DB writes. ``service.py`` orders and stores.
"""

from __future__ import annotations

import logging

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
