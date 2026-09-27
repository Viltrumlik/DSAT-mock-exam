"""One homework, one grade: the auto-graded parts and the teacher's mark, composed.

A homework can carry several contents at once — assessments, vocabulary sets, a past
paper, a file to hand in — and each auto-graded part already records its own score in its
own engine. Nothing ever combined them: ``Assignment.is_multi_content`` says as much in so
many words ("the classroom assignment is NOT auto-finalized into one combined grade"), so
the four-assessments-and-two-word-sets homework the learning center actually sets had no
single number anywhere. This module is that number.

``Assignment.manual_grade_weight_percent`` (``S`` below) is the teacher's answer to "how
much of this grade do I award by hand", asked once, when the homework is created:

    grade = automatic% x (100 - S)/100  +  manual% x S/100

The automatic side is READ, never recomputed. ``rewards.homework.bundle_items`` is already
the one place that knows what each engine recorded for each kind of content — an
assessment's first full-length graded attempt, a vocabulary set's mastered games, whether
every section of a past paper was sat — and re-deriving any of that here would give the
student a grade that disagrees with the points the same work paid them. Read at the same
MOMENT, too: past the deadline the automatic side counts the work that was done by the
deadline, exactly as the ledger settles it, so a sitting five days late does not show 100
on the homework page while the points row for it says 0%.

While the teacher has not entered their mark, the composed grade reports the automatic
part AND that it is not final, as an explicit ``state`` rather than a null the caller has
to interpret. The automatic part is never scaled up to fill the missing manual share: with
S = 20 and 90% automatic the student sees 72, which is the part of their grade that is
settled, and the number can only climb when the teacher marks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.conf import settings

logger = logging.getLogger(__name__)


# ── States ────────────────────────────────────────────────────────────────────
# Every answer this module can give has a name. A caller never has to work out what a
# null percent meant, and "we could not read it" is never confused with "no grade yet".

#: ``manual_grade_weight_percent`` is NULL — no manual component was asked for. Nothing is
#: composed and the caller reads the grade exactly as it did before this field existed.
STATE_NO_MANUAL_COMPONENT = "no_manual_component"

#: A manual share was asked for and the teacher has not entered their mark. ``percent``
#: holds the automatic part, already weighted; the student is told their teacher is still
#: checking.
STATE_AWAITING_MANUAL = "awaiting_manual_mark"

#: The number cannot move any more.
STATE_FINAL = "final"

#: The composition could not be read at all. This is an ERROR, not "ungraded" — a caller
#: that renders it as "no grade yet" is telling the student something untrue.
STATE_UNAVAILABLE = "unavailable"

#: ``rewards.homework`` labels the hand-in slot with this kind. See ``_automatic_percent``.
_HANDIN_KIND = "handin"


@dataclass(frozen=True)
class ComposedGrade:
    """One student's grade for one homework.

    ``manual_weight`` and ``automatic_weight`` are the weights that were ACTUALLY applied,
    which is not always what the teacher typed — see the no-automatic-content case in
    :func:`compose_assignment_grade`. They always sum to 100.
    """

    state: str
    #: The one number to show, 0-100, already weighted. ``None`` when there is nothing to
    #: show yet: no manual component was configured, or the only thing settled so far
    #: carries no weight (S = 100 before the teacher marks).
    percent: float | None
    #: The auto-graded parts on their own 0-100 scale. ``None`` when the homework carries
    #: nothing auto-graded — which is not the same as zero, and is never rendered as zero.
    automatic_percent: float | None
    #: The teacher's mark on its own 0-100 scale, or ``None`` until they enter it.
    manual_percent: float | None
    manual_weight: int
    automatic_weight: int

    @property
    def is_final(self) -> bool:
        return self.state == STATE_FINAL

    def as_payload(self) -> dict:
        return {
            "state": self.state,
            "percent": self.percent,
            "is_final": self.is_final,
            "automatic_percent": self.automatic_percent,
            "manual_percent": self.manual_percent,
            "manual_weight_percent": self.manual_weight,
            "automatic_weight_percent": self.automatic_weight,
        }


def _clamp_percent(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def _settlement_cutoff(assignment):
    """The moment the automatic side stops moving, read the way the ledger reads it.

    ``rewards.homework.recompute_bundle`` scores live until the deadline and as of the
    deadline after it, and ``_scoring_cutoff`` is what decides a deadline falling at or
    before the homework was set is no deadline at all. Reading that helper rather than
    re-deriving the rule here is the whole point: a second copy of "what counts as late"
    would drift from the ledger's, and a grade that disagrees with the points the same work
    paid is precisely what this module exists to prevent. It is private by name only — the
    alternative is a third reading of the deadline, not a cleaner one.
    """
    from django.utils import timezone

    from rewards.homework import _scoring_cutoff

    due_at = _scoring_cutoff(assignment, getattr(assignment, "due_at", None))
    past_due = due_at is not None and timezone.now() > due_at
    return due_at if past_due else None


def _automatic_percent(assignment, student) -> float | None:
    """What the engines already recorded for this homework, as one 0-100 percent.

    ``None`` means the homework carries nothing auto-graded. That is not zero: a homework
    that is only a worksheet has nothing to measure automatically, and scoring it 0 would
    mark a student down for work that was never set. ``rewards.homework.bundle_percent``
    refuses to turn the same absence into a zero for exactly this reason.

    The hand-in slot is dropped. ``rewards.homework`` scores it 100 the moment a student
    uploads anything, deliberately, so that points never wait on a teacher's backlog — but
    that slot is precisely what the teacher is marking here. Counting it on the automatic
    side would pay the student full marks for the manual work twice: once for uploading it
    and again when it is marked.

    Past the deadline the work counted is the work that was done by the deadline, exactly
    as the points ledger settles it — otherwise a student who sat the quiz five days late
    would read 100 on their homework page while their points row records 0%.
    """
    from rewards.homework import bundle_items

    as_of = _settlement_cutoff(assignment)
    items = [item for item in bundle_items(assignment, student, as_of) if item.kind != _HANDIN_KIND]
    if not items:
        return None
    total_weight = sum(item.weight for item in items)
    if total_weight <= 0:
        # Weights are data and data can be wrong; a bundle with no divisible whole has
        # nothing scoreable rather than a score of zero.
        return None
    return _clamp_percent(sum(item.percent * item.weight for item in items) / total_weight)


def _manual_mark_percent(assignment, student, submission=None) -> float | None:
    """The teacher's own mark as a 0-100 percent, or ``None`` until they enter one.

    A HUMAN's mark: ``SubmissionReview.is_auto`` tells the two apart, and the auto-grading
    paths set it True on every row they write. A review that carries only feedback and no
    grade is not a mark — the teacher opened the work and has not scored it yet.
    """
    from .models import SubmissionReview

    review = None
    if submission is not None:
        # Every caller of this module already selects the review with the submission, so
        # reading it off the row it came with keeps a class-sized grading list from firing
        # one extra query per student.
        review = getattr(submission, "review", None)
    else:
        review = (
            SubmissionReview.objects.filter(
                submission__assignment=assignment, submission__student=student
            )
            .select_related("submission__assignment")
            .first()
        )
    if review is None or review.is_auto or review.grade is None:
        return None

    ceiling = review.max_score or getattr(assignment, "max_score", None)
    if not ceiling or float(ceiling) <= 0:
        # Neither the row nor the homework says what the mark was out of. The grading
        # endpoint already refuses anything outside CLASSROOM_SUBMISSION_GRADE_MIN..MAX
        # (0-100 by default), so that configured range IS the scale the teacher typed on —
        # reading it beats inventing a denominator, and beats dropping a mark that plainly
        # exists on the floor.
        ceiling = float(getattr(settings, "CLASSROOM_SUBMISSION_GRADE_MAX", 100) or 100)
    return _clamp_percent(100.0 * float(review.grade) / float(ceiling))


def compose_assignment_grade(assignment, student, *, submission=None) -> ComposedGrade:
    """Compose one student's grade for one homework. The single place this arithmetic lives.

    ``submission`` is the student's row when the caller already has it, purely to save a
    query; the answer is the same without it.
    """
    configured = getattr(assignment, "manual_grade_weight_percent", None)
    if configured is None:
        # Today's behaviour, unchanged: nothing is composed, and the caller reads the
        # existing review. Returning the automatic percent here instead would hand every
        # homework ever set a new grade it never had.
        return ComposedGrade(
            state=STATE_NO_MANUAL_COMPONENT,
            percent=None,
            automatic_percent=None,
            manual_percent=None,
            manual_weight=0,
            automatic_weight=100,
        )

    manual_weight = int(configured)
    if not 0 <= manual_weight <= 100:
        # The field is validated on the way in, but rows can be edited in a shell and this
        # function must not produce a percentage over 100 because one of them was.
        logger.warning(
            "manual_grade_weight_percent out of range assignment_id=%s value=%s",
            getattr(assignment, "pk", None),
            configured,
        )
        manual_weight = max(0, min(100, manual_weight))
    automatic_weight = 100 - manual_weight

    automatic_percent = _automatic_percent(assignment, student)

    if automatic_percent is None and 0 < manual_weight < 100:
        # A homework with nothing auto-graded and a manual share below 100 is a
        # contradiction: the teacher has reserved part of the grade for a machine that has
        # nothing to mark. The form is meant to prevent it, but a draft edited after the
        # auto-graded content was detached arrives here anyway, so this decides it rather
        # than leaving the arithmetic to guess.
        #
        # The teacher's mark takes the whole grade. The two alternatives both punish
        # somebody for the teacher's slip: scoring the absent automatic side 0 marks the
        # student down for work that was never set, and leaving its share empty caps the
        # grade below 100 with no way for anyone to reach it.
        logger.info(
            "manual share on a homework with nothing auto-graded; the mark takes the whole "
            "grade assignment_id=%s configured_share=%s",
            getattr(assignment, "pk", None),
            manual_weight,
        )
        manual_weight, automatic_weight = 100, 0

    manual_percent = _manual_mark_percent(assignment, student, submission=submission)

    # Only the sides that carry weight AND have a number behind them. The denominator is
    # always 100, never the weight that happens to be settled: dividing by the settled
    # weight is exactly the "scale the automatic part up to 100%" the owner ruled out.
    parts: list[tuple[float, int]] = []
    if automatic_weight and automatic_percent is not None:
        parts.append((automatic_percent, automatic_weight))
    if manual_weight and manual_percent is not None:
        parts.append((manual_percent, manual_weight))
    percent = None
    if parts:
        percent = round(sum(value * weight for value, weight in parts) / 100.0, 2)

    # A mark is awaited only while it can still move the number. With a manual weight of 0
    # the teacher asked for a review that carries none, so the grade is already whatever it
    # will be; that the review is still owed is the grading queue's business, not this
    # number's.
    awaiting = manual_weight > 0 and manual_percent is None

    return ComposedGrade(
        state=STATE_AWAITING_MANUAL if awaiting else STATE_FINAL,
        percent=percent,
        automatic_percent=None if automatic_percent is None else round(automatic_percent, 2),
        manual_percent=None if manual_percent is None else round(manual_percent, 2),
        manual_weight=manual_weight,
        automatic_weight=automatic_weight,
    )


def composed_grade_payload(submission) -> dict | None:
    """The serializer's view of :func:`compose_assignment_grade`, for one submission row."""
    return composed_grade_payload_for(
        getattr(submission, "assignment", None),
        getattr(submission, "student", None),
        submission=submission,
    )


