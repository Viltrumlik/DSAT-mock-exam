"""
Attach an assessment set to a classroom as homework.

Content is served LIVE: a ``HomeworkAssignment`` row plus STUDENT membership is
the gate, and the attempt freezes WHICH questions it covers via ``question_order``
at start (see ``assessments.views_attempt.StartAttemptView``). There is no version
snapshot to pin or resync — a teacher's edits reach every not-yet-started attempt
automatically because content is read live from the AssessmentQuestion rows.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def attach_assessment_set(*, classroom, assignment, set_id: int, actor):
    """Give ``classroom`` access to assessment set ``set_id``.

    Returns ``(homework, created)``. ``created is False`` means the set was already
    available to this class: ``uniq_assessment_hw_classroom_set`` allows a set to be
    assigned to a classroom only ONCE, so callers must report "already available"
    rather than treating it as a failure. Returns ``(None, False)`` if the set is gone.
    """
    from django.db import IntegrityError, transaction
    from assessments.models import AssessmentSet, HomeworkAssignment

    try:
        aset = AssessmentSet.objects.get(pk=set_id)
    except AssessmentSet.DoesNotExist:
        logger.warning("attach_assessment_set: set %s not found; skipping", set_id)
        return None, False

    created = False
    try:
        with transaction.atomic():
            homework = HomeworkAssignment.objects.create(
                classroom=classroom,
                assessment_set=aset,
                assignment=assignment,
                assigned_by=actor,
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
    return homework, created
