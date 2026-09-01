"""The reward vocabulary: what can be earned, and what it is worth by default.

Point values here are only the **seed**. The live figure is read from ``RewardRule`` so the
school can retune without a deploy; these constants are what the seeding migration writes and
what a lookup falls back to if a rule row is missing.

One deliberate choice: the event codes are fine-grained (``ATTENDANCE_LATE`` is its own event,
not ``ATTENDANCE`` with a different amount). A coarse code plus a separate amount would make
"why did I get 3?" unanswerable from the ledger alone, and would leave the school unable to
retune late-arrival credit on its own.
"""

from __future__ import annotations

# ── Events ────────────────────────────────────────────────────────────────────

EVENT_ATTENDANCE_PRESENT = "ATTENDANCE_PRESENT"
EVENT_ATTENDANCE_LATE = "ATTENDANCE_LATE"
EVENT_SUPPORT_SESSION = "SUPPORT_SESSION"
EVENT_SURVEY = "SURVEY"
EVENT_MIDTERM_PASS = "MIDTERM_PASS"
EVENT_MIDTERM_RETAKE_PASS = "MIDTERM_RETAKE_PASS"
EVENT_HOMEWORK = "HOMEWORK"             # proportional: max_points × percent / 100
EVENT_CLASSWORK_MANUAL = "CLASSWORK_MANUAL"   # a teacher's hand, amount always explicit
EVENT_MANUAL = "MANUAL"                 # an admin adjustment, amount always explicit

# ── The one event that SPENDS ─────────────────────────────────────────────────
#
# Every other event in this file adds points. This one takes them away, and it is in the same
# table for the same reason a bank statement holds withdrawals next to deposits: the balance
# has to be one SUM over one ledger, or there are two numbers to keep in step and they will
# eventually disagree.
#
# Written ONLY by ``coins.convert`` — never by ``services.award``, which prices an event from
# a ``RewardRule`` and would have to be taught that this one is negative. Its rows always
# carry ``xp=0``: converting is spending, and this school's rule is that XP never falls for
# anything a student does. So a student who cashes in every point keeps their whole XP total
# and their leaderboard position — the board ranks on XP precisely so that spending is not
# punished.
EVENT_COIN_CONVERSION = "COIN_CONVERSION"

# ── Retired: the homework bands ───────────────────────────────────────────────
#
# Homework is paid proportionally now (``EVENT_HOMEWORK``), so nothing new is ever written
# with these three. They stay LEGACY READ-ONLY and must not be deleted: thousands of rows
# already carry them, migration 0002 seeded a ``RewardRule`` for each, and a
# ``PointAward.event`` outside the choice set is a data problem — the admin would render it
# blank and ``get_event_display`` would return the raw code.
EVENT_HOMEWORK_FULL = "HOMEWORK_FULL"   # legacy, 100%
EVENT_HOMEWORK_HIGH = "HOMEWORK_HIGH"   # legacy, 80–99%
EVENT_HOMEWORK_MID = "HOMEWORK_MID"     # legacy, 60–79%

EVENT_CHOICES = [
    (EVENT_ATTENDANCE_PRESENT, "Attended a lesson"),
    (EVENT_ATTENDANCE_LATE, "Attended a lesson (late)"),
    (EVENT_SUPPORT_SESSION, "Support-teacher session held"),
    (EVENT_SURVEY, "Survey completed"),
    (EVENT_MIDTERM_PASS, "Midterm passed"),
    (EVENT_MIDTERM_RETAKE_PASS, "Midterm retake passed"),
    (EVENT_HOMEWORK, "Homework completed"),
    (EVENT_CLASSWORK_MANUAL, "Classwork awarded by a teacher"),
    (EVENT_MANUAL, "Manual adjustment"),
    (EVENT_COIN_CONVERSION, "Turned into coins"),
    # Legacy — kept so historical rows still read. Never awarded.
    #
    # The labels stay as students already know them: these strings are what
    # ``/api/rewards/rules/`` serves to the rewards page, so tagging them "(legacy)" here
    # would put the word in front of a student. Retiring them from that list is a change to
    # the view, not to this table.
    (EVENT_HOMEWORK_FULL, "Homework 100%"),
    (EVENT_HOMEWORK_HIGH, "Homework 80–99%"),
    (EVENT_HOMEWORK_MID, "Homework 60–79%"),
]

