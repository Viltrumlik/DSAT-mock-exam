"""Homework is scored per **bundle**, not per item.

One ``classes.Assignment`` can carry several contents at once — assessments, a pastpaper,
vocabulary sets, a file to hand in. The school's rule is that the whole homework yields one
percentage, and that percentage is what it pays: ``EVENT_HOMEWORK`` priced at
``max_points × percent / 100``. No 60% floor, no 15/10/5 bands — "at the deadline, whatever
percent they reached is what they get".

The percentage is a **weighted mean over the items**, each item carrying its own achieved
percent rather than a 0-or-100 boolean:

    percent = Σ(item.percent × item.weight) / Σ(item.weight)

Every weight is ``1.0`` today, so N items each take a ``100/N`` share and the school's worked
example falls straight out: an assessment scored 95 alongside one vocabulary set gives
``47.5 + 50 = 97.5%``. ``weight`` is a field on the item because the requirement is that the
split be flexible — a teacher saying "the assessment is worth 70% of this homework" then
becomes a data change rather than a rewrite of this module.

Per kind:

    assessment   the FIRST full-length graded attempt's percent   (§3 — retries do not count)
    vocabulary   per-game accuracy discounted by coverage         (§4)
    SAT content  100 if every targeted section was sat, else 0
    hand-in      100 once something was handed in, else 0

The last two stay binary deliberately. A pastpaper's score is a 200-floored SAT scale with no
stored denominator, so there is no percentage to read without re-checking every answer on a
path that runs on every save; and a hand-in has no grade at all until a teacher marks it,
which means scoring it would make a student's points hostage to their teacher's backlog.

**Item granularity is defined here, not borrowed from ``Assignment.content_count``.** That
property counts display slots for the bundle UI and expands packs pack-by-pack; for points,
"one pastpaper" is one thing a student sits regardless of how many sections it was filed
under. The two numbers answer different questions and are deliberately allowed to differ.

**One rule governs every denominator in this module: an input a teacher can edit after the
homework was settled must never be able to LOWER a percent.** The deadline sweep re-runs every
ten minutes for seven days, so any number that can move downward is not a stale display value,
it is a confiscation that happens on its own with no action by the student — and because XP is
a high-water mark while points are not, the ledger ends up internally inconsistent as well.
Each of the four kinds therefore measures itself against the content **as the student met it**
(the set's size when they played it, the attempts that existed when they sat, the targets that
existed when the window closed) rather than against the content as it stands now. Where that
history cannot be reconstructed, the fallback is chosen to err upwards; a percent that is too
generous is a rounding argument, a percent that falls is a student losing banked points.
"""

from __future__ import annotations

import logging
from bisect import bisect_right
from dataclasses import dataclass

from django.utils import timezone

from . import constants
from .services import award, points_for, revoke

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BundleItem:
    kind: str
    ref: str
    percent: float
    #: This item's share of the bundle. Uniform today; the hook for a per-item split the
    #: school can set later without this file changing.
    weight: float = 1.0


# ── Per-kind resolution ───────────────────────────────────────────────────────

