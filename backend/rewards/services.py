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

def points_for(event: str) -> int:
    """Live value of an event. Falls back to the seeded default when no rule row exists, so
    introducing a new event never silently awards nothing."""
    rule = RewardRule.objects.filter(event=event, is_active=True).only("points").first()
    if rule is not None:
        return int(rule.points)
    return int(constants.DEFAULT_POINTS.get(event, 0))


# ── Awarding ──────────────────────────────────────────────────────────────────

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

            # Price ONCE, at the moment the earning is first recognised. Re-reading the rule
            # on every correction would let a retune rewrite history: hooks re-fire freely by
            # design and the deadline sweep re-runs hourly, so lowering HOMEWORK_FULL from 15
            # to 5 would silently restate awards students had already banked and seen. The
            # models docstring states that invariant; this is what holds it.
            #
            # A changed EVENT is a changed fact (a re-grade moving MID→FULL) and does re-price.
            # A revoked award (points zeroed) is re-priced from the rule when the fact comes
            # back — PRESENT → ABSENT → PRESENT has to restore the 5, not keep the 0.
            if points is not None:
                value = int(points)
            elif existing is not None and existing.event == event and existing.points != 0:
                value = int(existing.points)
            else:
                value = points_for(event)
            if existing is None:
                created = PointAward.objects.create(
                    student=student, season=season, event=event, points=value,
                    xp=constants.xp_for(event, value),
                    classroom=classroom, source_type=source_type, source_id=source_id,
                    idempotency_key=idempotency_key, created_by=actor, note=note,
                )
                PointAwardAudit.objects.create(
                    award=created, previous_points=None, new_points=value,
                    previous_xp=None, new_xp=created.xp,
                    reason=reason or "granted", actor=actor,
                )
                return created

            previous = existing.points
            previous_xp = int(existing.xp)
            # The high-water mark. `max` rather than assignment is the whole of the school's
            # "XP can never be taken away" rule, and it holds against every way an earning can
            # fall: a re-grade dropping HOMEWORK_FULL to HOMEWORK_MID, a PRESENT corrected to
            # LATE, a manual adjustment revised downwards. Each lowers `points` and leaves
            # `xp` untouched. It still climbs freely — ABSENT corrected back to PRESENT, or a
            # re-sit scoring higher, raises both.
            new_xp = max(previous_xp, constants.xp_for(event, value))
            changed = previous != value or existing.event != event or new_xp != previous_xp
            if not changed:
                # The common case on a re-run: a backfill command or a duplicate Celery
                # delivery. Deliberately writes nothing at all, not even an audit row.
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
            return existing
    except Exception:
        logger.exception(
            "reward_award_failed event=%s key=%s student=%s",
            event, idempotency_key, getattr(student, "id", None),
        )
        return None


def revoke(idempotency_key: str, *, reason: str, actor=None) -> bool:
    """Take an award back by zeroing it, keeping the row and its history.

    Used when the fact behind an award is corrected away — a PRESENT flipped to ABSENT after
    the session was finalized, a survey response withdrawn. Deleting the row instead would
    make the student's history silently disagree with their balance.

    ``xp`` is deliberately left standing. This is the sharp end of the school's rule: XP is
    never taken off a student, so the one operation whose whole job is taking an earning back
    must not touch it. The award ends up with 0 points and its XP intact, which is exactly
    what the columns are for — and it is why the audit row records the XP that did *not*
    move, rather than leaving the reader to infer it.
    """
    try:
        with transaction.atomic():
            existing = (
                PointAward.objects.select_for_update()
                .filter(idempotency_key=idempotency_key)
                .first()
            )
            if existing is None or existing.points == 0:
                return False
            previous = existing.points
            existing.points = 0
            existing.save(update_fields=["points", "updated_at"])
            PointAwardAudit.objects.create(
                award=existing, previous_points=previous, new_points=0,
                previous_xp=existing.xp, new_xp=existing.xp,
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
