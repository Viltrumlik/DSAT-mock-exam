"""The platform-wide leaderboard: XP, ranked, across any slice of the school.

**Computed live, not snapshotted.** The classroom boards persist `RankingSnapshot` rows so a
teacher can see rank movement day to day; this one deliberately does not, and the reason is
combinatorial. Three scopes times four time windows times three subjects times every branch
is a snapshot table that grows faster than the school does, all to cache an aggregate the
ledger is already indexed for — `PointAward` carries `(student, season)`, `(season, classroom)`
and `(student, -awarded_at)`, which is every access path below.

If it ever does need caching, cache the *response*. Do not add rows.

**What XP is missing here, and why it is the honest answer.** Midterm awards carry no
classroom (a midterm belongs to the school, not to one class), so they have no branch and no
subject. They count on the Global board and vanish the moment any branch or subject filter is
applied. That is not a bug to paper over: a filtered board answers "XP earned in Chilonzor" or
"XP earned in Math", and a midterm was earned in neither. The API says so in `scope_note`
rather than leaving a student to wonder why their total shrank when they pressed a filter.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone

from .models import PointAward

# ── Scopes ────────────────────────────────────────────────────────────────────

SCOPE_GLOBAL = "GLOBAL"
SCOPE_BRANCH = "BRANCH"
SCOPE_GROUP = "GROUP"       # "group" is this school's word for a classroom
SCOPE_CHOICES = (SCOPE_GLOBAL, SCOPE_BRANCH, SCOPE_GROUP)

# ── Time windows ──────────────────────────────────────────────────────────────
#
# Windows filter on `awarded_at`, not on the season. A season is an accounting boundary the
# product deliberately never shows a student (see `coins.wallet_state`), and "this term" is
# not a question anybody asked — "this week" is.

WINDOW_ALL = "ALL"
WINDOW_WEEK = "WEEK"
WINDOW_MONTH = "MONTH"
WINDOW_TERM = "TERM"        # 90 days — a teaching term, near enough, without naming a season
WINDOW_DAYS = {WINDOW_WEEK: 7, WINDOW_MONTH: 30, WINDOW_TERM: 90}
WINDOW_CHOICES = (WINDOW_ALL, WINDOW_WEEK, WINDOW_MONTH, WINDOW_TERM)

#: Nobody scrolls a thousand rows, and an unbounded board is an unbounded query.
DEFAULT_LIMIT = 50
MAX_LIMIT = 200


@dataclass(frozen=True)
class BoardQuery:
    scope: str = SCOPE_GLOBAL
    window: str = WINDOW_ALL
    branch_id: int | None = None
    classroom_id: int | None = None
    subject: str | None = None      # Classroom.SUBJECT_ENGLISH / SUBJECT_MATH
    level: str | None = None        # foundation / junior / middle / senior
    limit: int = DEFAULT_LIMIT

    @classmethod
    def from_params(cls, params) -> "BoardQuery":
        """Parse query params, coercing anything unrecognised to the safe default.

        Deliberately forgiving. A leaderboard is a browsing surface reached from filter chips,
        and 400ing a student because a stale bookmark says `window=fortnight` serves nobody —
        the worst outcome of a bad value here is that they see the all-time global board and
        press a chip.
        """
        def _int(name):
            try:
                return int(params.get(name))
            except (TypeError, ValueError):
                return None

        scope = str(params.get("scope") or SCOPE_GLOBAL).upper()
        window = str(params.get("window") or WINDOW_ALL).upper()
        try:
            limit = min(MAX_LIMIT, max(1, int(params.get("limit") or DEFAULT_LIMIT)))
        except (TypeError, ValueError):
            limit = DEFAULT_LIMIT

        return cls(
            scope=scope if scope in SCOPE_CHOICES else SCOPE_GLOBAL,
            window=window if window in WINDOW_CHOICES else WINDOW_ALL,
            branch_id=_int("branch"),
            classroom_id=_int("classroom"),
            subject=(str(params.get("subject")).upper() if params.get("subject") else None),
            level=(str(params.get("level")).lower() if params.get("level") else None),
            limit=limit,
        )


def _resolve_scope(query: BoardQuery, viewer) -> BoardQuery:
    """Fill in "my" branch and "my" group from the viewer when the caller named neither.

    This is what makes the three tabs work without the client having to know its own branch
    id: `scope=BRANCH` with no `branch` means *my* branch, which is the only thing "My Branch"
    can mean.
    """
    from classes.models_org import branch_for_student

    if query.scope == SCOPE_BRANCH and query.branch_id is None:
        branch = branch_for_student(viewer)
        return BoardQuery(**{**query.__dict__, "branch_id": branch.pk if branch else None})

    if query.scope == SCOPE_GROUP and query.classroom_id is None:
        from classes.models import ClassroomMembership

        membership = (
            ClassroomMembership.objects.filter(
                user=viewer,
                role=ClassroomMembership.ROLE_STUDENT,
                status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            )
            .order_by("-joined_at", "-id")
            .first()
        )
        return BoardQuery(
            **{**query.__dict__, "classroom_id": membership.classroom_id if membership else None}
        )
    return query


def _award_filter(query: BoardQuery) -> Q:
    """Every filter, as one Q over PointAward. Empty Q means the whole ledger."""
    q = Q(xp__gt=0)     # a row worth no XP is not an earning on this board

    if query.window != WINDOW_ALL:
        since = timezone.now() - timedelta(days=WINDOW_DAYS[query.window])
        q &= Q(awarded_at__gte=since)

    if query.scope == SCOPE_GROUP:
        # An unresolvable group is an empty board, never the global one. Falling back to
        # "everyone" here would silently show a student the whole school under a tab labelled
        # "My Group".
        q &= Q(classroom_id=query.classroom_id) if query.classroom_id else Q(pk__in=[])
    elif query.scope == SCOPE_BRANCH:
        q &= Q(classroom__branch_id=query.branch_id) if query.branch_id else Q(pk__in=[])
    elif query.branch_id:
        # A branch filter on the global board — browsing another branch rather than your own.
        q &= Q(classroom__branch_id=query.branch_id)

    if query.subject:
        q &= Q(classroom__subject=query.subject)
    if query.level:
        q &= Q(classroom__level=query.level)
    return q


def board(query: BoardQuery, viewer):
    """``(rows, meta)`` — the ranked slice, plus what it took to build it.

    Rows are ``{student_id, xp, awards, rank}`` in rank order, ties broken by earning count
    then student id so the order is stable between two calls that return the same numbers.
    Names and photos are the caller's job: this module knows nothing about display, and the
    view is where anonymity policy would belong.
    """
    query = _resolve_scope(query, viewer)

    rows = list(
        PointAward.objects.filter(_award_filter(query))
        .values("student_id")
        .annotate(xp=Sum("xp"), awards=Count("id"))
        .order_by("-xp", "-awards", "student_id")[: query.limit]
    )
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
        row["xp"] = int(row["xp"] or 0)

    return rows, {
        "scope": query.scope,
        "window": query.window,
        "branch_id": query.branch_id,
        "classroom_id": query.classroom_id,
        "subject": query.subject,
        "level": query.level,
        "count": len(rows),
        "scope_note": _scope_note(query),
    }


def _scope_note(query: BoardQuery) -> str:
    """One sentence saying what this board counts, in the student's words.

    Present because the filters genuinely change the answer — a branch or subject filter drops
    midterm XP, which carries neither — and a leaderboard that quietly counts something
    different from what its heading says is the fastest way to lose a student's trust in it.
    """
    if query.scope == SCOPE_GROUP and not query.classroom_id:
        return "You're not in a group yet, so there's nobody to rank you against."
    if query.scope == SCOPE_BRANCH and not query.branch_id:
        return "Your branch isn't set yet — it comes from the class you study in."

    narrowed = bool(query.branch_id or query.subject or query.level) or query.scope != SCOPE_GLOBAL
    base = {
        WINDOW_ALL: "All the XP earned",
        WINDOW_WEEK: "XP earned in the last 7 days",
        WINDOW_MONTH: "XP earned in the last 30 days",
        WINDOW_TERM: "XP earned in the last 90 days",
    }[query.window]

    if narrowed:
        return f"{base} here. Midterm XP isn't counted — a midterm belongs to the school, not to one class."
    return f"{base} across the whole school."


def rank_of(student, query: BoardQuery, viewer=None):
    """Where one student stands, even when they are past the visible limit.

    A board that cannot tell a student their own position is a board they have no reason to
    look at. Counting how many people are ahead is one aggregate — cheaper than materialising
    the full ordering and slicing it.
    """
    query = _resolve_scope(query, viewer if viewer is not None else student)
    base = PointAward.objects.filter(_award_filter(query))

    mine = base.filter(student=student).aggregate(xp=Sum("xp"), awards=Count("id"))
    my_xp = int(mine["xp"] or 0)
    if not my_xp:
        return None

    ahead = (
        base.values("student_id")
        .annotate(xp=Sum("xp"))
        .filter(xp__gt=my_xp)
        .count()
    )
    return {
        "student_id": student.pk,
        "xp": my_xp,
        "awards": int(mine["awards"] or 0),
        # +1 for the student themselves. Ties share the lower rank, which is the convention
        # the classroom boards already use.
        "rank": ahead + 1,
    }
