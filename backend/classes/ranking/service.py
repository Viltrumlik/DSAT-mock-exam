"""Ranking orchestration — gather inputs, rank, persist snapshots.

The two rules live in ranking/rules.py and are deliberately plain: SAT is a student's own
latest assigned pastpaper, Academic is the assessment points they have banked since the
class opened. This module only orders them and writes the snapshots.

Snapshots are the history ledger: each recompute upserts a row per (classroom, kind,
period_key, student). `previous_rank` comes from the latest snapshot of a *different*
period, so rank_change/trend are well-defined. Current rankings are computed live here;
no read-cache is persisted (no proven perf need — see §5).
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from ..models import ClassroomMembership
from ..models_ranking import RankingSnapshot
from . import rules

ACADEMIC_TREND_EPS = 1.0  # academic points between snapshots for IMPROVING/DECLINING


# ── ranking + persistence ─────────────────────────────────────────────────────

def _student_ids(classroom) -> list[int]:
    return list(
        classroom.memberships.filter(
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE
        ).values_list("user_id", flat=True)
    )


def _previous_ranks(classroom, kind: str, current_period: str) -> dict[int, int]:
    """Latest rank per student from a snapshot of a *different* period (for rank_change)."""
    rows = (
        RankingSnapshot.objects.filter(classroom=classroom, kind=kind)
        .exclude(period_key=current_period)
        .order_by("student_id", "-computed_at")
        .values("student_id", "rank", "computed_at")
    )
    out: dict[int, int] = {}
    for r in rows:  # first per student wins (ordered by -computed_at)
        out.setdefault(r["student_id"], r["rank"])
    return out


def _percentile(score: float, all_scores: list[float]) -> float:
    n = len(all_scores)
    if n <= 1:
        return 100.0
    below = sum(1 for s in all_scores if s < score)
    equal = sum(1 for s in all_scores if s == score) - 1
    return round(100.0 * (below + 0.5 * equal) / (n - 1), 1)


@transaction.atomic
def recompute_classroom(classroom, *, kinds=("SAT", "ACADEMIC"), period_key=None, now=None) -> dict:
    now = now or timezone.now()
    period_key = period_key or now.date().isoformat()
    student_ids = _student_ids(classroom)
    summary = {}

    if "SAT" in kinds:
        summary["SAT"] = _recompute_sat(classroom, student_ids, period_key, now)
    if "ACADEMIC" in kinds:
        summary["ACADEMIC"] = _recompute_academic(classroom, student_ids, period_key, now)
    return summary


def _recompute_sat(classroom, student_ids, period_key, now) -> int:
    """Rank on each student's own latest assigned pastpaper (see ranking/rules.py).

    Students with no pastpaper yet are still written, ranked last with ``score=None``, so the
    teacher can see who has not sat one — an absent row looks identical to a missing student.
    """
    if not rules.classroom_ranks_on_sat(classroom):
        # Level does not rank on SAT. Clear any board left over from before the level
        # changed, so a hidden tab can never be un-hidden onto stale numbers.
        RankingSnapshot.objects.filter(classroom=classroom, kind=RankingSnapshot.KIND_SAT).delete()
        return 0

    pastpaper_ids = rules.assigned_pastpaper_ids(classroom)
    latest = rules.latest_pastpaper_per_student(student_ids, pastpaper_ids)

    scored = sorted(
        ((sid, latest[sid]) for sid in student_ids if sid in latest),
        key=lambda t: (-t[1]["score"], -t[1]["finished_at"].timestamp(), t[0]),
    )
    unscored = sorted(sid for sid in student_ids if sid not in latest)
    scores = [row["score"] for _sid, row in scored]
    prev = _previous_ranks(classroom, RankingSnapshot.KIND_SAT, period_key)

    for rank, (sid, row) in enumerate(scored, start=1):
        prev_rank = prev.get(sid)
        RankingSnapshot.objects.update_or_create(
            classroom=classroom, kind=RankingSnapshot.KIND_SAT, period_key=period_key, student_id=sid,
            defaults=dict(
                rank=rank,
                previous_rank=prev_rank,
                score=row["score"],
                percentile=_percentile(row["score"], scores),
                trend=None,
                confidence=None,
                components={
                    "practice_test_id": row["practice_test_id"],
                    "attempt_id": row["attempt_id"],
                    "finished_at": row["finished_at"].isoformat(),
                    "rank_change": (prev_rank - rank) if prev_rank else None,
                },
                computed_at=now,
            ),
        )

    # Everyone still waiting on their first pastpaper shares the rank after the last scored
    # student — they are tied at "no result", not ordered among themselves.
    unranked_rank = len(scored) + 1
    for sid in unscored:
        RankingSnapshot.objects.update_or_create(
            classroom=classroom, kind=RankingSnapshot.KIND_SAT, period_key=period_key, student_id=sid,
            defaults=dict(
                rank=unranked_rank,
                previous_rank=prev.get(sid),
                score=None,
                percentile=None,
                trend=None,
                confidence=None,
                components={"no_result": True, "rank_change": None},
                computed_at=now,
            ),
        )
    return len(scored)


def _recompute_academic(classroom, student_ids, period_key, now) -> int:
    """Rank on assessment points banked since the class opened (see ranking/rules.py).

    Every active student is written, including those on 0 — an academic board is the
    teacher's roster view, and a student who has done nothing is exactly who they want to
    see on it.
    """
    since = rules.classroom_opened_at(classroom, now=now)
    totals = rules.assessment_points_per_student(classroom, student_ids, since=since, until=now)

    computed = sorted(
        (
            (sid, totals.get(sid, {"points": 0.0, "max_points": 0.0, "assessments_count": 0, "graded_count": 0}))
            for sid in student_ids
        ),
        key=lambda t: (-t[1]["points"], -t[1]["assessments_count"], t[0]),
    )
    scores = [row["points"] for _sid, row in computed]
    prev = _previous_ranks(classroom, RankingSnapshot.KIND_ACADEMIC, period_key)
    prev_scores = _previous_scores(classroom, RankingSnapshot.KIND_ACADEMIC, period_key)

    for rank, (sid, row) in enumerate(computed, start=1):
        prev_rank = prev.get(sid)
        trend = _academic_trend(prev_scores.get(sid), row["points"])
        RankingSnapshot.objects.update_or_create(
            classroom=classroom, kind=RankingSnapshot.KIND_ACADEMIC, period_key=period_key, student_id=sid,
            defaults=dict(
                rank=rank,
                previous_rank=prev_rank,
                score=row["points"],
                percentile=_percentile(row["points"], scores),
                trend=trend,
                confidence=None,
                components={
                    "points": row["points"],
                    "max_points": row["max_points"],
                    "assessments_count": row["assessments_count"],
                    "graded_count": row["graded_count"],
                    "since": since.isoformat(),
                    "trend": trend,
                    "rank_change": (prev_rank - rank) if prev_rank else None,
                },
                computed_at=now,
            ),
        )
    return len(computed)


def _previous_scores(classroom, kind, current_period) -> dict[int, float]:
    rows = (
        RankingSnapshot.objects.filter(classroom=classroom, kind=kind)
        .exclude(period_key=current_period)
        .order_by("student_id", "-computed_at")
        .values("student_id", "score", "computed_at")
    )
    out: dict[int, float] = {}
    for r in rows:
        out.setdefault(r["student_id"], float(r["score"]))
    return out


def _academic_trend(prev_score, score) -> str:
    if prev_score is None:
        return RankingSnapshot.TREND_STABLE
    delta = score - prev_score
    if delta > ACADEMIC_TREND_EPS:
        return RankingSnapshot.TREND_IMPROVING
    if delta < -ACADEMIC_TREND_EPS:
        return RankingSnapshot.TREND_DECLINING
    return RankingSnapshot.TREND_STABLE
