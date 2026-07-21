"""Score interpretation for midterms: normalization, pass marks, and certificate tiers.

ONE module owns every judgement made about a midterm score, because the same judgement is
rendered in five places that must never disagree — the certificate PDF (reportlab), the
certificate PDF (Chromium), the two certificate HTML templates, the React certificate page,
the student result page, and the admin report.

The central idea is ``fraction()``: every score is reduced to the 0..1 share of questions
answered correctly, *independently of the scale it is reported on*. This matters because the
two scales do not share a floor:

    SCALE_100:  0 correct -> 0     all correct -> 100    fraction = score / 100
    SCALE_800:  0 correct -> 200   all correct -> 800    fraction = (score - 200) / 600

A blank SCALE_800 paper scores 200, which is 25% *of the ceiling* but 0% of the work. Any
rule expressed as "percent of ceiling" therefore puts every failing 800-scale student in the
wrong tier — the reason tiers and pass marks are both defined on ``fraction()``.
"""

from __future__ import annotations

from .scoring import SCALE_100, SCALE_800

# ── scale geometry ───────────────────────────────────────────────────────────
# floor = the score a blank paper receives; ceiling = the score a perfect paper receives.
SCALE_BOUNDS = {
    SCALE_100: (0, 100),
    SCALE_800: (200, 800),
}


def scale_bounds(scoring_scale: str) -> tuple[int, int]:
    return SCALE_BOUNDS.get(scoring_scale, SCALE_BOUNDS[SCALE_100])


def fraction(score, scoring_scale: str) -> float:
    """Reduce a reported score to the 0..1 share of questions answered correctly.

    Returns 0.0 for ``None`` so an unscored attempt never accidentally reads as a pass.
    Clamped to 0..1: a migrated legacy score computed under the old per-module SAT cap can
    land marginally outside the current bounds, and no caller wants a negative fraction.
    """
    if score is None:
        return 0.0
    floor, ceiling = scale_bounds(scoring_scale)
    span = ceiling - floor
    if span <= 0:
        return 0.0
    return max(0.0, min(1.0, (float(score) - floor) / span))


def score_for_fraction(frac: float, scoring_scale: str) -> int:
    """Inverse of ``fraction`` — the reported score at a given share of correct answers.

    Used to render a pass mark that was authored as a percentage back onto the midterm's
    own scale, and to seed the default pass mark.
    """
    floor, ceiling = scale_bounds(scoring_scale)
    return int(round(floor + max(0.0, min(1.0, frac)) * (ceiling - floor)))


# ── pass mark ────────────────────────────────────────────────────────────────
# Used when a midterm was authored without an explicit pass mark. Expressed as a fraction
# so both scales stay consistent: 0.50 -> 50/100 and 500/800.
DEFAULT_PASS_FRACTION = 0.50


def default_pass_mark(scoring_scale: str) -> int:
    return score_for_fraction(DEFAULT_PASS_FRACTION, scoring_scale)


def effective_pass_mark(midterm) -> int:
    """The score a student must reach on ``midterm`` to pass, on the midterm's own scale."""
    raw = getattr(midterm, "pass_mark", None)
    if raw is None:
        return default_pass_mark(midterm.scoring_scale)
    return int(raw)


def is_passing(score, midterm) -> bool:
    """Whether ``score`` clears ``midterm``'s pass mark. The pass mark is INCLUSIVE."""
    if score is None:
        return False
    return int(score) >= effective_pass_mark(midterm)


# ── certificate tiers ────────────────────────────────────────────────────────
# The four bands the certificate citation is written for, given as 100-scale numbers by
# product and applied through ``fraction()`` so an 800-scale midterm bands identically.
#
# The stated bands (1-30, 30-50, 50-80, 80+) overlap at their edges; resolved so each
# boundary belongs to the HIGHER band — a student on exactly 50 reads the "developing"
# citation, not the "emerging" one. Bands are half-open: [lo, hi).
TIER_EMERGING = "EMERGING"
TIER_DEVELOPING = "DEVELOPING"
TIER_PROFICIENT = "PROFICIENT"
TIER_DISTINGUISHED = "DISTINGUISHED"

# (tier, lower bound as a fraction) — highest first; the first match wins.
_TIER_FLOORS = (
    (TIER_DISTINGUISHED, 0.80),
    (TIER_PROFICIENT, 0.50),
    (TIER_DEVELOPING, 0.30),
    (TIER_EMERGING, 0.00),
)

# Every string the certificate can carry, in one place.
#
# ``headline`` replaces the fixed "CERTIFICATE OF ACHIEVEMENT" rail wording where a tier
# reads wrong for it, and ``citation`` replaces the fixed "for outstanding performance on
# the MasterSAT <period>" sentence. Both are written to be true at that band AND to leave
# the student with somewhere to go — a certificate a struggling student is ashamed to show
# their family is worse than no certificate, and the platform's language rule is that the
# student UI never punishes (see the growth-oriented language decision).
TIERS = {
    TIER_DISTINGUISHED: {
        "label": "Distinguished",
        "headline": "CERTIFICATE OF ACHIEVEMENT",
        "citation": "for outstanding performance on the MasterSAT {period} {subject} midterm",
        "note": "Among the strongest results in this cohort.",
    },
    TIER_PROFICIENT: {
        "label": "Proficient",
        "headline": "CERTIFICATE OF ACHIEVEMENT",
        "citation": "for solid, consistent work on the MasterSAT {period} {subject} midterm",
        "note": "A dependable foundation — the top band is within reach.",
    },
    TIER_DEVELOPING: {
        "label": "Developing",
        "headline": "CERTIFICATE OF PROGRESS",
        "citation": "for steady progress on the MasterSAT {period} {subject} midterm",
        "note": "Real ground covered. The error report shows exactly where to aim next.",
    },
    TIER_EMERGING: {
        "label": "Emerging",
        "headline": "CERTIFICATE OF PARTICIPATION",
        "citation": "for taking on the MasterSAT {period} {subject} midterm",
        "note": "Every strong score starts from a first honest attempt.",
    },
}


def tier_for(score, scoring_scale: str) -> str:
    frac = fraction(score, scoring_scale)
    for tier, floor in _TIER_FLOORS:
        if frac >= floor:
            return tier
    return TIER_EMERGING


def citation_for(score, scoring_scale: str, *, period: str = "", subject: str = "") -> dict:
    """Resolve the full set of tier-dependent certificate strings for one score.

    ``period`` is the "June 2026"-style month the midterm was sat in and ``subject`` its
    display name; both are interpolated into the citation. Blank values collapse cleanly —
    the sentence is written so a missing period or subject leaves no double space.
    """
    tier = tier_for(score, scoring_scale)
    spec = TIERS[tier]
    citation = spec["citation"].format(period=period or "", subject=subject or "")
    citation = " ".join(citation.split())  # collapse the gap a blank period/subject leaves
    return {
        "tier": tier,
        "tier_label": spec["label"],
        "headline": spec["headline"],
        "citation": citation,
        "note": spec["note"],
    }
