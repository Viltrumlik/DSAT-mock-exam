"""Issuing a pastpaper certificate, and the wording that goes on it.

**Tier bands are borrowed; the sentences are not.** The floors come from
``midterms.outcomes`` unchanged, so the same performance is never praised differently by the
two certificates. The citations are rewritten here because the midterm ones name a midterm —
"for outstanding performance on the MasterSAT June 2026 Math midterm" is simply false on a
pastpaper, and interpolating the word "pastpaper" into a sentence written for something else
reads like it.

The language rule is the school's: a certificate a struggling student is ashamed to show their
family is worse than no certificate. Every band below leaves them somewhere to go, and the
lowest one points at the error report rather than at the score.
"""

from __future__ import annotations

import logging

from django.db import transaction

from midterms.outcomes import (
    TIER_DEVELOPING,
    TIER_DISTINGUISHED,
    TIER_EMERGING,
    TIER_PROFICIENT,
    _TIER_FLOORS,
)

logger = logging.getLogger(__name__)

#: A pastpaper section is scored 200–800. A student who answers nothing still scores 200, so
#: the fraction is taken over the 600-point span, not over 0–800.
SCORE_FLOOR = 200
SCORE_CEILING = 800

PASTPAPER_TIERS = {
    TIER_DISTINGUISHED: {
        "label": "Distinguished",
        "headline": "CERTIFICATE OF ACHIEVEMENT",
        "citation": "for an outstanding result on {paper}",
        "note": "This is the standard the real test asks for.",
    },
    TIER_PROFICIENT: {
        "label": "Proficient",
        "headline": "CERTIFICATE OF ACHIEVEMENT",
        "citation": "for solid, consistent work on {paper}",
        "note": "A dependable score. The report inside shows what stands between you and the top band.",
    },
    TIER_DEVELOPING: {
        "label": "Developing",
        "headline": "CERTIFICATE OF PROGRESS",
        "citation": "for steady progress on {paper}",
        "note": "Real ground covered. The report inside shows exactly where to aim next.",
    },
    TIER_EMERGING: {
        "label": "Emerging",
        "headline": "CERTIFICATE OF PARTICIPATION",
        "citation": "for sitting {paper} in full",
        "note": "Every strong score starts from a first honest attempt. The report inside is where it begins.",
    },
}


def fraction_for(score) -> float:
    """A pastpaper score as a 0..1 share, over the 200–800 span."""
    if score is None:
        return 0.0
    span = SCORE_CEILING - SCORE_FLOOR
    return max(0.0, min(1.0, (float(score) - SCORE_FLOOR) / span))


def tier_info_for(score, *, paper: str = "") -> dict:
    """``{tier, tier_label, headline, citation, note}`` for one pastpaper score."""
    frac = fraction_for(score)
    tier = TIER_EMERGING
    for code, floor in _TIER_FLOORS:
        if frac >= floor:
            tier = code
            break
    spec = PASTPAPER_TIERS[tier]
    # A blank paper title must not leave "for a solid result on ." — collapse it instead.
    subject_phrase = paper.strip() or "this paper"
    return {
        "tier": tier,
        "tier_label": spec["label"],
        "headline": spec["headline"],
        "citation": spec["citation"].format(paper=subject_phrase),
        "note": spec["note"],
    }


def _display_name(user) -> str:
    name = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
    return name or getattr(user, "username", None) or getattr(user, "email", None) or "Student"


def _paper_title(practice_test) -> str:
    """What to call the paper on the certificate.

    `collection_name` is the label the school actually uses ("SAT March 2024"); `title` is
    often blank or an internal string. Prefer the former and fall back rather than printing
    an empty line.
    """
    collection = (getattr(practice_test, "collection_name", "") or "").strip()
    title = (getattr(practice_test, "title", "") or "").strip()
    if collection and title and title.lower() not in collection.lower():
        return f"{collection} · {title}"
    return collection or title or "Past Paper"


def is_eligible(attempt) -> bool:
    """Whether this attempt earns a certificate at all.

    A pastpaper is `PracticeTest` with no `mock_exam` — a mock or midterm section reaches
    this code path through the same model and must not produce a pastpaper certificate for
    what is really one section of a longer exam.
    """
    from exams.models import TestAttempt

    if attempt is None or attempt.practice_test_id is None or attempt.student_id is None:
        return False
    if not (attempt.is_completed and attempt.current_state == TestAttempt.STATE_COMPLETED):
        return False
    if attempt.score is None:
        return False
    return attempt.practice_test.mock_exam_id is None


@transaction.atomic
def issue_for_attempt(attempt, *, force: bool = False):
    """Issue the certificate for one completed pastpaper attempt. Returns it, or ``None``.

    Idempotent on the attempt: re-running returns the existing certificate rather than a
    second one, which is what makes it safe to call from a signal that fires whenever the
    attempt row is touched. ``force`` re-freezes the snapshot from the attempt as it is now —
    the repair path after an answer key is corrected.
    """
    from .models_certificates import PastpaperCertificate
    from .pastpaper_report import build_error_report

    if not is_eligible(attempt):
        return None

    existing = PastpaperCertificate.objects.filter(attempt=attempt).first()
    if existing is not None and not force:
        return existing

    report = build_error_report(attempt)
    practice_test = attempt.practice_test
    values = {
        "student": attempt.student,
        "student_name": _display_name(attempt.student),
        "paper_title": _paper_title(practice_test),
        "collection_name": (getattr(practice_test, "collection_name", "") or "")[:200],
        "subject": getattr(practice_test, "subject", "") or "",
        "score": int(attempt.score or 0),
        "questions_total": report["total"],
        "questions_correct": report["correct"],
    }
    certificate, _created = PastpaperCertificate.objects.update_or_create(
        attempt=attempt, defaults=values
    )
    return certificate


def maybe_issue(attempt) -> None:
    """Signal-safe wrapper: never raises into whatever completed the attempt.

    Same discipline as the reward hooks — a certificate failing to mint must not un-complete
    a paper the student has just sat.
    """
    try:
        issue_for_attempt(attempt)
    except Exception:
        logger.exception("pastpaper_certificate_failed attempt=%s", getattr(attempt, "pk", None))