def _assessment_items(assignment, student, as_of=None) -> list[BundleItem]:
    """One item per attached assessment, carrying the student's FIRST full-length percent.

    **First, not best**, ordered by ``(started_at, id)`` — ``id`` because ``started_at`` is a
    plain ``default=timezone.now``, not ``auto_now_add``, so two attempts can share it and
    only the id is strictly monotonic.

    This inverts the anti-farming rule this function used to carry ("best, never latest", so
    that a deliberately bad retry could not lower an award a student had already banked). The
    school asked for it in those words: a retry does not count. The cost is stated rather than
    papered over — a student whose first sitting went badly can no longer raise their homework
    points by re-sitting.

    The full-length guard below is unchanged in purpose and still required: attempts are
    unlimited, and "retry incorrect only" mints a fresh attempt over a *subset* of the questions
    whose percent is computed over that subset, so one remaining question answered correctly
    reads as 100%.
    """
    from django.db.models.functions import Coalesce

    from assessments.models import AssessmentAttempt

    # What counts as a sitting for the purpose of measuring length. An IN_PROGRESS or
    # ABANDONED attempt pins a question_order the moment it opens, so counting it would let a
    # student who opened the paper and walked away set a yardstick no later sitting of a
    # since-shortened set could reach — the archived-question trap again, from the other side.
    # SUBMITTED is included because that is exactly the sitting whose grading failed.
    sitting_statuses = (AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED)

    since = _assigned_at(assignment)
    items: list[BundleItem] = []
    for homework in assignment.assessment_homeworks.select_related("assessment_set").all():
        # Every attempt in the window, not only the graded ones, because the length guard
        # below has to see sittings that never produced a result. The known hole is a first
        # sitting that ends SUBMITTED with grading failed: reading lengths off
        # ``AssessmentResult`` alone leaves only the retries visible, the shortest of them
        # becomes the yardstick, and a genuine full sitting can never be recognised again.
        qs = AssessmentAttempt.objects.filter(
            homework=homework, student=student,
        ).annotate(
            # When the sitting was handed in. ``submitted_at`` is nullable — an attempt
            # force-graded by ops never went through a submit step — and a sitting that was
            # never submitted still happened when it started, so absence falls back rather
            # than dropping the attempt out of the window entirely.
            done_at=Coalesce("submitted_at", "started_at"),
        ).filter(done_at__gte=since)
        if as_of is not None:
            qs = qs.filter(done_at__lte=as_of)
        rows = list(
            qs.order_by("started_at", "id")
            .values("status", "question_order", "result__percent")
        )

        # "Full length" is measured against the student's own EARLIER sittings of this
        # homework — never against the set's live question count, and never against attempts
        # that came afterwards.
        #
        # The live count looks like the obvious denominator and is a trap: it moves. A
        # teacher archiving one question of four makes every later attempt pin 3 ids against
        # a count of 4, so every genuine full sitting reads as a re-try and the assessment
        # scores 0 forever.
        #
        # Taking the maximum over ALL of the student's attempts is the same trap one step
        # removed, and it was live: append a fifth question, let the student re-sit, and the
        # banked four-question sitting is suddenly shorter than the maximum, is dropped as a
        # "subset retry", and the re-sit becomes the score. A student lost 12 of 15 points for
        # doing extra work. A "retry incorrect only" attempt is by construction a subset of a
        # sitting that came BEFORE it, so a later attempt can never be evidence that an
        # earlier one was a retry. Hence a running maximum rather than a global one: the
        # earliest attempt always qualifies (it cannot be a retry of something that does not
        # exist yet) and a real subset retry is still skipped, because the full sitting it
        # retries is inside its own window.
        full_length = 0
        percent = 0.0
        for row in rows:
            answered = row["question_order"] or []
            if row["status"] in sitting_statuses:
                full_length = max(full_length, len(answered))
            if row["status"] != AssessmentAttempt.STATUS_GRADED:
                continue
            if row["result__percent"] is None:
                # GRADED with no result row is a half-written grading, not a sitting worth 0.
                continue
            # An EMPTY question_order means "not recorded", not "zero questions" — older rows
            # and any path that never pinned an order have it blank. Treating blank as a
            # subset would silently discard a student's only real attempt, so absence of
            # evidence is not taken as evidence of a subset.
            if answered and full_length and len(answered) < full_length:
                continue
            percent = float(row["result__percent"] or 0)
            break

        items.append(BundleItem("assessment", f"set:{homework.assessment_set_id}", percent))
    return items


def _assigned_at(assignment):
    """The floor for "did the student do this FOR this homework".

    Pastpapers and vocabulary sets are shared library content: the same paper is set for
    revision weeks later, and the same vocab set is given to a second class. Without a floor,
    last term's completion satisfies this term's homework and the student is paid full marks
    for an assignment they never opened.

    Assessments are floored by it too, even though an attempt is bound to a ``HomeworkAssignment``
    that cannot predate its own assignment. Cheap, and it makes all four kinds answer the
    question the same way instead of one of them being the exception nobody remembers.
    """
    return assignment.created_at


def _scoring_cutoff(assignment, as_of):
    """The ``as_of`` cutoff, or ``None`` when it cannot bound a window any work could fit in.

    Every kind is scored over the interval ``[created_at, as_of]``. If ``as_of`` is at or before
    ``created_at`` that interval is empty or inverted, and scoring it settles the whole class at
    0% for work they were never given a moment to do.

    This is not hypothetical. ``journals.delivery`` mints a homework carrier whose ``due_at`` is
    derived from the LESSON'S PLANNED DATE — deliberately, so releasing lesson 5 a week late
    does not shorten its deadline to the next lesson after today — and it never floors at now.
    A class running behind schedule therefore gets an Assignment that is already overdue the
    instant it is created, ``due_at`` BEFORE ``created_at``. The past-dated deadline predates
    this overhaul and was harmless until the cutoff existed to act on it.

    A deadline that cannot contain any work is not a deadline, so the assignment is scored live
    instead. Clamping ``as_of`` up to ``created_at`` is the obvious alternative and is wrong for
    the same reason: the window is still empty and everyone is still paid 0. Fixing the mint
    site instead of here is also not enough — it is another owner's file, and every carrier
    already minted would keep paying zero.
    """
    if as_of is None or as_of > _assigned_at(assignment):
        return as_of
    return None


