"""Where points are earned.

Each hook is a signal receiver rather than a call edited into someone else's view, for one
reason: the write paths are plural and easy to miss. Attendance alone has three
(``mark/``, ``mark-all-present/``, ``finalize/``), and midterm verdicts are written by the
runtime *and* by ``backfill_midterm_outcomes``. Hanging off the model saves catches all of
them without asking every future caller to remember.

That is only safe because awarding is idempotent and self-correcting: re-running a hook
rewrites the award in place, and a hook that now evaluates to "earns nothing" revokes what it
granted before. Signals therefore fire freely — the common case writes nothing at all.

Every receiver is wrapped so a reward failure can never break the thing that triggered it.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from . import constants
from .services import award, revoke

logger = logging.getLogger(__name__)


# ── Attendance: 5 for present, 3 for late ─────────────────────────────────────

_ATTENDANCE_EVENTS = {
    "PRESENT": constants.EVENT_ATTENDANCE_PRESENT,
    "LATE": constants.EVENT_ATTENDANCE_LATE,
}


def sync_attendance_record(record, *, actor=None) -> None:
    """Bring one student's award for one lesson in line with the mark on the register.

    **Pays the moment the mark is saved.** This reverses the old rule, which banked nothing
    until the session was FINALIZED. The school's instruction is that attendance credit lands
    on save: a student marked present at 09:05 sees the 5 points then, not whenever the teacher
    gets round to finalizing — which in practice is often never, leaving a lesson that plainly
    happened worth nothing.

    **What that costs, stated plainly.** ``Mark all present`` writes a PRESENT row for the whole
    roster in one press with no confirmation (``classes/views_attendance.py``), and a teacher
    toggles P/A/L/E freely while marking. Payment is therefore *provisional* and
    *correction-driven*: every mis-mark is paid first and taken back when the register is
    fixed, where before it was confirmed first and paid once.

    **Why that is safe now and was not before.** ``revoke`` zeroes ``xp`` alongside ``points``
    (services.py) — a withdrawn fact takes its XP with it. Under the old rule XP was a permanent
    high-water mark, so one stray press granted XP to every absentee in the class and no
    correction could ever take it back: the teacher could fix the points and the board would
    stay wrong forever. Paying on save without that change would have been unrecoverable.

    Correcting is most of what this function now does, which is why it also *revokes*:
    PRESENT → ABSENT has to give the 5 back, not leave it stranded.

    Strikes deliberately did **not** move with this — see :func:`sync_attendance_strikes`.
    """
    session = record.session
    key = constants.attendance_key(record.id)

    event = _ATTENDANCE_EVENTS.get(record.status)
    if event is None:
        # ABSENT earns nothing; EXCUSED is not a failure to attend but is not attendance
        # either. Either way, anything previously granted for this record comes back.
        revoke(key, reason=f"attendance corrected to {record.status}", actor=actor)
        return

    award(
        record.student,
        event,
        idempotency_key=key,
        classroom=session.classroom,
        source_type="attendance_record",
        source_id=record.id,
        actor=actor,
        reason=f"attendance {record.status}",
    )


def sync_attendance_session(session, *, actor=None) -> None:
    """Re-settle every mark on a finalized session.

    No longer the payment path — each record pays itself on save — so this is a reconciliation
    pass: it re-runs marks whose own award write lost a race or failed transiently, and finalize
    is the natural moment to do that because it is the point the register stops moving.

    Still FINALIZED-gated, and that is a cost decision rather than a rule: dropping the gate
    would walk and re-price every record on *every* session save (a date edit, a note, the
    nightly ensure-sessions job) to re-derive awards the record hook has already written.
    """
    from classes.models_attendance import AttendanceSession

    if session.status != AttendanceSession.STATUS_FINALIZED:
        return
    for record in session.records.select_related("student", "session"):
        sync_attendance_record(record, actor=actor)


def sync_attendance_strikes(session, *, actor=None) -> None:
    """Re-derive the streak of everyone on a finalized register.

    Separate from the points hook above because the two answer different questions from the
    same row. Points are per-record and idempotent on that record; a strike is a property of a
    student's whole history, so one mark changing means recomputing that student — and a
    session finalizing means recomputing all of them.

    **Deliberately still FINALIZED-gated, while points now pay on save.** That asymmetry is the
    decision, not an oversight. ``strikes.recompute`` re-derives a student's entire attendance
    history, zeroes ``spent_in_streak`` and writes a visible ``KIND_RESET`` transaction the
    student can read. Running it on every P/A/L/E toggle would break and rebuild a student's
    streak under the teacher's cursor, spending and refunding their strike balance as the
    register is typed. An idempotent per-record award survives that; a re-derived history with
    a user-visible reset row does not.
    """
    from classes.models_attendance import AttendanceSession

    from . import strikes

    if session.status != AttendanceSession.STATUS_FINALIZED:
        return
    for student_id in set(session.records.values_list("student_id", flat=True)):
        from django.contrib.auth import get_user_model

        student = get_user_model().objects.filter(pk=student_id).first()
        if student is not None:
            strikes.recompute(student, actor=actor)


@receiver(post_save, sender="classes.AttendanceSession", dispatch_uid="rewards_attendance_session")
def _on_attendance_session_saved(sender, instance, **kwargs):
    try:
        sync_attendance_session(instance)
    except Exception:
        logger.exception("reward_hook_failed attendance_session=%s", instance.pk)
    try:
        sync_attendance_strikes(instance)
    except Exception:
        logger.exception("strike_hook_failed attendance_session=%s", instance.pk)


@receiver(post_save, sender="classes.AttendanceRecord", dispatch_uid="rewards_attendance_record")
def _on_attendance_record_saved(sender, instance, **kwargs):
    try:
        sync_attendance_record(instance)
    except Exception:
        logger.exception("reward_hook_failed attendance_record=%s", instance.pk)
    try:
        from . import strikes

        strikes.sync_from_attendance(instance)
    except Exception:
        logger.exception("strike_hook_failed attendance_record=%s", instance.pk)


# ── Attendance: the mark went away ────────────────────────────────────────────
#
# The only ``post_delete`` receivers in the app, and the register is the reason: it is the one
# reward source staff routinely delete. A session opened on the wrong date, a duplicate created
# by two teachers at once, a class rebuilt — each takes its marks with it. Every other source
# (a graded attempt, a survey response, a support booking) is corrected in place, never removed.
#
# Without these, deleting a session left its points paid with nothing left to explain them:
# the student's feed showed an earning for a lesson that no longer exists, and no re-run of any
# hook could find it to take back.

def revoke_attendance_award(record_id, *, reason: str, actor=None) -> None:
    """Zero the award for an attendance mark that no longer exists."""
    if record_id is None:
        return
    revoke(constants.attendance_key(record_id), reason=reason, actor=actor)


def _award_dies_with_this_delete(instance, origin) -> bool:
    """Is the award this mark paid being deleted by the very cascade that removed the mark?

    ``PointAward.student`` is the ONLY cascading FK into the ledger — ``season`` is PROTECT,
    ``classroom`` and ``created_by`` are SET_NULL — so the question reduces to "is this mark's
    student being deleted too". A classroom, a session or a queryset of marks all leave the
    award standing, which is exactly why they must still revoke.

    ``origin`` — what ``delete()`` was actually called on, sent with the signal since Django
    4.1 — is the only thing in scope that can answer it. Every cheaper reading is wrong:

    * the student row is still there (``Collector.sort`` deletes children first, so the parent
      user goes last), so an existence check says "alive" throughout the cascade;
    * whether the ``PointAward`` row has gone yet is arbitrary — nothing orders it against
      ``AttendanceRecord`` in the collector, so the two land in model-registration order and
      the bug this guard exists for reproduced only half the time.

    A queryset origin over the user model is treated as fatal without checking membership,
    because the only route from a user to an ``AttendanceRecord`` is the record's own
    ``student`` FK: ``AttendanceRecord.marked_by`` and ``AttendanceSession.created_by`` are
    SET_NULL and ``Classroom.created_by`` is PROTECT, so a user cascade cannot reach a mark
    belonging to somebody else.
    """
    if origin is None:
        return False

    from django.contrib.auth import get_user_model

    user_model = get_user_model()
    if isinstance(origin, user_model):
        return origin.pk == instance.student_id
    origin_model = getattr(origin, "model", None)      # a QuerySet.delete()
    return origin_model is not None and issubclass(origin_model, user_model)


@receiver(post_delete, sender="classes.AttendanceRecord", dispatch_uid="rewards_attendance_record_deleted")
def _on_attendance_record_deleted(sender, instance, origin=None, **kwargs):
    """A mark was removed, so whatever it paid comes back — unless the payee is going with it.

    ``instance.pk`` is still populated here: the collector clears primary keys only *after*
    every ``post_delete`` has been sent, so the idempotency key is still derivable.

    ``instance.session`` is deliberately not touched. ``revoke`` needs nothing but the key, and
    dereferencing the FK would be a query against a row that is itself mid-delete in the cascade
    case below.

    Registering this receiver is what makes that cascade work at all:
    ``Collector.can_fast_delete`` consults ``post_delete.has_listeners``, so a listener here is
    what stops Django collapsing the child rows into one raw ``DELETE`` that signals nothing.
    The per-record loop it falls back to is the cost of getting the revoke — which is why this
    stays a ``post_delete`` receiver rather than moving onto ``AttendanceRecord.delete()``: a
    cascade never calls the model's ``delete()``, and the register's commonest removals (a
    session on the wrong date, a rebuilt class, a student taken off the platform) are all
    cascades.

    **Why the guard.** Deleting a student cascades into ``AttendanceRecord`` *and* into
    ``PointAward``, and the collector fast-deletes ``PointAwardAudit`` before either. Revoking
    here would then write a fresh audit row pointing at a ``PointAward`` the same cascade is
    about to remove, and the delete would fail its foreign key — at COMMIT, because Django
    declares that FK ``DEFERRABLE INITIALLY DEFERRED``. Note where that lands: *outside* this
    receiver and outside ``revoke``'s savepoint, so neither the ``except`` below nor the
    swallow inside ``services`` can catch it. Deleting a student simply raised.

    Skipping is not a compromise, it is the correct answer: the whole ledger for that student
    is being deleted by the same statement, so there is no award left to take back and nobody
    left to take it from. Every other delete — one mark, a session, a classroom, a queryset of
    marks — leaves the award row standing and still revokes.

    ``transaction.on_commit`` would also dodge the FK, and is wrong here: the register is
    corrected inside teacher requests that read the balance back, and a deferred revoke leaves
    a deleted lesson paid until the request finishes.
    """
    try:
        if _award_dies_with_this_delete(instance, origin):
            return
        revoke_attendance_award(instance.pk, reason="attendance record deleted")
    except Exception:
        logger.exception("reward_hook_failed attendance_record_deleted=%s", instance.pk)


@receiver(post_delete, sender="classes.AttendanceSession", dispatch_uid="rewards_attendance_session_deleted")
def _on_attendance_session_deleted(sender, instance, **kwargs):
    """A whole lesson was deleted — sweep up any attendance award left standing without a mark.

    Normally there is nothing to find: ``AttendanceRecord.session`` is ``CASCADE``, and a cascade
    deletes rows *without* ever calling the model's ``delete()``, so the receiver above is the
    only thing that runs — and by the time this fires it already has. This is the reconciliation
    pass for the rows it could not reach: records removed by a raw ``DELETE``, by a data
    migration, or during the period before that receiver existed.

    Driven by the awards rather than by the records, because the records are the thing that is
    gone. Scoped to this session's classroom so the scan stays small, and to rows that still
    carry something — a re-run finds nothing and writes nothing, which is what lets it sit on a
    delete path.

    Needs no equivalent of ``_award_dies_with_this_delete``: nothing cascades from a user into
    an ``AttendanceSession`` (``created_by`` is SET_NULL, and ``Classroom.created_by`` is
    PROTECT), so the awards this touches always outlive the delete that woke it. Under a
    *classroom* cascade it writes nothing at all — ``PointAward.classroom`` is SET_NULL and the
    collector applies its field updates before any ``post_delete``, so the filter below matches
    no rows by the time this runs.
    """
    try:
        from classes.models_attendance import AttendanceRecord

        from .models import PointAward

        paid = set(
            PointAward.objects.filter(
                classroom_id=instance.classroom_id,
                source_type="attendance_record",
                source_id__isnull=False,
            )
            .exclude(points=0, xp=0)
            .values_list("source_id", flat=True)
        )
        if not paid:
            return
        alive = set(AttendanceRecord.objects.filter(id__in=paid).values_list("id", flat=True))
        for record_id in paid - alive:
            revoke_attendance_award(record_id, reason="attendance session deleted")
    except Exception:
        logger.exception("reward_hook_failed attendance_session_deleted=%s", instance.pk)


# ── Midterm: 20 for a pass, 5 for passing a retake ────────────────────────────

def _verdict_rests_on_a_later_sitting(outcome, awarded_at) -> bool:
    """Did the student sit this paper AGAIN after the award was banked?

    ``MidtermOutcome`` is one upserted row per (midterm, student) that always follows the
    newest sitting, so the row alone cannot say which of the two things happened to it. This
    compares the sitting the verdict now rests on against the moment the award was first
    written: a **re-score** corrects a sitting that finished before the award, a **re-sit**
    finishes after it.

    Deliberately strict, and deliberately conservative when it cannot tell (no attempt, no
    completion time, or the two timestamps tie): the caller keeps XP only on positive proof of
    a later sitting, and treats everything else as the re-score it looks like.
    """
    completed_at = getattr(outcome.attempt, "completed_at", None)
    return completed_at is not None and awarded_at is not None and completed_at > awarded_at


def sync_midterm_outcome(outcome, *, actor=None) -> None:
    """Award the verdict recorded for one student on one midterm.

    "Retake" is worth 5 **only** when the sitting was a separate ``midterm_type=RETAKE``
    exam. The other thing the codebase calls a retake — a ``MidtermResit`` grant to sit the
    *same* paper again — still earns the full 20; that is the school's call, and the two
    mechanisms are unrelated despite the shared word.

    A verdict can move: ``record_for`` is an ``update_or_create`` that a re-score or a later
    sitting can flip.

    **A non-pass is two different facts, and the overhaul split them.** ``revoke`` now zeroes
    XP as well as points (OVERHAUL §6), which turned one branch into a confiscation the school
    never asked for. §6 narrows the rule to "XP is never taken away for doing WORSE", and the
    two ways a pass becomes a fail sit on opposite sides of that line:

    * **A re-score** — the same sitting, re-judged — is a *withdrawn* fact. The student never
      passed; the platform was wrong. That still ``revoke``s, and the XP goes with it, exactly
      as a PRESENT corrected to ABSENT does.
    * **A lower re-sit** is the definition of doing worse. The earlier pass genuinely happened
      and its XP was genuinely earned. Because the outcome row follows the newest sitting, the
      old branch let a student who voluntarily sat again to try to improve be stripped of XP
      they had banked weeks earlier — a strictly worse outcome than not sitting at all, which
      is precisely the incentive §6 exists to remove. This settles at ``points=0`` instead:
      points are the current truth and must fall, while ``award``'s ``max(previous_xp, …)``
      leaves the XP standing.

    ``points=0`` rather than "write nothing" on that branch is the load-bearing part: it
    records that the verdict was assessed and is currently worth nothing, which a later pass
    raises back to the rule's price. Skipping the write would leave the old points paid.

    The two are told apart by :func:`_verdict_rests_on_a_later_sitting`, and one case is read
    imprecisely: a student who failed, then passed a re-sit, then had *that* re-sit re-scored
    down is treated as a downgrade and keeps the XP. The outcome row cannot distinguish it —
    nothing records which sitting the award was paid for — and of the two ways to be wrong,
    keeping XP a student was once shown is the one that does not confiscate.
    """
    from midterms.models import Midterm

    from .models import PointAward

    key = constants.midterm_key(outcome.id)
    is_retake = outcome.midterm.midterm_type == Midterm.TYPE_RETAKE
    event = (
        constants.EVENT_MIDTERM_RETAKE_PASS if is_retake else constants.EVENT_MIDTERM_PASS
    )

    if not outcome.passed:
        # Only read the ledger on the branch that can confiscate. `xp > 0` is the test for
        # "a pass was banked here": no row, a never-paid fail, or an already-revoked one all
        # fall through to `revoke`, which is a no-op on every one of them.
        banked = (
            PointAward.objects.filter(idempotency_key=key)
            .only("id", "xp", "awarded_at")
            .first()
        )
        downgraded = (
            banked is not None
            and banked.xp > 0
            and _verdict_rests_on_a_later_sitting(outcome, banked.awarded_at)
        )
        if downgraded:
            award(
                outcome.student,
                event,
                idempotency_key=key,
                points=0,
                source_type="midterm_outcome",
                source_id=outcome.id,
                actor=actor,
                reason="midterm re-sat below the pass mark",
            )
        else:
            revoke(key, reason="midterm verdict is not a pass", actor=actor)
        return

    award(
        outcome.student,
        event,
        idempotency_key=key,
        source_type="midterm_outcome",
        source_id=outcome.id,
        actor=actor,
        reason="midterm passed",
    )


@receiver(post_save, sender="midterms.MidtermOutcome", dispatch_uid="rewards_midterm_outcome")
def _on_midterm_outcome_saved(sender, instance, **kwargs):
    try:
        sync_midterm_outcome(instance)
    except Exception:
        logger.exception("reward_hook_failed midterm_outcome=%s", instance.pk)


# ── Homework: 15 / 10 / 5 on the whole bundle ─────────────────────────────────
#
# Every item a bundle can contain finishes on a different model, so there are four entry
# points. All four converge on ``recompute_bundle``, which re-derives the bundle percentage
# from scratch and upserts one award — so it does not matter which item finished, how many
# times a path fires, or in what order they arrive.

def _student_classroom_ids(student):
    from classes.models import ClassroomMembership

    return ClassroomMembership.objects.filter(
        user=student,
        role=ClassroomMembership.ROLE_STUDENT,
        status__in=ClassroomMembership.NON_REMOVED_STATUSES,
    ).values_list("classroom_id", flat=True)


def _assignments_targeting_practice_test(student, practice_test_id):
    """Homework in the student's classes that includes this section.

    There is no reverse index for this: a section can be reached through a plain FK, a JSON id
    list, a pack, or a mock shell, so the final match has to happen in Python. The SQL filter
    below exists to keep that loop over the handful of assignments that reference SAT content
    at all, rather than every assignment the student has ever been given.
    """
    from django.db.models import Q

    from classes.models import Assignment, assignment_target_practice_test_ids

    candidates = (
        Assignment.objects.filter(classroom_id__in=_student_classroom_ids(student))
        .exclude(status=Assignment.STATUS_DRAFT)
        .filter(
            Q(practice_test_id__isnull=False)
            | Q(practice_test_ids__isnull=False)
            | Q(practice_test_pack_id__isnull=False)
            | Q(practice_test_pack_ids__isnull=False)
            | Q(mock_exam_id__isnull=False)
        )
    )
    for assignment in candidates:
        if practice_test_id in assignment_target_practice_test_ids(assignment):
            yield assignment


def _recompute(assignment, student):
    """Settle a bundle once the transaction that triggered it has actually committed.

    Deferring is not tidiness, it is the difference between paying and not paying.
    ``grade_attempt`` writes the ``AssessmentResult`` and only THEN flips the attempt to
    GRADED (assessments/grading_service.py:120 vs :132-135), both inside one atomic block. A
    receiver that recomputed inline would run while the attempt was still SUBMITTED, and
    ``_assessment_items`` — which selects on ``attempt__status=GRADED`` — could not see the
    very grading that woke it. A perfect homework paid 0.

    On commit the attempt is GRADED and every sibling row is visible. It also means a
    transaction that rolls back never reaches the ledger, instead of awarding for work the
    database then threw away.
    """
    from django.db import transaction

    from .homework import recompute_bundle

    assignment_id = getattr(assignment, "pk", None)
    student_id = getattr(student, "pk", None)
    if assignment_id is None or student_id is None:
        return

    def _settle():
        # Re-read rather than closing over the instances: by commit time the objects the
        # signal handed us may be several saves stale.
        from classes.models import Assignment
        from django.contrib.auth import get_user_model

        assignment_now = Assignment.objects.filter(pk=assignment_id).first()
        student_now = get_user_model().objects.filter(pk=student_id).first()
        if assignment_now is None or student_now is None:
            return
        recompute_bundle(assignment_now, student_now)

    transaction.on_commit(_settle)


@receiver(post_save, sender="assessments.AssessmentResult", dispatch_uid="rewards_hw_assessment")
def _on_assessment_result_saved(sender, instance, **kwargs):
    """An assessment inside a bundle was graded.

    Hung off the result rather than off ``grade_attempt`` so the ops requeue and force-grade
    paths are covered too — they all end in this row being written.
    """
    try:
        attempt = instance.attempt
        homework = getattr(attempt, "homework", None)
        if homework is None or homework.assignment_id is None:
            return
        _recompute(homework.assignment, attempt.student)
    except Exception:
        logger.exception("reward_hook_failed assessment_result=%s", instance.pk)


@receiver(post_save, sender="exams.TestAttempt", dispatch_uid="rewards_hw_test_attempt")
def _on_test_attempt_saved(sender, instance, **kwargs):
    """A pastpaper / mock section was finished."""
    try:
        from exams.models import TestAttempt

        if not (instance.is_completed and instance.current_state == TestAttempt.STATE_COMPLETED):
            return
        if instance.practice_test_id is None or instance.student_id is None:
            return
        for assignment in _assignments_targeting_practice_test(
            instance.student, instance.practice_test_id
        ):
            _recompute(assignment, instance.student)
    except Exception:
        logger.exception("reward_hook_failed test_attempt=%s", instance.pk)


@receiver(post_save, sender="vocabulary.VocabStudySession", dispatch_uid="rewards_hw_vocab")
def _on_vocab_session_saved(sender, instance, **kwargs):
    """A vocabulary set was finished in one of the study modes."""
    try:
        if instance.completed_at is None:
            return
        from vocabulary.models import VocabHomework

        links = VocabHomework.objects.filter(
            vocab_set_id=instance.vocab_set_id,
            assignment__classroom_id__in=_student_classroom_ids(instance.user),
        ).select_related("assignment")
        for link in links:
            _recompute(link.assignment, instance.user)
    except Exception:
        logger.exception("reward_hook_failed vocab_session=%s", instance.pk)


@receiver(post_save, sender="classes.Submission", dispatch_uid="rewards_hw_submission")
def _on_submission_saved(sender, instance, **kwargs):
    """A file or link deliverable was handed in (or its grade changed)."""
    try:
        if instance.assignment_id is None or instance.student_id is None:
            return
        _recompute(instance.assignment, instance.student)
    except Exception:
        logger.exception("reward_hook_failed submission=%s", instance.pk)


# ── Support teacher: 10 for a session that actually happened ──────────────────

def sync_support_booking(booking, *, actor=None) -> None:
    """Award the student for a support session the teacher confirmed as held.

    On HELD, not on booking. A student who books and never turns up has not been helped, and
    paying at booking time would make the calendar the cheapest points on the platform.

    Revokes on anything else, because a booking can move backwards: a teacher who settles the
    wrong row can correct it to NO_SHOW, and the points have to follow.
    """
    from classes.models_support import SupportBooking

    key = constants.support_session_key(booking.id)
    if booking.status != SupportBooking.STATUS_HELD:
        revoke(key, reason=f"support session {booking.status.lower()}", actor=actor)
        return

    award(
        booking.student,
        constants.EVENT_SUPPORT_SESSION,
        idempotency_key=key,
        classroom=booking.classroom,
        source_type="support_booking",
        source_id=booking.id,
        actor=actor,
        reason="support session held",
    )


@receiver(post_save, sender="classes.SupportBooking", dispatch_uid="rewards_support_booking")
def _on_support_booking_saved(sender, instance, **kwargs):
    try:
        sync_support_booking(instance)
    except Exception:
        logger.exception("reward_hook_failed support_booking=%s", instance.pk)


# ── Survey: 40 for completing one ─────────────────────────────────────────────

def sync_survey_response(response, *, actor=None) -> None:
    """Award a completed survey.

    Keyed on the response, which is unique per (survey, student) — so a survey pays once per
    student no matter how the row is touched afterwards. Carries no classroom: a survey is
    sent by the school, not by a class, and attributing it to one would put it on that class's
    board and nobody else's.
    """
    from surveys.models import SurveyResponse

    key = constants.survey_key(response.id)
    if response.status != SurveyResponse.STATUS_SUBMITTED:
        revoke(key, reason="survey response withdrawn", actor=actor)
        return

    award(
        response.student,
        constants.EVENT_SURVEY,
        idempotency_key=key,
        source_type="survey_response",
        source_id=response.id,
        actor=actor,
        reason="survey completed",
    )


@receiver(post_save, sender="surveys.SurveyResponse", dispatch_uid="rewards_survey_response")
def _on_survey_response_saved(sender, instance, **kwargs):
    try:
        sync_survey_response(instance)
    except Exception:
        logger.exception("reward_hook_failed survey_response=%s", instance.pk)
