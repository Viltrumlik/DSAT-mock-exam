"""
Keep assessment homeworks pinned to the CURRENT content of their set.

Problem this solves: a homework pins an ``AssessmentSetVersion`` snapshot so a
student mid-attempt never sees content shift. But the two assign paths used to
reuse the *latest existing* version — so if a teacher edited the set (added or
removed questions) after a version was first created, newly-assigned homeworks
(and re-assigns) kept the STALE snapshot. Students then got e.g. 2 of 24
questions while the board (live count) showed 24.

Two helpers fix this:

* ``ensure_current_version`` — snapshot the set's CURRENT content at assign time.
  Idempotent: returns the existing version if nothing changed, publishes a fresh
  one if it did, and falls back to the latest existing version if the live set
  fails publish validation (so a slightly-invalid set can still be assigned).

* ``resync_stale_homeworks`` — after a new version exists, re-pin every homework
  of that set that has NO active attempt (in_progress/submitted/graded) to it, so
  teacher edits propagate to not-yet-started homeworks WITHOUT disrupting anyone
  who has already started or been graded.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Attempt statuses that mean "a student has meaningfully engaged" — homeworks with
# any of these are NOT auto-repinned (their content stays frozen). "abandoned" is
# excluded on purpose: those attempts are dead and the student restarts fresh.
ACTIVE_ATTEMPT_STATUSES = ("in_progress", "submitted", "graded")


def ensure_current_version(*, set_id: int, actor):
    """Return the ``AssessmentSetVersion`` snapshotting the set's current content.

    Publishes a fresh version when the live set differs from the last snapshot
    (``publish_assessment_set`` is idempotent on identical content). On publish
    validation failure — or any error — falls back to the latest existing version
    so assignment never hard-fails on a set that was previously assignable.
    """
    from .publish_service import publish_assessment_set, PublishValidationError
    from assessments.models import AssessmentSetVersion

    def _latest():
        return (
            AssessmentSetVersion.objects.filter(assessment_set_id=set_id)
            .order_by("-version_number")
            .first()
        )

    try:
        return publish_assessment_set(set_id=set_id, actor=actor)
    except PublishValidationError:
        logger.warning("ensure_current_version: set %s failed publish validation; using latest existing version", set_id)
        return _latest()
    except Exception:
        logger.exception("ensure_current_version: publish failed for set %s; using latest existing version", set_id)
        return _latest()


def attach_assessment_set(*, classroom, assignment, set_id: int, actor):
    """Give ``classroom`` access to assessment set ``set_id``, pinned to current content.

    This is the whole "grant a class an assessment" operation: there is no per-student
    access row for assessments — a ``HomeworkAssignment`` row plus STUDENT membership IS
    the gate (see ``assessments.views_attempt.StartAttemptView``).

    Returns ``(homework, created)``. ``created is False`` means the set was already
    available to this class: ``uniq_assessment_hw_classroom_set`` allows a set to be
    assigned to a classroom only ONCE, ever, so callers must report "already available"
    rather than treating it as a failure. Returns ``(None, False)`` if the set is gone.
    """
    from django.db import IntegrityError, transaction
    from assessments.models import AssessmentSet, HomeworkAssignment

    try:
        aset = AssessmentSet.objects.get(pk=set_id)
    except AssessmentSet.DoesNotExist:
        logger.warning("attach_assessment_set: set %s not found; skipping", set_id)
        return None, False

    pinned_version = ensure_current_version(set_id=aset.pk, actor=actor)
    created = False
    try:
        with transaction.atomic():
            homework = HomeworkAssignment.objects.create(
                classroom=classroom,
                assessment_set=aset,
                assignment=assignment,
                assigned_by=actor,
                set_version=pinned_version,
            )
        created = True
    except IntegrityError:
        # Expected case: uniq_assessment_hw_classroom_set — this set is already available
        # to this class. Re-raise anything else rather than reporting it as "already
        # assigned", which would silently swallow a real constraint failure.
        homework = HomeworkAssignment.objects.filter(
            classroom=classroom, assessment_set=aset
        ).first()
        if homework is None:
            raise

    # Propagate the current content to this set's other not-yet-started homeworks.
    try:
        resync_stale_homeworks(assessment_set=aset, version=pinned_version)
    except Exception:
        logger.exception("resync_stale_homeworks failed for set %s", set_id)
    return homework, created


def resync_stale_homeworks(*, assessment_set, version, exclude_homework_ids=()) -> int:
    """Re-pin homeworks of ``assessment_set`` that have no active attempts to
    ``version`` (so edits reach not-yet-started homeworks). Returns the count
    re-pinned. Homeworks with an in_progress/submitted/graded attempt are left
    untouched to protect students already engaged."""
    from assessments.models import HomeworkAssignment, AssessmentAttempt

    if version is None:
        return 0

    active_hw_ids = set(
        AssessmentAttempt.objects.filter(
            homework__assessment_set=assessment_set,
            status__in=ACTIVE_ATTEMPT_STATUSES,
        ).values_list("homework_id", flat=True)
    )
    qs = (
        HomeworkAssignment.objects.filter(assessment_set=assessment_set)
        .exclude(id__in=active_hw_ids)
        .exclude(id__in=list(exclude_homework_ids))
        .exclude(set_version=version)
    )
    return qs.update(set_version=version)