def _vocab_items(assignment, student, as_of=None) -> list[BundleItem]:
    """One item per attached vocabulary set, scored **per game**.

        set_percent  = Σ over the four modes of game_percent / 4
        game_percent = accuracy × coverage   (0 for a mode never completed)

    So each of flashcard / matching / speed / test is a quarter of the set, and skipping one
    costs a quarter of it.

    **Coverage is not a refinement of accuracy, it is what makes accuracy mean anything.**
    Raw accuracy is not comparable across the four games and is farmable in seconds: Speed
    only ever reports the prompts answered before its 60-second clock expires, so two of
    twenty words answered correctly stores ``accuracy = 100``. See ``VocabStudySession.coverage``.

    The FIRST completed session per (set, mode) counts, matching the assessment rule — a
    replay mints a new row, and a re-run is practice, not a second earning.
    """
    from django.db.models import Q

    from vocabulary.models import VocabSetItem, VocabStudySession

    links = list(assignment.vocab_homeworks.select_related("vocab_set").all())
    if not links:
        return []

    # One query for every set's membership, carrying the timestamps rather than just a count
    # (which is all ``serializers.set_word_counts`` returns). Coverage has to divide by how big
    # the set was when the student played it, and a bare count only knows how big it is now —
    # see ``_set_size_when_played``.
    added_at: dict[int, list] = {}
    for set_id, created in (
        VocabSetItem.objects.filter(vocab_set_id__in=[link.vocab_set_id for link in links])
        .values_list("vocab_set_id", "created_at")
    ):
        added_at.setdefault(set_id, []).append(created)
    for times in added_at.values():
        times.sort()

    modes = [code for code, _ in VocabStudySession.MODE_CHOICES]
    since = _assigned_at(assignment)

    items: list[BundleItem] = []
    for link in links:
        times = added_at.get(link.vocab_set_id) or []
        if not times:
            # A set with no words in it is not work. Every mode's percent divides by the set's
            # size, so an empty set scores 0 in all four for ever with nothing the student can
            # do about it — it would sit in the bundle's denominator permanently capping the
            # homework. Dropping it out is the answer this module already gives an
            # announcement-only assignment: nothing scoreable, rather than scored zero.
            continue

        # Matched on the student, the SET and the CLASSROOM — never on the exact
        # ``VocabStudySession.homework`` row.
        #
        # That FK looks like the precise binding and is unreliable by construction. When the
        # client does not say what it launched from, ``vocabulary.views_student._bind_homework``
        # GUESSES: the newest live VocabHomework for that set across every classroom the student
        # is in. Filtering on the guess was MEASURED to pay the wrong assignment outright — one
        # set on two published assignments in ONE classroom scored 0% and 100% where both were
        # owed 100%, because the guess can only ever name one of them. Two assignments inside one
        # classroom both being credited is therefore intended and must stay that way; the time
        # floor above is what keeps other terms' work out.
        #
        # But dropping the FK from the match entirely re-opened a cross-class leak: a student in
        # class A and class B where both set the same vocabulary set had class B's run credited
        # to class A's homework as well. So the match asks the FK the weaker question it can
        # actually answer — not "is this the right LINK", only "is this the right CLASSROOM",
        # which the guess does satisfy for a student enrolled in one class, since every link it
        # can pick belongs to that one classroom.
        #
        # A NULL ``homework`` is accepted: that is self-study — the student opened the set from
        # the library rather than from the homework card — and it belongs to nobody else. It is
        # also the historic permissive case, and refusing it would confiscate points from every
        # student who studies that way.
        #
        # **Still approximate, stated rather than papered over.** For a student enrolled in TWO
        # classes that both carry the set, the guess names one classroom's link and the other
        # classroom's homework reads that run as another class's work and scores it 0. The exact
        # fix is not available here: it is the client passing the assignment it launched from,
        # which ``SessionCreateView`` now accepts (``assignment_id`` / ``homework_id``, each
        # re-resolved against the student's own live memberships) and which turns the binding
        # from a guess into a fact. Until every mode sends it, this errs toward crediting a
        # class the work may not have been done for, because paying a student 0% for work they
        # demonstrably did is the worse of the two failures — and under a sweep that re-runs
        # every ten minutes for seven days it is a confiscation, not a display glitch.
        #
        # ``assignment.classroom_id`` and not ``link.classroom_id``: the assignment is what the
        # award is written against (``recompute_bundle`` passes ``classroom=assignment.classroom``),
        # so a link whose own classroom column disagrees with its assignment's must not be able to
        # widen what this homework will accept.
        #
        # (This narrows OVERHAUL §9's "match on the FK" item rather than implementing it. The FK
        # is being repaired separately, at the write site; nothing here may lean on it being
        # exact.)
        qs = VocabStudySession.objects.filter(
            user=student,
            vocab_set_id=link.vocab_set_id,
            completed_at__isnull=False,
            # Deliberately not `VocabSet.is_completed_by`: that has no notion of when, so it
            # would count a set the student finished last term.
            completed_at__gte=since,
        ).filter(
            Q(homework__isnull=True) | Q(homework__classroom_id=assignment.classroom_id)
        ).exclude(
            # A run that answered nothing is not a sitting. Speed auto-finishes when its 60s
            # clock expires, so a round the student never played still writes a completed row —
            # and since the FIRST completed run per mode is the one that scores, that row would
            # become a permanent, unimprovable 0 for a quarter of the set. Same principle as
            # the assessment rule: an attempt that recorded nothing is not "the first attempt".
            total_count=0
        )
        if as_of is not None:
            qs = qs.filter(completed_at__lte=as_of)

        first_by_mode: dict[str, VocabStudySession] = {}
        for session in qs.order_by("completed_at", "id"):
            first_by_mode.setdefault(session.mode, session)

        earned = 0.0
        for mode in modes:
            session = first_by_mode.get(mode)
            if session is not None:
                earned += session.scaled_accuracy(_set_size_when_played(times, session))
        # Divided by the number of modes the model declares, not by a literal 4: adding a
        # fifth game would then re-split the set instead of letting a student reach 125%.
        items.append(
            BundleItem("vocab", f"vocab:{link.vocab_set_id}", earned / len(modes))
        )
    return items


