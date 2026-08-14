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
EVENT_HOMEWORK_FULL = "HOMEWORK_FULL"   # 100%
EVENT_HOMEWORK_HIGH = "HOMEWORK_HIGH"   # 80–99%
EVENT_HOMEWORK_MID = "HOMEWORK_MID"     # 60–79%
EVENT_MANUAL = "MANUAL"                 # an admin adjustment, amount always explicit

EVENT_CHOICES = [
    (EVENT_ATTENDANCE_PRESENT, "Attended a lesson"),
    (EVENT_ATTENDANCE_LATE, "Attended a lesson (late)"),
    (EVENT_SUPPORT_SESSION, "Support-teacher session held"),
    (EVENT_SURVEY, "Survey completed"),
    (EVENT_MIDTERM_PASS, "Midterm passed"),
    (EVENT_MIDTERM_RETAKE_PASS, "Midterm retake passed"),
    (EVENT_HOMEWORK_FULL, "Homework 100%"),
    (EVENT_HOMEWORK_HIGH, "Homework 80–99%"),
    (EVENT_HOMEWORK_MID, "Homework 60–79%"),
    (EVENT_MANUAL, "Manual adjustment"),
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
    EVENT_HOMEWORK_FULL: 15,
    EVENT_HOMEWORK_HIGH: 10,
    EVENT_HOMEWORK_MID: 5,
    EVENT_MANUAL: 0,        # always passed explicitly; a default would be a footgun
}

# ── XP ────────────────────────────────────────────────────────────────────────
#
# XP is the school's read on how much a student actually *knows*, and it is deliberately a
# narrower thing than points. Two events earn points but no XP:
#
#   ATTENDANCE_LATE — turning up late is worth encouraging, so it still earns points and
#                     still keeps a strike. It is not evidence of knowing anything.
#   SURVEY          — filling in a form is a favour to the school, not a demonstration of
#                     learning, and at 40 points it is by far the biggest single earning on
#                     the platform. Letting it into XP would let the highest-XP student be
#                     whoever answers the most questionnaires.
#
# Everything else earns XP equal to its point value. They are the same arithmetic on a
# smaller set of events, which is the whole reason XP needs no rule table of its own.

XP_EXCLUDED_EVENTS = frozenset({EVENT_ATTENDANCE_LATE, EVENT_SURVEY})


def xp_for(event: str, points: int) -> int:
    """What an earning is worth in XP. Zero for the excluded events, its point value otherwise.

    Negative points cannot become negative XP: a manual adjustment that docks somebody is a
    points operation, and XP has no downward direction at all (see ``services.award``).
    """
    if event in XP_EXCLUDED_EVENTS:
        return 0
    return max(0, int(points))


# ── Coins ─────────────────────────────────────────────────────────────────────

#: Points needed for one coin. Points are a lifetime score; coins are a spendable wallet
#: minted from them. Conversion is a deliberate act by the student — see ``coins.convert``.
DEFAULT_POINTS_PER_COIN = 10


# ── Homework banding ──────────────────────────────────────────────────────────

def homework_event_for(percent) -> str | None:
    """Map a bundle percentage onto its band, or ``None`` when it earns nothing.

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


def midterm_key(outcome_id: int) -> str:
    return f"midterm:{outcome_id}"


def survey_key(response_id: int) -> str:
    return f"survey:{response_id}"


def support_session_key(session_id: int) -> str:
    return f"support:{session_id}"
