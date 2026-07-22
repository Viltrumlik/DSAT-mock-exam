from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone

from .grading import grade_answer
from .models import (
    AssessmentAttempt,
    AssessmentAnswer,
    AssessmentQuestion,
    AssessmentResult,
    AssessmentAttemptAuditEvent,
)


def _questions_from_attempt(att: AssessmentAttempt) -> tuple[list[Any], dict[int, Any]]:
    """
    Resolve the canonical question list for grading — from the LIVE
    ``AssessmentQuestion`` rows (no version snapshot), like the pastpaper runner.

    Grading uses the same live content the runner delivered, so a teacher's builder
    edit is reflected on the next attempt / re-grade. The caller filters this to the
    attempt's frozen ``question_order`` (so a question added after the student
    started isn't graded; one edited is graded on its current content).

    Returns ``(questions_list, q_by_id_dict)``.
    """
    aset = att.homework.assessment_set
    base_questions = list(
        AssessmentQuestion.objects.filter(assessment_set=aset, is_active=True).order_by("order", "id")
    )
    q_by_id = {q.id: q for q in base_questions}
    return base_questions, q_by_id


@transaction.atomic
def grade_attempt(*, attempt_id: int) -> AssessmentResult | None:
    """
    Idempotent grading transaction.

    Grades the LIVE AssessmentQuestion rows for the ids frozen onto the attempt
    (``question_order``) — see ``_questions_from_attempt``. Content is served,
    graded and reviewed from the live rows; the attempt pins only WHICH questions
    it covers.

    Locks the attempt row for the duration of the transaction.
    Duplicate Celery deliveries are handled idempotently.
    """
    # Lock the row first (Postgres rejects FOR UPDATE on the nullable side
    # of an outer join — `homework` is a nullable FK).
    locked_exists = AssessmentAttempt.objects.select_for_update().filter(pk=attempt_id).exists()
    if not locked_exists:
        return None
    att = (
        AssessmentAttempt.objects
        .select_related("homework", "homework__assessment_set")
        .filter(pk=attempt_id)
        .first()
    )
    if not att:
        return None
    # Idempotent: duplicate Celery deliveries must not re-enter scoring or bump attempts.
    if att.status == AssessmentAttempt.STATUS_GRADED:
        if att.grading_status != AssessmentAttempt.GRADING_COMPLETED:
            att.grading_status = AssessmentAttempt.GRADING_COMPLETED
            att.save(update_fields=["grading_status"])
        return AssessmentResult.objects.filter(attempt=att).first()
    if att.status != AssessmentAttempt.STATUS_SUBMITTED:
        return AssessmentResult.objects.filter(attempt=att).first()

    att.grading_status = AssessmentAttempt.GRADING_PROCESSING
    att.grading_last_attempt_at = timezone.now()
    att.grading_attempts = int(att.grading_attempts or 0) + 1
    att.grading_error = ""
    att.save(update_fields=["grading_status", "grading_last_attempt_at", "grading_attempts", "grading_error"])

    # Resolve questions (snapshot or live).
    base_questions, q_by_id = _questions_from_attempt(att)

    order_ids = [int(x) for x in (att.question_order or []) if str(x).isdigit()]
    questions = [q_by_id[qid] for qid in order_ids if qid in q_by_id] if order_ids else base_questions

    answers = {
        a.question_id: a
        for a in AssessmentAnswer.objects.filter(attempt=att, question_id__in=q_by_id.keys())
    }

    max_points = Decimal("0")
    score = Decimal("0")
    correct = 0
    total_time = 0

    for q in questions:
        max_points += Decimal(str(q.points or 0))
        a = answers.get(q.id)
        total_time += int(getattr(a, "time_spent_seconds", 0) or 0)
        ok = False
        if a is not None:
            ok = grade_answer(
                question_type=q.question_type,
                correct_answer=q.correct_answer,
                answer=a.answer,
                config=q.grading_config or {},
            )
            a.is_correct = ok
            a.points_awarded = Decimal(str(q.points or 0)) if ok else Decimal("0")
            a.save(update_fields=["is_correct", "points_awarded", "updated_at"])
        if ok:
            correct += 1
            score += Decimal(str(q.points or 0))

    total_q = len(questions)
    percent = Decimal("0")
    if max_points > 0:
        percent = (score / max_points) * Decimal("100")

    res, _ = AssessmentResult.objects.update_or_create(
        attempt=att,
        defaults={
            "score_points": score,
            "max_points": max_points,
            "percent": percent,
            "correct_count": correct,
            "total_questions": total_q,
            "graded_at": timezone.now(),
        },
    )

    att.status = AssessmentAttempt.STATUS_GRADED
    att.total_time_seconds = max(int(att.total_time_seconds or 0), total_time)
    att.grading_status = AssessmentAttempt.GRADING_COMPLETED
    att.save(update_fields=["status", "total_time_seconds", "grading_status"])

    AssessmentAttemptAuditEvent.objects.create(
        attempt=att,
        actor=None,
        event_type=AssessmentAttemptAuditEvent.EVENT_GRADED,
        payload={
            "percent": str(percent),
            "async": True,
        },
    )
    return res
