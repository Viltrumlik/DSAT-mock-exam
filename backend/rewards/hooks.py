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

from django.db.models.signals import post_save
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

    Nothing is banked until the session is FINALIZED — a teacher toggles P/A/L/E freely while
    marking, and paying on each toggle would let a mis-click mint points. After finalize an
    owner may still correct a mark, which is why this also *revokes*: PRESENT→ABSENT has to
    give the 5 back, not leave it stranded.
    """
    from classes.models_attendance import AttendanceSession

    session = record.session
    key = constants.attendance_key(record.id)

    if session.status != AttendanceSession.STATUS_FINALIZED:
        return

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
    """Settle every mark on a finalized session."""
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


# ── Midterm: 20 for a pass, 5 for passing a retake ────────────────────────────

def sync_midterm_outcome(outcome, *, actor=None) -> None:
    """Award the verdict recorded for one student on one midterm.

    "Retake" is worth 5 **only** when the sitting was a separate ``midterm_type=RETAKE``
    exam. The other thing the codebase calls a retake — a ``MidtermResit`` grant to sit the
    *same* paper again — still earns the full 20; that is the school's call, and the two
    mechanisms are unrelated despite the shared word.

    A verdict can move: ``record_for`` is an ``update_or_create`` that a re-score or a later
    sitting can flip. A pass turning into a fail therefore revokes.
    """
    from midterms.models import Midterm

    key = constants.midterm_key(outcome.id)

    if not outcome.passed:
        revoke(key, reason="midterm verdict is not a pass", actor=actor)
        return

    is_retake = outcome.midterm.midterm_type == Midterm.TYPE_RETAKE
    event = (
        constants.EVENT_MIDTERM_RETAKE_PASS if is_retake else constants.EVENT_MIDTERM_PASS
    )
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
