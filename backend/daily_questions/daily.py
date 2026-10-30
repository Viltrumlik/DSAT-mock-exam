"""Who gets which question today, and taking their one answer to it.

The rules (owner, 2026-10-30):

- **Who.** A centre student (role ``student``) who is not frozen out of the site. A public
  learner has no class, so no level, so nothing to be dealt. The whole feature is behind
  ``DAILY_QUESTIONS_ENABLED``.
- **How many.** One per subject the student is in an ACTIVE class for, at that class's level.
  Two classes in one subject (rare: moving up, or a second group) — the one joined most
  recently wins, since that is the class they are studying in now.
- **Which.** A random question from the cohort's list that the student has not had yet this
  month in this subject. Once they have had them all — a 31-day month against a 30-question
  list, or a short list — the deal goes round again from the least-dealt.
- **Once a day.** The deal is written the first time the card is opened, so a reload, a
  second tab or the iOS app later all see the same question.
- **One try, that day only.** A day's question is answerable until midnight Tashkent; after
  that it is simply never shown again. The correct answer and the explanation leave the
  server only once the student has answered.
- **Reward.** Right first time pays ``DAILY_QUESTION`` (2 points + 2 XP by default — the
  live figure is the ``RewardRule`` row).
"""

from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass
from datetime import date

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from access import constants as acc_const
from access.services import normalized_role
from assessments.grading import grade_answer
from assessments.models import AssessmentSet
from classes.models import Classroom, ClassroomMembership
from rewards import constants as reward_const
from rewards.services import award
from users.permissions import is_frozen_for_access

from .models import DailyQuestionAssignment
from .pools import is_blank_answer, month_start, next_month, pool_for

#: English first, then Math — the order the card lists them in.
SUBJECT_ORDER = (AssessmentSet.SUBJECT_ENGLISH, AssessmentSet.SUBJECT_MATH)


class AnswerRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Track:
    """One subject a student is dealt in: the level, and the class it was read from."""

    subject: str
    level: str
    classroom: Classroom


def is_enabled() -> bool:
    return bool(getattr(settings, "DAILY_QUESTIONS_ENABLED", False))


def is_eligible(user) -> bool:
    return (
        is_enabled()
        and user is not None
        and user.is_authenticated
        and normalized_role(user) == acc_const.ROLE_STUDENT
        and not is_frozen_for_access(user)
    )


def tracks_for(user) -> list[Track]:
    memberships = (
        ClassroomMembership.objects.filter(
            user=user,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
            classroom__is_active=True,
        )
        .exclude(classroom__level="")
        .select_related("classroom")
        .order_by("-joined_at", "-id")
    )
    by_subject: dict[str, Track] = {}
    for membership in memberships:
        classroom = membership.classroom
        subject = classroom.domain_subject
        if not subject or subject in by_subject:
            continue
        if classroom.level not in AssessmentSet.allowed_levels_for_subject(subject):
            continue
        by_subject[subject] = Track(subject=subject, level=classroom.level, classroom=classroom)
    return [by_subject[s] for s in SUBJECT_ORDER if s in by_subject]


def _deal(user, track: Track, day: date) -> DailyQuestionAssignment | None:
    pool = pool_for(month_start(day), track.subject, track.level)
    question_ids = list(pool.items.order_by("rank").values_list("question_id", flat=True))
    if not question_ids:
        return None
    dealt = Counter(
        DailyQuestionAssignment.objects.filter(
            student=user,
            subject=track.subject,
            date__gte=month_start(day),
            date__lt=next_month(month_start(day)),
        ).values_list("question_id", flat=True)
    )
    fewest = min(dealt.get(qid, 0) for qid in question_ids)
    candidates = [qid for qid in question_ids if dealt.get(qid, 0) == fewest]
    try:
        with transaction.atomic():
            return DailyQuestionAssignment.objects.create(
                student=user,
                date=day,
                subject=track.subject,
                level=track.level,
                classroom=track.classroom,
                pool=pool,
                question_id=random.choice(candidates),
            )
    except IntegrityError:
        # A second tab dealt this subject a moment ago. Its question stands.
        return DailyQuestionAssignment.objects.filter(
            student=user, date=day, subject=track.subject
        ).first()


def todays_questions(user) -> list[DailyQuestionAssignment]:
    """Today's questions for ``user`` — dealing any that have not been dealt yet."""
    if not is_eligible(user):
        return []
    day = timezone.localdate()
    existing = {
        a.subject: a
        for a in DailyQuestionAssignment.objects.filter(student=user, date=day)
    }
    result = []
    for track in tracks_for(user):
        # Already dealt today stays dealt, even if the student changed class since: the new
        # level takes over tomorrow.
        assignment = existing.get(track.subject) or _deal(user, track, day)
        if assignment is not None:
            result.append(assignment)
    ids = [a.pk for a in result]
    by_id = {
        a.pk: a
        for a in DailyQuestionAssignment.objects.filter(pk__in=ids).select_related("question")
    }
    return [by_id[pk] for pk in ids]


def answer(user, assignment_id: int, value: object) -> DailyQuestionAssignment:
    """Take the student's one answer. Raises ``AnswerRefused`` when it cannot be taken."""
    if not is_eligible(user):
        raise AnswerRefused("unavailable", "The Question of the Day is not available.")
    if is_blank_answer(value):
        raise AnswerRefused("blank", "Choose or type an answer first.")
    with transaction.atomic():
        assignment = (
            DailyQuestionAssignment.objects.select_for_update()
            .filter(pk=assignment_id, student=user)
            .first()
        )
        if assignment is None:
            raise AnswerRefused("not_found", "This question is not yours.")
        if assignment.is_answered:
            raise AnswerRefused("already_answered", "You have already answered this question.")
        if assignment.date != timezone.localdate():
            raise AnswerRefused("expired", "This question was for another day.")
        question = assignment.question
        assignment.answer = value
        assignment.is_correct = grade_answer(
            question_type=question.question_type,
            correct_answer=question.correct_answer,
            answer=value,
            config=question.grading_config or {},
        )
        assignment.answered_at = timezone.now()
        assignment.save(update_fields=["answer", "is_correct", "answered_at"])
        if assignment.is_correct:
            award(
                user,
                reward_const.EVENT_DAILY_QUESTION,
                idempotency_key=reward_const.daily_question_key(assignment.pk),
                classroom=assignment.classroom,
                source_type="daily_question",
                source_id=assignment.pk,
                reason=f"Question of the Day, {assignment.date:%Y-%m-%d}",
            )
    return assignment