def _set_size_when_played(added_at, session) -> int:
    """Coverage's denominator: how many words the set held when this run finished.

    The set's LIVE word count is the obvious denominator and is the same trap the assessment
    length guard exists to avoid — it moves, and only ever in the direction that costs the
    student. Appending one word to a three-word set divides an already-finished perfect run by
    four: the run reads as 75% coverage, and the deadline sweep re-prices the homework downward
    every ten minutes for a week for work the student cannot redo. (The builder blocks REMOVING
    a word from a live homework set and permits adding one, so this is the unguarded direction.)

    Counting only the words already in the set when the run finished cannot move that way.
    Adding a word later does not change how many were there at the time; deleting one only
    makes the denominator smaller, which raises coverage, and ``VocabStudySession.coverage``
    caps it at 1.0.

    Floored by the run's own ``distinct_words`` for the case the timestamps cannot describe:
    set membership can be REPLACED wholesale, leaving every surviving row newer than the run and
    the historical count at zero. A run cannot have answered more words than the set contained,
    so its own distinct count is a sound lower bound — generous where the history was destroyed,
    which is the correct direction to err.
    """
    return max(bisect_right(added_at, session.completed_at), session.distinct_words)


def _sat_content_item(assignment, student, as_of=None) -> BundleItem | None:
    """The pastpaper / mock / practice-test slot, as a single item.

    Counted done only when **every** targeted section has a completed attempt — a student who
    sat Reading but not Maths has not finished the paper. The score is deliberately ignored:
    it is a raw 200-floored total, not a percentage, and SAT performance is already recognised
    by the SAT leaderboard.
    """
    from classes.models import assignment_target_practice_test_ids
    from exams.models import PracticeTest, TestAttempt

    target_ids = assignment_target_practice_test_ids(assignment)
    if target_ids and as_of is not None:
        # The numerator is frozen at the cutoff while the target list is read LIVE off the
        # assignment, so widening it after the deadline flips a settled 100 to a 0 that the
        # sweep then re-prices for seven days. A paper that did not exist when the window
        # closed cannot be part of what the student owed, so it is dropped from the
        # requirement — and a student can never lose by it, because an attempt cannot have been
        # completed on a test that did not exist yet.
        #
        # Sound but not complete, and reported rather than papered over: attaching a paper that
        # was ALREADY in the library still widens the requirement after the fact. Closing that
        # needs the target list itself to carry when each entry was attached, which is a schema
        # change on ``classes.Assignment`` rather than something this module can infer —
        # ``practice_test_ids`` is a bare JSON list of ids with no history at all.
        target_ids = list(
            PracticeTest.objects.filter(pk__in=target_ids, created_at__lte=as_of)
            .values_list("id", flat=True)
        )
    if not target_ids:
        return None

    qs = TestAttempt.objects.filter(
        student=student,
        practice_test_id__in=target_ids,
        is_completed=True,
        current_state=TestAttempt.STATE_COMPLETED,
        # Only sittings from after this homework was set. The same paper is routinely
        # re-assigned for revision, and without this the student is paid again for a paper
        # they sat weeks ago without opening the new assignment.
        completed_at__gte=_assigned_at(assignment),
    )
    if as_of is not None:
        qs = qs.filter(completed_at__lte=as_of)
    completed = set(qs.values_list("practice_test_id", flat=True))
    done = completed.issuperset(set(target_ids))
    return BundleItem("sat_content", f"tests:{len(target_ids)}", 100.0 if done else 0.0)