def composed_grade_payload_for(assignment, student, *, submission=None) -> dict | None:
    """The API's view of :func:`compose_assignment_grade`, with or without a submission row.

    ``None`` when the homework has no manual component — the key is then present and null
    rather than absent, so a client never has to tell "this homework does not compose" from
    "this response forgot to say".

    Taking the assignment and student rather than only a ``Submission`` is what lets the
    student see their grade BEFORE they hand anything in. Vocabulary sets mastered on Monday
    settle the automatic side immediately; the upload slot may not be used until Friday, and
    until it is there is no ``Submission`` row at all. Serving the composition only off that
    row would hide a settled 80-of-100 — and the "your teacher is still checking" line that
    explains it — for the whole week.

    A failure is reported as :data:`STATE_UNAVAILABLE`, never swallowed into a null: one
    student's odd data must not 500 a whole class's grading list, and it must not quietly
    render as "not graded yet" either.
    """
    if assignment is None or student is None:
        return None
    if getattr(assignment, "manual_grade_weight_percent", None) is None:
        return None
    try:
        return compose_assignment_grade(assignment, student, submission=submission).as_payload()
    except Exception:
        logger.exception(
            "composed grade failed assignment_id=%s student_id=%s",
            getattr(assignment, "pk", None),
            getattr(student, "pk", None),
        )
        return ComposedGrade(
            state=STATE_UNAVAILABLE,
            percent=None,
            automatic_percent=None,
            manual_percent=None,
            manual_weight=int(getattr(assignment, "manual_grade_weight_percent", 0) or 0),
            automatic_weight=100 - int(getattr(assignment, "manual_grade_weight_percent", 0) or 0),
        ).as_payload()