ALL_EVENTS = tuple(code for code, _ in EVENT_CHOICES)

# ── Default point values (seed + fallback) ────────────────────────────────────

DEFAULT_POINTS = {
    EVENT_ATTENDANCE_PRESENT: 5,
    EVENT_ATTENDANCE_LATE: 3,
    EVENT_SUPPORT_SESSION: 10,
    EVENT_SURVEY: 40,
    EVENT_MIDTERM_PASS: 20,
    EVENT_MIDTERM_RETAKE_PASS: 5,
    # The MAXIMUM a homework can pay, not a flat rate: the caller scales it by the bundle
    # percentage and passes the result explicitly. 15 keeps a 100% homework worth exactly what
    # HOMEWORK_FULL used to be, so nothing a student already understands changes value.
    EVENT_HOMEWORK: 15,
    EVENT_CLASSWORK_MANUAL: 0,   # the teacher names the amount; see EVENT_MANUAL
    EVENT_MANUAL: 0,        # always passed explicitly; a default would be a footgun
    # Not a price. A conversion's amount is whatever the student chose to spend, negated;
    # this 0 exists only so a lookup by event never misses, and `services.award` must never
    # be handed this event in the first place.
    EVENT_COIN_CONVERSION: 0,
    EVENT_HOMEWORK_FULL: 15,   # legacy — priced only so an old row can still be re-read
    EVENT_HOMEWORK_HIGH: 10,   # legacy
    EVENT_HOMEWORK_MID: 5,     # legacy
}

# ── XP ────────────────────────────────────────────────────────────────────────
#
# XP now follows points everywhere: every event earns XP equal to its point value.
#
# This REVERSES an earlier decision. ATTENDANCE_LATE and SURVEY used to be excluded, on the
# reasoning that turning up late and filling in a form are not evidence of knowing anything,
# and that a 40-point survey would let the highest-XP student be whoever answers the most
# questionnaires. The school overruled it: they want one number a student can see rise from
# everything they do, and they would rather retune SURVEY's price than explain to a student
# why one of their earnings is invisible on the board.
#
# The cost is real and is not hidden: at 40 points a single questionnaire is now worth two
# midterm passes on the XP board — exactly the failure the old exclusion named.
#
# So the exclusion is not deleted, it is MOVED into data. ``RewardRule.grants_xp`` (default
# True) is the same lever as a per-rule flag rather than a constant, which is what lets the
# school put SURVEY back outside XP from the admin instead of from a deploy. This frozenset
# is only the fallback for an event with no *active* rule row.
#
# **2026-09-01 — the school pulled that lever for SURVEY.** They want a survey to pay its
# points and nothing else; the board is for what a student has learned. Migration 0009 sets
# ``grants_xp=False`` on the live rule, which is what actually decides it.
#
# SURVEY is named here as well, and the two are not redundant. Both lookups
# (``services.pricing_for``, ``_rule_grants_xp``) require ``is_active=True``, so deactivating
# the SURVEY rule — a plausible tidy-up, since a survey's price comes from
# ``Survey.points_award`` and never from this row — would drop through to this fallback and
# quietly hand XP back. The data lever still WINS wherever a row is active: an admin who
# ticks ``grants_xp`` back on gets XP again without a deploy, exactly as before.

XP_EXCLUDED_EVENTS = frozenset({EVENT_SURVEY})


