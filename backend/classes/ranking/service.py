"""Ranking orchestration — gather inputs, rank, persist snapshots.

One rule, deliberately plain: a classroom is ranked on the **XP** its students have earned in
it. This module only orders them and writes the snapshots.

There used to be a second board. SAT ranked students on their own latest assigned pastpaper,
and the school has removed it from the classroom: a leaderboard built on one test result told
students who had sat a pastpaper recently rather than who was working, and it sat beside an
Academic board that answered the better question. ``KIND_SAT`` survives on the model so the
historical rows stay readable; nothing computes it any more.

Academic is a **projection of the reward ledger**, not a calculation. It was a re-derived sum
of assessment scores until the rewards cutover; ``rewards.PointAward`` is now the single place
an earning is decided, and this board reads it. Nothing here writes points or XP.

The currency on that board is now **XP rather than points**, which changes what it measures
in exactly two ways: a late arrival no longer moves it, and neither does a survey. Both still
earn points, and points still buy coins — the board simply stopped being the place they show
up. One consequence worth knowing before reading `_academic_trend`: XP cannot fall, so a
student's *score* never declines and only their *rank* can, when others earn faster.

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
def recompute_classroom(classroom, *, kinds=("ACADEMIC",), period_key=None, now=None) -> dict:
    """Recompute the classroom's boards. ACADEMIC is the only one left.

    ``kinds`` is kept, rather than dropped for a single-board pipeline, because callers pass
    it and because a request for a board that no longer exists should be *ignored* rather than
    crash — an old ops button or a stale queued task asking for "SAT" gets an empty summary
    and moves on.
    """
    now = now or timezone.now()
    period_key = period_key or now.date().isoformat()
    student_ids = _student_ids(classroom)
    summary = {}

    if "ACADEMIC" in kinds:
        summary["ACADEMIC"] = _recompute_academic(classroom, student_ids, period_key, now)
    return summary


def _recompute_academic(classroom, student_ids, period_key, now) -> int:
    """Rank on **XP earned in this classroom** — a projection of the reward ledger.

    The currency has changed twice. It used to be the sum of raw ``AssessmentResult``
    score_points, re-derived here every 20 minutes; the rewards cutover replaced that with
    ``PointAward.points``; the school has now moved it to ``PointAward.xp``. What has not
    changed is that nothing about an earning is decided here — a number re-derived inside a
    pipeline that also *deletes* its own rows silently changes whenever a rule or a source row
    changes, and a student cannot be told why their total moved.

    XP rather than points because this board answers "who is learning", and points answer
    "who has been rewarded". A late arrival and a completed survey are both worth rewarding
    and neither is evidence of learning, so both earn points and neither earns XP. They still
    show on the student's Points page and still buy coins.

    Scoped to awards carrying this classroom, so the board answers "earned in this class".
    Classroom-less earnings — surveys, midterms — count toward the student's global XP on
    their Points page but toward no single class board. That is the school's stated default and
    the reason every award carries a nullable classroom; if they later want midterms on the
    class board, awards need a home-classroom rule rather than a change here.

    Every active student is written, including those on 0 — an academic board is the
    teacher's roster view, and a student who has done nothing is exactly who they want to
    see on it.
    """
    from rewards.services import xp_board_totals_for

    totals = xp_board_totals_for(student_ids, classroom=classroom)

    computed = sorted(
        ((sid, totals.get(sid, {"xp": 0, "awards": 0})) for sid in student_ids),
        key=lambda t: (-t[1]["xp"], -t[1]["awards"], t[0]),
    )
    scores = [float(row["xp"]) for _sid, row in computed]
    prev = _previous_ranks(classroom, RankingSnapshot.KIND_ACADEMIC, period_key)
    prev_scores = _previous_scores(classroom, RankingSnapshot.KIND_ACADEMIC, period_key)

    for rank, (sid, row) in enumerate(computed, start=1):
        prev_rank = prev.get(sid)
        xp = float(row["xp"])
        trend = _academic_trend(prev_scores.get(sid), xp)
        RankingSnapshot.objects.update_or_create(
            classroom=classroom, kind=RankingSnapshot.KIND_ACADEMIC, period_key=period_key, student_id=sid,
            defaults=dict(
                rank=rank,
                previous_rank=prev_rank,
                score=xp,
                percentile=_percentile(xp, scores),
                trend=trend,
                confidence=None,
                # No season here, deliberately. `components` is served to staff and to the
                # student themselves (views_rankings.py), and the season is invisible product-
                # wide — hiding it in the UI would leave it readable in devtools.
                #
                # `xp` and `points` carry the same number: `xp` is what this board now means,
                # and `points` stays so a client reading the older key does not render a blank
                # score the moment this deploys. It can go once the frontend has moved.
                components={
                    "xp": row["xp"],
                    "points": row["xp"],
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
    """IMPROVING / STABLE — and, since the board moved to XP, never DECLINING.

    The DECLINING branch is kept rather than deleted: it still fires for historical snapshots
    taken when the board ran on points, and a board that could only ever say "improving" would
    be a lie if the currency were ever changed back. Rank is where a student sees themselves
    slip now, which is the honest signal — they did not go backwards, others went faster.
    """
    if prev_score is None:
        return RankingSnapshot.TREND_STABLE
    delta = score - prev_score
    if delta > ACADEMIC_TREND_EPS:
        return RankingSnapshot.TREND_IMPROVING
    if delta < -ACADEMIC_TREND_EPS:
        return RankingSnapshot.TREND_DECLINING
    return RankingSnapshot.TREND_STABLE
