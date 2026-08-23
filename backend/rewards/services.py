"""The only supported way to write reward points.

Every caller is a hook sitting inside somebody else's transaction — the moment a midterm is
scored, an attendance session frozen, a homework graded. Two rules follow from that, and both
are load-bearing:

1. **An award must never raise into its caller.** Several hook sites already swallow
   exceptions by design (e.g. ``MidtermAttempt.complete`` at ``midterms/models.py:779-786``);
   a points failure must not un-complete a scored attempt or refuse a teacher's finalize.

2. **A failure must not poison the caller's transaction.** Catching an ``IntegrityError``
   without a savepoint leaves the surrounding transaction unusable on PostgreSQL — every
   later query in the request would fail with "current transaction is aborted". So the write
   runs inside its own ``transaction.atomic()`` block (a savepoint when nested) and the
   ``except`` sits *outside* it, letting Django roll the savepoint back cleanly.

Awarding is idempotent by construction: ``update_or_create`` on ``idempotency_key``. Re-running
a hook corrects the value in place; it never stacks a second row.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from . import constants
from .models import PointAward, PointAwardAudit, RewardRule, RewardSeason

logger = logging.getLogger(__name__)


# ── Season ────────────────────────────────────────────────────────────────────

def current_season() -> RewardSeason:
    """The season awards are written into, creating the first one on demand.

    Created lazily rather than by a data migration so a fresh install, a test database and
    production all reach the same state without an ordering dependency.
    """
    season = RewardSeason.objects.filter(is_current=True).first()
    if season is not None:
        return season
    season, _ = RewardSeason.objects.get_or_create(
        is_current=True,
        defaults={"name": "Season 1", "started_at": timezone.now()},
    )
    return season


def start_new_season(name: str, *, actor=None, note: str = "") -> RewardSeason:
    """Close the current season and open a new one — this is the "reset everyone's points"
    operation. Nothing is deleted: old awards stay attached to the closed season, so a reset
    is auditable and reversible."""
    now = timezone.now()
    with transaction.atomic():
        RewardSeason.objects.filter(is_current=True).update(is_current=False, ended_at=now)
        return RewardSeason.objects.create(
            name=name, started_at=now, is_current=True, created_by=actor, note=note
        )


# ── Rules ─────────────────────────────────────────────────────────────────────

def pricing_for(event: str) -> tuple[int, bool]:
    """``(points, grants_xp)`` for an event, in ONE query.

    Both answers live on the same ``RewardRule`` row, and ``award`` needs both on every grant.
    Reading them through two lookups would double the query count on the ledger's hottest
    path — the deadline sweep re-prices every open bundle every ten minutes.

    Falls back to the seeded default when no *active* rule row exists, so introducing a new
    event never silently awards nothing. An inactive rule is treated as absent for both
    answers, not as "worth nothing" and not as "no XP".
    """
    rule = (
        RewardRule.objects.filter(event=event, is_active=True)
        .only("points", "grants_xp")
        .first()
    )
    if rule is not None:
        return int(rule.points), bool(rule.grants_xp)
    return (
        int(constants.DEFAULT_POINTS.get(event, 0)),
        event not in constants.XP_EXCLUDED_EVENTS,
    )


def points_for(event: str) -> int:
    """Live value of an event. See :func:`pricing_for`."""
    return pricing_for(event)[0]


# ── Awarding ──────────────────────────────────────────────────────────────────

def _notify_earned(student, award_row, *, previous_points: int | None) -> None:
    """Tell a student their points moved — in-app only, and only when they moved UP.

    Called from two of :func:`award`'s three branches, and **the branch that does not call it
    is the entire reason this is a function rather than three inline lines.**

    ``award`` is re-entrant by design. The receivers in ``hooks`` fire it on every save of every
    source row, ``settle_due_homework`` re-runs it across every open bundle every ten minutes,
    and the backfill commands replay it over history. The overwhelmingly common outcome is the
    no-op re-run: nothing changed, so nothing is written — not even an audit row. Ringing a bell
    there would put a notification in front of every student with an open homework every ten
    minutes, for ever. That is a platform-wide incident, not a bug, so the no-op branch does not
    call this and must never start.

    ``previous_points`` is ``None`` on a first grant and the previous value on a correction.

    **A correction downwards is silent.** A re-grade dropping a homework from 90% to 60%, a
    PRESENT corrected to LATE, a manual adjustment revised down — each of those lowers an
    earning, and none of them is news a student should be handed. Telling somebody their points
    went down is exactly the punishing framing this school's student UI does not use, and the
    ledger on the rewards page already shows the movement to anyone who goes looking. The XP
    high-water mark next door makes the same judgement in the arithmetic: doing worse does not
    take anything away, so it should not announce anything either.

    **Nothing worth zero or less is announced.** ``award`` treats an explicit 0 as a recorded
    "this was assessed and earned nothing" (a 0% homework, a midterm re-sat below the pass mark)
    and ``MANUAL`` can dock somebody outright. "You earned 0 points" is noise at best. A row that
    starts at zero and is later corrected upward reaches the correction branch and is announced
    then — which is the moment it is actually good news.

    **Deliberately not a push.** ``REWARD_EARNED`` is absent from ``notifications.PUSH_EVENTS``
    and stays absent. Points move several times a day for an active student, and a platform that
    buzzes a phone for each one teaches students to switch push off — after which the homework
    deadline does not reach them either.
    """
    value = int(award_row.points)
    if value <= 0:
        return
    if previous_points is not None and value <= int(previous_points):
        return

    # Built HERE, before the callback is registered, so the closure below carries nothing but
    # plain strings and the student. Nothing about delivering this can touch the database after
    # the transaction has already closed.
    label = award_row.get_event_display()
    if previous_points is None:
        title = f"You earned {value} points"
        body = label
    else:
        title = f"{label} is now worth {value} points"
        body = "Your earlier award was updated and your points went up."
    # Keyed on the award's own idempotency key, so a correction landing inside the dedupe window
    # rewrites the original's wording in place instead of stacking a second row: one earning,
    # one line in the bell, however many times it gets re-priced.
    dedupe_key = f"reward:{award_row.idempotency_key}"

    def _send():
        # Local import, like every other notify call site in this codebase: `notifications`
        # imports models at module scope and `rewards` is loaded from signal wiring, so a
        # top-level import here is an app-loading cycle waiting to happen.
        from notifications import constants as note_const
        from notifications.services import notify

        notify(
            student,
            event=note_const.EVENT_REWARD_EARNED,
            title=title,
            body=body,
            # The student's own rewards page — the recipient here is always the earner, never
            # a member of staff, so this is a student-console path.
            link_url="/rewards",
            dedupe_key=dedupe_key,
        )

    # ``award`` always holds a transaction — its own ``atomic``, usually nested inside a
    # caller's — so the send waits for the commit. A student told they earned points for an
    # award that then rolls back has read something that is not true and cannot un-read it.
    # Django discards ``on_commit`` callbacks registered after a savepoint that is rolled back,
    # which is precisely the failure path ``award``'s savepoint exists to handle.
    transaction.on_commit(_send)


def award(
    student,
    event: str,
    *,
    idempotency_key: str,
    classroom=None,
    source_type: str = "",
    source_id: int | None = None,
    points: int | None = None,
    actor=None,
    note: str = "",
    reason: str = "",
) -> PointAward | None:
    """Grant — or correct — one earning. Returns the award, or ``None`` if it could not be
    written (already logged; callers are not expected to handle it).

    ``points`` overrides the rule, and is required for ``MANUAL``. Passing an explicit 0 is
    meaningful: it records "this was assessed and earned nothing", which a later re-grade can
    then raise. Callers that mean "nothing happened at all" should not call this.
    """
    if student is None or not event:
        return None
    try:
        with transaction.atomic():   # savepoint — see module docstring
            season = current_season()

            existing = (
                PointAward.objects.select_for_update()
                .filter(idempotency_key=idempotency_key)
                .first()
            )

            # One rule read for both answers. `grants_xp` is needed on every path — even the
            # no-op re-run has to compute the XP to know nothing moved — so the lookup is
            # unconditional, but it must stay a SINGLE query: pricing and the XP flag live on
            # the same row, and asking for them separately would double the query count on the
            # path the ten-minute sweep hammers.
            rule_points, grants_xp = pricing_for(event)

            # Price ONCE, at the moment the earning is first recognised. Re-reading the rule
            # on every correction would let a retune rewrite history: hooks re-fire freely by
            # design and the sweep re-runs every ten minutes, so lowering HOMEWORK from 15 to 5
            # would silently restate awards students had already banked and seen. The models
            # docstring states that invariant; this is what holds it.
            #
            # Proportional homework is unaffected: it passes an explicit `points=`, which takes
            # the first branch and never reaches the frozen one — a re-settled bundle is meant
            # to move with the percentage.
            #
            # A changed EVENT is a changed fact (a re-grade moving MID→FULL) and does re-price.
            # A revoked award (points zeroed) is re-priced from the rule when the fact comes
            # back — PRESENT → ABSENT → PRESENT has to restore the 5, not keep the 0.
            if points is not None:
                value = int(points)
            elif existing is not None and existing.event == event and existing.points != 0:
                value = int(existing.points)
            else:
                value = rule_points
            if existing is None:
                created = PointAward.objects.create(
                    student=student, season=season, event=event, points=value,
                    xp=constants.xp_for(event, value, grants_xp=grants_xp),
                    classroom=classroom, source_type=source_type, source_id=source_id,
                    idempotency_key=idempotency_key, created_by=actor, note=note,
                )
                PointAwardAudit.objects.create(
                    award=created, previous_points=None, new_points=value,
                    previous_xp=None, new_xp=created.xp,
                    reason=reason or "granted", actor=actor,
                )
                # A genuinely new earning. This is the ONLY branch that is unconditionally
                # worth telling somebody about — see :func:`_notify_earned`.
                _notify_earned(student, created, previous_points=None)
                return created

            previous = existing.points
            previous_xp = int(existing.xp)
            # The high-water mark. `max` rather than assignment is the whole of the school's
            # "XP is never taken away for doing WORSE" rule, and it holds against every way an
            # earning can shrink: a re-grade dropping a homework from 90% to 60%, a PRESENT
            # corrected to LATE, a manual adjustment revised downwards. Each lowers `points`
            # and leaves `xp` untouched. It still climbs freely — ABSENT corrected back to
            # PRESENT, or a re-sit scoring higher, raises both.
            #
            # The narrower rule lives in `revoke`: a fact that never happened at all does take
            # its XP back. `max` here is only about a fact that got smaller.
            new_xp = max(previous_xp, constants.xp_for(event, value, grants_xp=grants_xp))
            changed = previous != value or existing.event != event or new_xp != previous_xp
            if not changed:
                # The common case on a re-run: a backfill command or a duplicate Celery
                # delivery. Deliberately writes nothing at all, not even an audit row — and
                # deliberately notifies nothing either. The ten-minute sweep lands here for
                # every settled homework on the platform; a notification on this branch would
                # be a bell per student per sweep, for ever.
                return existing

            existing.points = value
            existing.xp = new_xp
            existing.event = event
            # Re-home a correction into the season it actually happened in.
            #
            # `idempotency_key` is globally unique, not season-scoped, so an earning keeps its
            # row across a reset. Without this the row stays pinned to the closed season:
            # a student who improves last term's homework this term is paid nothing in the
            # season they can see, while the closed season's archived total silently moves.
            existing.season = season
            if classroom is not None:
                existing.classroom = classroom
            if note:
                existing.note = note
            existing.save(
                update_fields=["points", "xp", "event", "season", "classroom", "note", "updated_at"]
            )
            PointAwardAudit.objects.create(
                award=existing, previous_points=previous, new_points=value,
                previous_xp=previous_xp, new_xp=new_xp,
                reason=reason or "corrected", actor=actor,
            )
            # A correction. `_notify_earned` compares against `previous` and stays quiet unless
            # the earning actually grew — a re-grade downwards is not something to announce.
            _notify_earned(student, existing, previous_points=previous)
            return existing
    except Exception:
        logger.exception(
            "reward_award_failed event=%s key=%s student=%s",
            event, idempotency_key, getattr(student, "id", None),
        )
        return None


def revoke(idempotency_key: str, *, reason: str, actor=None) -> bool:
    """Take an award back by zeroing it — points **and** XP — keeping the row and its history.

    Used when the fact behind an award is corrected away: a PRESENT flipped to ABSENT, a
    survey response withdrawn, a support session un-held. Deleting the row instead would make
    the student's history silently disagree with their balance.

    **The refined XP rule, precisely.** XP is never taken away for doing WORSE — that is
    ``award``'s ``max(previous_xp, …)``, and a re-grade that lowers an earning still leaves
    the XP standing. But a WITHDRAWN fact takes its XP with it, because a fact that never
    happened cannot be evidence of anything. Doing worse and not having done it at all are
    different, and only the second reaches here.

    That distinction is what makes save-time attendance payment safe. Attendance now pays the
    moment a teacher saves the register, not when the session is finalized, and the register
    has a **Mark all present** button that writes a PRESENT row for the entire roster with no
    confirmation. Under the old rule one mis-click permanently granted XP to every absentee in
    the class and no correction could take it back — the teacher could fix the points and the
    board would stay wrong forever. Zeroing XP here is the only thing that makes the mis-click
    recoverable.

    The audit row records the XP leaving (``previous_xp`` → 0) rather than leaving a reader to
    infer it, for the same reason the columns exist at all: "why did my XP drop?" has to be
    answerable from the ledger alone.
    """
    try:
        with transaction.atomic():
            existing = (
                PointAward.objects.select_for_update()
                .filter(idempotency_key=idempotency_key)
                .first()
            )
            # Both columns, not just `points`: a row revoked before this rule existed still
            # carries its XP, and a re-fired hook is then the thing that finishes the job.
            # Re-revoking a fully zeroed row is still the no-op the hooks depend on.
            if existing is None or (existing.points == 0 and existing.xp == 0):
                return False
            previous = existing.points
            previous_xp = int(existing.xp)
            existing.points = 0
            existing.xp = 0
            existing.save(update_fields=["points", "xp", "updated_at"])
            PointAwardAudit.objects.create(
                award=existing, previous_points=previous, new_points=0,
                previous_xp=previous_xp, new_xp=0,
                reason=reason or "revoked", actor=actor,
            )
            return True
    except Exception:
        logger.exception("reward_revoke_failed key=%s", idempotency_key)
        return False


# ── Reading ───────────────────────────────────────────────────────────────────

def balance(student, *, season=None) -> int:
    """Lifetime points in a season (the current one by default)."""
    season = season or current_season()
    total = PointAward.objects.filter(student=student, season=season).aggregate(
        total=Sum("points")
    )["total"]
    return int(total or 0)


# ── XP ────────────────────────────────────────────────────────────────────────
#
# XP reads are LIFETIME — they cross every season, where points are always scoped to one.
#
# That is forced by the rule rather than chosen for convenience. Closing a season is how the
# school resets the scoreboard, and if XP were season-scoped that reset would be the single
# largest subtraction on the platform — taking every student's XP to zero, which is the one
# thing XP is defined never to do. A `classroom` filter is still offered, because the
# Academic board is per-class; it narrows *where* the XP was earned, never *when*.

def xp_balance(student, *, classroom=None) -> int:
    """A student's lifetime XP, optionally only what was earned in one classroom."""
    qs = PointAward.objects.filter(student=student)
    if classroom is not None:
        qs = qs.filter(classroom=classroom)
    return int(qs.aggregate(total=Sum("xp"))["total"] or 0)