def xp_for(event: str, points: int, *, grants_xp: bool | None = None) -> int:
    """What an earning is worth in XP. Its point value, or zero when the rule says no XP.

    ``grants_xp`` is the rule's flag. Callers that have already loaded the ``RewardRule`` pass
    it in — ``services.award`` does, because it reads the price off the same row and looking
    the rule up twice would double the query count on the ledger's hottest path. Left at
    ``None`` the rule is read here, falling back to ``XP_EXCLUDED_EVENTS``.

    Negative points cannot become negative XP: a manual adjustment that docks somebody is a
    points operation, and XP has no downward direction at all (see ``services.award``).
    """
    if grants_xp is None:
        grants_xp = _rule_grants_xp(event)
    if not grants_xp:
        return 0
    return max(0, int(points))


def _rule_grants_xp(event: str) -> bool:
    """Does this event carry XP, per its live rule row? True when there is no row."""
    # Imported inside the function on purpose: ``models`` reads ``EVENT_CHOICES`` from this
    # module, so a top-level import would be a cycle — and this module is otherwise importable
    # without the app registry being ready.
    from .models import RewardRule

    flag = (
        RewardRule.objects.filter(event=event, is_active=True)
        .values_list("grants_xp", flat=True)
        .first()
    )
    if flag is None:
        return event not in XP_EXCLUDED_EVENTS
    return bool(flag)


# ── Coins ─────────────────────────────────────────────────────────────────────

#: Points needed for one coin. Points are a lifetime score; coins are a spendable wallet
#: minted from them. Conversion is a deliberate act by the student — see ``coins.convert``.
DEFAULT_POINTS_PER_COIN = 10


# ── Homework banding (legacy) ─────────────────────────────────────────────────

def homework_event_for(percent) -> str | None:
    """LEGACY. Map a bundle percentage onto its band, or ``None`` when it earns nothing.

    Superseded by proportional payment: ``EVENT_HOMEWORK`` priced at
    ``max_points × percent / 100``, with no 60% floor. Kept only until the last caller is
    gone; do not reach for it in new code.

    ``None`` (not ``EVENT_HOMEWORK_*`` with 0 points) below 60 on purpose: a row worth zero
    still reads as "you were awarded for this", and the school's rule is that under 60 there
    is no award at all. A `None` percent — homework that has not been graded — also earns
    nothing, which is not the same as earning zero.
    """
    if percent is None:
        return None
    value = float(percent)
    if value >= 100:
        return EVENT_HOMEWORK_FULL
    if value >= 80:
        return EVENT_HOMEWORK_HIGH
    if value >= 60:
        return EVENT_HOMEWORK_MID
    return None


# ── Idempotency keys ──────────────────────────────────────────────────────────
#
# Deterministic and derived only from the source row — never from a timestamp, a retry count
# or an attempt id that can be minted more than once for the same earning. Re-running a hook
# must land on the same key so the award is corrected in place instead of duplicated.

def attendance_key(record_id: int) -> str:
    return f"attendance:{record_id}"


def homework_key(assignment_id: int, student_id: int) -> str:
    """Keyed on the *bundle*, not the attempt: assessment attempts are unlimited, so an
    attempt-keyed award would let a student mint points by re-sitting."""
    return f"homework:{assignment_id}:{student_id}"


def classwork_key(assignment_id: int, student_id: int) -> str:
    """One award per (classwork assignment, student), and deliberately not per item.

    The classwork carrier is a single ``classes.Assignment`` per lesson, shared by every
    granted journal item, so there is no per-item row to key on. A teacher paying the same
    lesson twice corrects the amount in place instead of stacking a second earning.
    """
    return f"classwork:{assignment_id}:{student_id}"


def midterm_key(outcome_id: int) -> str:
    return f"midterm:{outcome_id}"


def survey_key(response_id: int) -> str:
    return f"survey:{response_id}"


def support_session_key(session_id: int) -> str:
    return f"support:{session_id}"
