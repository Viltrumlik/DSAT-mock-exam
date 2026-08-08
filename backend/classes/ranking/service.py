"""Ranking orchestration — gather inputs, rank, persist snapshots.

Two rules, deliberately plain: SAT is a student's own latest assigned pastpaper (see
ranking/rules.py), Academic is the reward points they have earned in this classroom. This
module only orders them and writes the snapshots.

Academic is a **projection of the reward ledger**, not a calculation. It was a re-derived sum
of assessment scores until the rewards cutover; ``rewards.PointAward`` is now the single place
a point is decided, and this board reads it. Nothing here writes points.

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
    """Rank on **reward points earned in this classroom** — a projection of the reward ledger.

    The currency changed at the rewards cutover. It used to be the sum of raw
    ``AssessmentResult.score_points`` re-derived here every 20 minutes; it is now
    ``rewards.PointAward``, which is event-sourced: attendance, homework bundles, support
    sessions and midterms write it once and this board only reads. Nothing about a point is
    decided here any more, which is the whole point — a number re-derived inside a pipeline
    that also *deletes* its own rows silently changes whenever a rule or a source row changes,
    and a student cannot be told why their total moved.

    Scoped to awards carrying this classroom, so the board answers "earned in this class".
    Classroom-less earnings — surveys, midterms — count toward the student's global balance on
    their Points page but toward no single class board. That is the school's stated default and
    the reason every award carries a nullable classroom; if they later want midterms on the
    class board, awards need a home-classroom rule rather than a change here.

    Every active student is written, including those on 0 — an academic board is the
    teacher's roster view, and a student who has done nothing is exactly who they want to
    see on it.
    """
    from rewards.services import board_totals_for

    totals = board_totals_for(student_ids, classroom=classroom)

    computed = sorted(
        ((sid, totals.get(sid, {"points": 0, "awards": 0})) for sid in student_ids),
        key=lambda t: (-t[1]["points"], -t[1]["awards"], t[0]),
    )
    scores = [float(row["points"]) for _sid, row in computed]
    prev = _previous_ranks(classroom, RankingSnapshot.KIND_ACADEMIC, period_key)
    prev_scores = _previous_scores(classroom, RankingSnapshot.KIND_ACADEMIC, period_key)

    for rank, (sid, row) in enumerate(computed, start=1):
        prev_rank = prev.get(sid)
        points = float(row["points"])
        trend = _academic_trend(prev_scores.get(sid), points)
        RankingSnapshot.objects.update_or_create(
            classroom=classroom, kind=RankingSnapshot.KIND_ACADEMIC, period_key=period_key, student_id=sid,
            defaults=dict(
                rank=rank,
                previous_rank=prev_rank,
                score=points,
                percentile=_percentile(points, scores),
                trend=trend,
                confidence=None,
                # No season here, deliberately. `components` is served to staff and to the
                # student themselves (views_rankings.py), and the season is invisible product-
                # wide — hiding it in the UI would leave it readable in devtools.
                components={
                    "points": row["points"],
                    "awards": row["awards"],
                    "source": "rewards",
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