def xp_balances_for(student_ids, *, classroom=None) -> dict[int, int]:
    """``{student_id: xp}`` for a cohort, in one query. Missing students are absent, not zero —
    callers rendering a board must default them, the same as :func:`balances_for`."""
    if not student_ids:
        return {}
    qs = PointAward.objects.filter(student_id__in=student_ids)
    if classroom is not None:
        qs = qs.filter(classroom=classroom)
    rows = qs.values("student_id").annotate(total=Sum("xp"))
    return {row["student_id"]: int(row["total"] or 0) for row in rows}


def xp_board_totals_for(student_ids, *, classroom=None) -> dict[int, dict]:
    """``{student_id: {"xp": int, "awards": int}}`` — what the Academic board reads.

    The XP twin of :func:`board_totals_for`, and it differs in the way XP always does: no
    season filter, because XP is a lifetime figure. ``awards`` counts only the earnings that
    actually carried XP, which is now the revoked rows and anything a rule has had ``grants_xp``
    turned off for — a student whose whole history was withdrawn reads as 0 from 0 rather than
    0 from nine, and the second would look like a bug to whoever is staring at the board.
    """
    if not student_ids:
        return {}
    qs = PointAward.objects.filter(student_id__in=student_ids)
    if classroom is not None:
        qs = qs.filter(classroom=classroom)
    rows = qs.values("student_id").annotate(
        total=Sum("xp"),
        earned=Count("id", filter=Q(xp__gt=0)),
    )
    return {
        row["student_id"]: {"xp": int(row["total"] or 0), "awards": int(row["earned"] or 0)}
        for row in rows
    }