def _handin_item(assignment, student, as_of=None) -> BundleItem | None:
    """The file / link slot: one item, done once the student has handed something in.

    Graded-ness is not required. Whether the teacher has marked it yet is the teacher's
    backlog, and a student must not lose points waiting on it.
    """
    from django.db.models.functions import Coalesce

    from classes.models import Submission

    # ``allow_file_upload`` is the flag that actually opens the upload box, and it was never
    # consulted here: an upload-only homework — no worksheet attached, no link, just "hand
    # your work in" — had no hand-in item at all, so a student who did hand it in was scored
    # as though the homework carried nothing. ``external_urls`` is the documented source of
    # truth for links; the singular ``external_url`` mirrors only the first and is read
    # beside it so rows written before the list existed still register a slot.
    has_slot = bool(
        assignment.allow_file_upload
        or assignment.attachment_file
        or assignment.external_url
        or assignment.external_urls
    )
    if not has_slot:
        try:
            has_slot = assignment.extra_attachments.exists()
        except Exception:
            has_slot = False
    if not has_slot:
        return None

    qs = Submission.objects.filter(
        assignment=assignment,
        student=student,
        status__in=(Submission.STATUS_SUBMITTED, Submission.STATUS_REVIEWED),
    )
    if as_of is not None:
        # ``submitted_at`` is nullable — a row marked SUBMITTED by an import, a status fix or
        # any path that never called ``submit()`` has none — and dropping those out of the
        # window makes the same hand-in worth 100 live and 0 at the deadline, which is the
        # deadline confiscating a hand-in that plainly exists. ``created_at`` is
        # ``auto_now_add`` and is never later than the real hand-in, so it is a safe floor;
        # the assessment path already answers the identical question the identical way.
        qs = qs.annotate(done_at=Coalesce("submitted_at", "created_at")).filter(
            done_at__lte=as_of
        )
    return BundleItem("handin", "file", 100.0 if qs.exists() else 0.0)


# ── Bundle ────────────────────────────────────────────────────────────────────

def bundle_items(assignment, student, as_of=None) -> list[BundleItem]:
    """Every scoreable item of this homework, with the percent the student reached on each.

    ``as_of`` is the deadline cutoff: with it set, each kind counts only work completed at or
    before that moment, using its own completion timestamp (an assessment's ``submitted_at``
    falling back to ``started_at``, a vocab session's ``completed_at``, a ``TestAttempt``'s
    ``completed_at``, a ``Submission``'s ``submitted_at``). Filtering the source rows is what
    makes "settle as of the deadline" idempotent — the sweep can re-run for ever and land on
    the same number, which a frozen snapshot column would not.

    A cutoff that leaves no window at all is refused here rather than in each of the four kinds,
    so no caller — the sweep, a hook, a management command — can build one by accident.
    """
    as_of = _scoring_cutoff(assignment, as_of)
    items = _assessment_items(assignment, student, as_of)
    items += _vocab_items(assignment, student, as_of)
    for maybe in (
        _sat_content_item(assignment, student, as_of),
        _handin_item(assignment, student, as_of),
    ):
        if maybe is not None:
            items.append(maybe)
    return items


