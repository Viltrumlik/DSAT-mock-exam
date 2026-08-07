"""Homework is scored per **bundle**, not per item.

One ``classes.Assignment`` can carry several contents at once — assessments, a pastpaper,
vocabulary sets, a file to hand in. The school's rule is that the whole homework yields one
percentage and the 15/10/5/0 band applies to that.

The obstacle is that **only assessments carry a percentage**. A pastpaper produces a raw
SAT-ish score (``200 + Σ question.score``), a vocabulary set produces a completion boolean,
and a handed-in file produces nothing at all. Averaging "the percent each was solved at" is
therefore not computable for four of the five kinds. What is computable, and what reproduces
the school's own worked example, is:

    item_percent = the assessment's own percent      for an assessment
                 = 100 if done else 0                for every other kind
    bundle       = mean(item_percent)                not-done counts as 0

Their example: 4 items — 2 assessments, 1 pastpaper, 1 vocabulary set — with 3 done and one
assessment untouched gives ``(100 + 100 + 100 + 0) / 4 = 75%`` → 5 points. If the completed
assessment had scored 60, ``(60 + 100 + 100 + 0) / 4 = 65%`` → still 5 points.

**Item granularity is defined here, not borrowed from ``Assignment.content_count``.** That
property counts display slots for the bundle UI and expands packs pack-by-pack; for points,
"one pastpaper" is one thing a student sits regardless of how many sections it was filed
under. The two numbers answer different questions and are deliberately allowed to differ.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from . import constants
from .services import award, revoke

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BundleItem:
    kind: str
    ref: str
    percent: float


# ── Per-kind resolution ───────────────────────────────────────────────────────

def _assessment_items(assignment, student) -> list[BundleItem]:
    """One item per attached assessment, carrying the student's BEST full-length percent.

    Two guards, both required, and both defending the same hole — assessment attempts are
    unlimited:

      * **best, never latest** — otherwise a deliberate bad retry would lower an award the
        student has already banked;
      * **full-length attempts only** — "retry incorrect only" mints a fresh attempt over a
        *subset* of the questions whose percent is computed over that subset. One remaining
        question answered correctly reads as 100%, which is the single easiest way to farm
        this whole system.
    """
    from assessments.models import AssessmentAttempt, AssessmentResult

    items: list[BundleItem] = []
    for homework in assignment.assessment_homeworks.select_related("assessment_set").all():
        rows = list(
            AssessmentResult.objects.filter(
                attempt__homework=homework,
                attempt__student=student,
                attempt__status=AssessmentAttempt.STATUS_GRADED,
            ).values("percent", "attempt__question_order")
        )

        # "Full length" is measured against the student's OWN longest sitting of this
        # homework, never against the set's live question count.
        #
        # The live count looks like the obvious denominator and is a trap: it moves. A
        # teacher archiving one question of four makes every later attempt pin 3 ids against
        # a count of 4, so every genuine full sitting reads as a re-try and the assessment
        # scores 0 forever. Appending a fifth question does the same to attempts already
        # banked — and because the deadline sweep re-runs hourly, it CONFISCATES points a
        # student had already earned, with no action on their part.
        #
        # Comparing the student's attempts to each other is immune to that. It still does
        # the one job the guard exists for: "retry incorrect only" mints an attempt over a
        # strict subset of the same sitting, so it is always shorter than the full one.
        lengths = [len(r["attempt__question_order"] or []) for r in rows]
        full_length = max(lengths) if lengths else 0

        best = 0.0
        for row in rows:
            answered = row["attempt__question_order"] or []
            # An EMPTY question_order means "not recorded", not "zero questions" — older rows
            # and any path that never pinned an order have it blank. Treating blank as a
            # subset would silently discard a student's only real attempt, so absence of
            # evidence is not taken as evidence of a subset.
            if answered and full_length and len(answered) < full_length:
                continue
            best = max(best, float(row["percent"] or 0))

        items.append(BundleItem("assessment", f"set:{homework.assessment_set_id}", best))
    return items


def _vocab_items(assignment, student) -> list[BundleItem]:
    """One item per attached vocabulary set — completion only, there is no score."""
    items: list[BundleItem] = []
    for link in assignment.vocab_homeworks.select_related("vocab_set").all():
        done = link.vocab_set.is_completed_by(student)
        items.append(BundleItem("vocab", f"vocab:{link.vocab_set_id}", 100.0 if done else 0.0))
    return items


def _sat_content_item(assignment, student) -> BundleItem | None:
    """The pastpaper / mock / practice-test slot, as a single item.

    Counted done only when **every** targeted section has a completed attempt — a student who
    sat Reading but not Maths has not finished the paper. The score is deliberately ignored:
    it is a raw 200-floored total, not a percentage, and SAT performance is already recognised
    by the SAT leaderboard.
    """
    from classes.models import assignment_target_practice_test_ids
    from exams.models import TestAttempt

    target_ids = assignment_target_practice_test_ids(assignment)
    if not target_ids:
        return None

    completed = set(
        TestAttempt.objects.filter(
            student=student,
            practice_test_id__in=target_ids,
            is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED,
        ).values_list("practice_test_id", flat=True)
    )
    done = completed.issuperset(set(target_ids))
    return BundleItem("sat_content", f"tests:{len(target_ids)}", 100.0 if done else 0.0)


def _handin_item(assignment, student) -> BundleItem | None:
    """The file / link slot: one item, done once the student has handed something in.

    Graded-ness is not required. Whether the teacher has marked it yet is the teacher's
    backlog, and a student must not lose points waiting on it.
    """
    from classes.models import Submission

    has_slot = bool(assignment.attachment_file or assignment.external_url)
    if not has_slot:
        try:
            has_slot = assignment.extra_attachments.exists()
        except Exception:
            has_slot = False
    if not has_slot:
        return None

    handed_in = Submission.objects.filter(
        assignment=assignment,
        student=student,
        status__in=(Submission.STATUS_SUBMITTED, Submission.STATUS_REVIEWED),
    ).exists()
    return BundleItem("handin", "file", 100.0 if handed_in else 0.0)


# ── Bundle ────────────────────────────────────────────────────────────────────

def bundle_items(assignment, student) -> list[BundleItem]:
    items = _assessment_items(assignment, student)
    items += _vocab_items(assignment, student)
    for maybe in (_sat_content_item(assignment, student), _handin_item(assignment, student)):
        if maybe is not None:
            items.append(maybe)
    return items


def bundle_percent(assignment, student) -> float | None:
    """The homework's single percentage, or ``None`` when it carries nothing scoreable.

    ``None`` is not zero: an assignment that is only an announcement has nothing to earn from,
    and awarding it 0 would put a "0 points" row in the student's history for work that was
    never set.
    """
    items = bundle_items(assignment, student)
    if not items:
        return None
    return sum(item.percent for item in items) / len(items)


def recompute_bundle(assignment, student, *, actor=None):
    """Settle one student's award for one homework. Safe to call from any item's completion.

    Upserts on ``homework:<assignment_id>:<student_id>`` — so this is not "award once", it is
    "make the award match reality now". Finishing a second item raises it; a re-grade adjusts
    it; falling under 60 revokes it.
    """
    from classes.models import Assignment

    if assignment is None or student is None:
        return None
    # Draft work has not been given to anyone. The academic leaderboard excludes drafts too,
    # and a reward that disagreed with it about what "assigned" means is not defensible.
    #
    # Note this returns rather than revoking, and the asymmetry is deliberate: never-published
    # work earns nothing, but points a student genuinely earned are not confiscated because a
    # teacher later toggled the assignment back to draft.
    if assignment.status == Assignment.STATUS_DRAFT:
        return None

    key = constants.homework_key(assignment.id, student.id)
    percent = bundle_percent(assignment, student)
    event = constants.homework_event_for(percent)

    if event is None:
        # Below 60, or nothing scoreable. Revoke rather than award zero, so a student who
        # dropped below the band does not keep points they no longer qualify for.
        revoke(key, reason="homework below the earning band", actor=actor)
        return None

    return award(
        student,
        event,
        idempotency_key=key,
        classroom=assignment.classroom,
        source_type="assignment",
        source_id=assignment.id,
        actor=actor,
        reason=f"homework {percent:.0f}%",
    )


def recompute_for_students(assignment, students, *, actor=None) -> int:
    """Settle a whole class's awards for one homework. Used by the deadline sweep."""
    settled = 0
    for student in students:
        try:
            recompute_bundle(assignment, student, actor=actor)
            settled += 1
        except Exception:
            logger.exception(
                "reward_homework_recompute_failed assignment=%s student=%s",
                assignment.pk, getattr(student, "id", None),
            )
    return settled