def balances_for(student_ids, *, season=None, classroom=None) -> dict[int, int]:
    """``{student_id: points}`` for a cohort, in one query.

    ``classroom`` narrows to awards earned in that class — which is what a per-class board
    wants. Note this deliberately excludes classroom-less earnings (surveys, midterms): they
    count toward a student's global balance but belong to no single class.
    """
    if not student_ids:
        return {}
    season = season or current_season()
    qs = PointAward.objects.filter(student_id__in=student_ids, season=season)
    if classroom is not None:
        qs = qs.filter(classroom=classroom)
    rows = qs.values("student_id").annotate(total=Sum("points"))
    return {row["student_id"]: int(row["total"] or 0) for row in rows}


def board_totals_for(student_ids, *, season=None, classroom=None) -> dict[int, dict]:
    """``{student_id: {"points": int, "awards": int}}`` — what a leaderboard projection reads.

    Same scoping as :func:`balances_for`, plus the number of earnings behind the total, so a
    member of staff looking at a board row can ask "from how many things?" without opening the
    ledger. Zeroed awards are excluded from that count for the reason they are hidden from the
    student's own feed: a revoked row is not an earning, and counting it would make a board say
    a student did something they no longer have any points for.

    The academic board is a **projection** of this table and never writes to it — see §0 of
    docs/rewards/PLAN.md. Points computed inside the ranking pipeline would silently change
    whenever a rule or a source row changed, because that pipeline re-derives from scratch.
    """
    if not student_ids:
        return {}
    season = season or current_season()
    qs = PointAward.objects.filter(student_id__in=student_ids, season=season)
    if classroom is not None:
        qs = qs.filter(classroom=classroom)
    rows = qs.values("student_id").annotate(
        total=Sum("points"),
        earned=Count("id", filter=Q(points__gt=0)),
    )
    return {
        row["student_id"]: {"points": int(row["total"] or 0), "awards": int(row["earned"] or 0)}
        for row in rows
    }