def bundle_percent(assignment, student, as_of=None) -> float | None:
    """The homework's single percentage, or ``None`` when it carries nothing scoreable.

    ``None`` is not zero: an assignment that is only an announcement has nothing to earn from,
    and awarding it 0 would put a "0 points" row in the student's history for work that was
    never set.
    """
    items = bundle_items(assignment, student, as_of)
    if not items:
        return None
    total_weight = sum(item.weight for item in items)
    if total_weight <= 0:
        # Weights are data, and data can be wrong. A bundle whose weights sum to zero has no
        # divisible whole, which is "nothing scoreable" rather than "scored zero" — the same
        # answer as an empty bundle, and never a ZeroDivisionError raised at a hook site.
        return None
    return sum(item.percent * item.weight for item in items) / total_weight


def recompute_bundle(assignment, student, *, actor=None):
    """Settle one student's award for one homework — and decide whether it settles at all.

    This is the timing gate, not just the arithmetic. All four item hooks converge here and
    any of them can fire days after the deadline, so the decision has to live in one place:

        classwork                    → nothing, ever (paid by a teacher's hand, §7)
        no deadline                  → settle live, at whatever the bundle is worth now
        deadline before it was set   → no window, so no deadline (``_scoring_cutoff``)
        before the deadline, 100%    → settle now
        before the deadline, < 100%  → write NOTHING AT ALL; wait for the deadline sweep
        after the deadline           → settle as of the deadline

    **Writing nothing before the deadline is load-bearing, not an optimisation.** XP is a
    high-water mark (``services.award``), so an interim award at a transient high percent —
    the one assessment of a three-item bundle graded 100 on the first evening — banks that XP
    permanently. The deadline figure could then only take the points back, and the board would
    stay wrong.

    Upserts on ``homework:<assignment_id>:<student_id>``, so this is not "award once", it is
    "make the award match reality now": a re-grade adjusts it, and a re-run changes nothing.
    """
    from classes.models import Assignment

    if assignment is None or student is None:
        return None
    # Classwork is a teacher's decision, never an outcome. Its carrier is an ordinary
    # PUBLISHED Assignment minted by journals.delivery, so without this line every journal
    # item shared with a class already pays homework points nobody chose to give.
    if assignment.category == Assignment.CATEGORY_CLASSWORK:
        return None
    # Draft work has not been given to anyone. The academic leaderboard excludes drafts too,
    # and a reward that disagreed with it about what "assigned" means is not defensible.
    #
    # Note this returns rather than revoking, and the asymmetry is deliberate: never-published
    # work earns nothing, but points a student genuinely earned are not confiscated because a
    # teacher later toggled the assignment back to draft.
    if assignment.status == Assignment.STATUS_DRAFT:
        return None

    # ``_scoring_cutoff`` and not ``assignment.due_at``: a carrier whose deadline falls at or
    # before its own creation has no window in which work could have counted, and treating that
    # as a real deadline settles the entire class at 0%. It scores live instead — as a
    # deadline-less assignment does — which is the only reading under which a class that ran
    # behind schedule can still earn what it does.
    due_at = _scoring_cutoff(assignment, assignment.due_at)
    past_due = due_at is not None and timezone.now() > due_at
    percent = bundle_percent(assignment, student, due_at if past_due else None)

    if due_at is not None and not past_due and (percent is None or percent < 100):
        return None

    key = constants.homework_key(assignment.id, student.id)
    if percent is None:
        # Nothing scoreable at all — an announcement, or a bundle whose every item was
        # detached after the fact. Revoked rather than awarded zero: a "0 points" row reads
        # as "you were assessed on this", and this homework was never work to do.
        revoke(key, reason="homework carries nothing scoreable", actor=actor)
        return None

    # Proportional, with the maximum read live from the rule so the school can retune it.
    #
    # ``points`` is passed EXPLICITLY on every settlement, including a genuine 0, and that is
    # what keeps a settled-at-0% homework distinguishable from a revoked one. Two traps sit
    # here. ``award`` treats a stored 0 with no explicit points as "not yet priced" and
    # re-prices it from the rule, which would silently turn a 0% homework into a full-price
    # one on the next sweep. And ``revoke`` now clears XP as well as points, because a
    # withdrawn fact was never evidence of anything — but a student who scored 0 did the
    # homework badly, they were not un-set it, so their XP must stand.
    points = int(round(points_for(constants.EVENT_HOMEWORK) * percent / 100))
    return award(
        student,
        constants.EVENT_HOMEWORK,
        idempotency_key=key,
        points=points,
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
