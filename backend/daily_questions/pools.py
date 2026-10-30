"""Building a month's lists: last month's 30 hardest assessment questions per cohort.

"Hardest" is the share of students who got a question right, lowest first. The rules, in the
order the builder applies them (owner, 2026-10-30):

- **Whose answers.** Graded assessment attempts submitted in the previous calendar month,
  Tashkent time. An abandoned attempt never reaches ``GRADED`` and is not counted.
- **One verdict per student.** Only a student's FIRST attempt at a homework counts — the same
  rule as the teacher's item analysis, and for the same reason: the retry path re-serves the
  questions they got wrong, so a retake is a sample of their mistakes, not of the question.
  A first attempt made before the month began keeps its retakes inside the month out too.
- **Which answers.** Only questions the student actually answered. A blank is a student who
  ran out of time, not evidence that the question is hard; counting it would rank the last
  question of every long set as the hardest.
- **Which level.** The level of the CLASS that sat the homework — the cohort it measured —
  not the set's own level. A Junior + Middle set done by a Middle class is a Middle figure. A
  class with no level measures no cohort and is skipped.
- **Noise.** A question needs ``MIN_ANSWERS`` answers to be ranked at all: one student
  missing it is not a 0% question.
- **Broken questions.** The list is fully automatic — nobody reviews it — and the question
  everybody gets wrong is very often the one whose answer key is wrong. A question with an
  open error report (NEW or REVIEWING) is left out, as is anything in an inactive set or
  switched off in its set.
- **Duplicates.** One bank question copied into several sets is one question: its answers
  are pooled and it appears once, as the copy that was answered most.

Ties rank the question with more answers first (the same 20% from 40 students is firmer
than from 5), then the lower id, so a rebuild of the same data gives the same list.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from fractions import Fraction

from django.db import IntegrityError, transaction
from django.utils import timezone

from assessments.item_analysis import _first_counted_attempts
from assessments.models import AssessmentAnswer, AssessmentAttempt, AssessmentSet
from question_reports.models import QuestionErrorReport

from .models import DailyQuestionPool, DailyQuestionPoolItem

logger = logging.getLogger(__name__)

POOL_SIZE = 30
MIN_ANSWERS = 5

OPEN_REPORT_STATUSES = (QuestionErrorReport.STATUS_NEW, QuestionErrorReport.STATUS_REVIEWING)

#: Attempt ids per answers query — well under SQLite's bound-parameter limit.
_ID_CHUNK = 900


def month_start(day: date) -> date:
    return day.replace(day=1)


def next_month(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def previous_month(month: date) -> date:
    return (month.replace(day=1) - timedelta(days=1)).replace(day=1)


def cohorts() -> list[tuple[str, str]]:
    """Every (subject, level) that gets a list: Math has four levels, English three."""
    return [
        (subject, level)
        for subject, _ in AssessmentSet.SUBJECT_CHOICES
        for level in AssessmentSet.allowed_levels_for_subject(subject)
    ]


def _local_midnight(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day, time.min), timezone.get_current_timezone())


def is_blank_answer(answer: object) -> bool:
    if answer is None:
        return True
    if isinstance(answer, str):
        return not answer.strip()
    if isinstance(answer, (list, dict)):
        return not answer
    return False


@dataclass
class _Tally:
    answers: int = 0
    correct: int = 0
    #: question id → answers, to pick the copy of a bank question that was answered most.
    per_question: dict[int, int] = field(default_factory=dict)

    def add(self, question_id: int, is_correct: bool) -> None:
        self.answers += 1
        self.correct += 1 if is_correct else 0
        self.per_question[question_id] = self.per_question.get(question_id, 0) + 1

    @property
    def question_id(self) -> int:
        return min(self.per_question, key=lambda qid: (-self.per_question[qid], qid))


@dataclass(frozen=True)
class RankedQuestion:
    question_id: int
    answers: int
    correct: int


def rank_questions(stats_from: date, stats_until: date) -> dict[tuple[str, str], list[RankedQuestion]]:
    """Every cohort's ranked list (already cut to ``POOL_SIZE``) from one pass over the answers."""
    reported = set(
        QuestionErrorReport.objects.filter(
            system=QuestionErrorReport.SYSTEM_ASSESSMENT, status__in=OPEN_REPORT_STATUSES
        ).values_list("question_id", flat=True)
    )
    in_month = AssessmentAttempt.objects.filter(
        status=AssessmentAttempt.STATUS_GRADED,
        submitted_at__gte=_local_midnight(stats_from),
        submitted_at__lt=_local_midnight(stats_until),
    )
    homework_ids = list(in_month.values_list("homework_id", flat=True).distinct())
    first_ids = set(_first_counted_attempts(homework_ids))
    attempt_ids = [pk for pk in in_month.values_list("id", flat=True) if pk in first_ids]

    tallies: dict[tuple[str, str], dict[tuple[str, int], _Tally]] = {}
    for start in range(0, len(attempt_ids), _ID_CHUNK):
        rows = (
            AssessmentAnswer.objects.filter(
                attempt_id__in=attempt_ids[start:start + _ID_CHUNK],
                is_correct__isnull=False,
                question__is_active=True,
                question__assessment_set__is_active=True,
            )
            .exclude(attempt__homework__classroom__level="")
            .values_list(
                "question_id",
                "question__bank_question_id",
                "question__assessment_set__subject",
                "attempt__homework__classroom__level",
                "answer",
                "is_correct",
            )
        )
        for question_id, bank_id, subject, level, answer, is_correct in rows:
            if question_id in reported or is_blank_answer(answer):
                continue
            if level not in AssessmentSet.allowed_levels_for_subject(subject):
                continue
            key = ("bank", bank_id) if bank_id else ("question", question_id)
            bucket = tallies.setdefault((subject, level), {})
            bucket.setdefault(key, _Tally()).add(question_id, bool(is_correct))

    ranked: dict[tuple[str, str], list[RankedQuestion]] = {}
    for cohort, bucket in tallies.items():
        candidates = [
            RankedQuestion(question_id=t.question_id, answers=t.answers, correct=t.correct)
            for t in bucket.values()
            if t.answers >= MIN_ANSWERS
        ]
        candidates.sort(key=lambda r: (Fraction(r.correct, r.answers), -r.answers, r.question_id))
        ranked[cohort] = candidates[:POOL_SIZE]
    return ranked


def _write_items(pool: DailyQuestionPool, ranked: list[RankedQuestion]) -> None:
    DailyQuestionPoolItem.objects.bulk_create(
        DailyQuestionPoolItem(
            pool=pool,
            question_id=r.question_id,
            rank=position,
            answers_count=r.answers,
            correct_count=r.correct,
        )
        for position, r in enumerate(ranked, start=1)
    )


def build_pools(month: date, *, rebuild: bool = False) -> list[DailyQuestionPool]:
    """Every cohort's list for ``month``. Existing lists are kept unless ``rebuild``.

    A cohort with nothing to rank still gets its (empty) pool row: "built, and there was
    nothing" is an answer, and without the row every card opened that month would re-run the
    whole ranking to find nothing again.

    A rebuild replaces the list but keeps the pool row, so what students were already dealt
    this month stays attached to it.
    """
    month = month_start(month)
    existing = {
        (p.subject, p.level): p for p in DailyQuestionPool.objects.filter(month=month)
    }
    todo = [c for c in cohorts() if rebuild or c not in existing]
    if not todo:
        return list(existing.values())

    stats_from, stats_until = previous_month(month), month
    ranked = rank_questions(stats_from, stats_until)
    for subject, level in todo:
        items = ranked.get((subject, level), [])
        pool = existing.get((subject, level))
        try:
            with transaction.atomic():
                if pool is None:
                    pool = DailyQuestionPool.objects.create(
                        month=month, subject=subject, level=level,
                        source=DailyQuestionPool.SOURCE_PREVIOUS_MONTH,
                        stats_from=stats_from, stats_until=stats_until,
                    )
                else:
                    pool.items.all().delete()
                    pool.stats_from, pool.stats_until = stats_from, stats_until
                    pool.rebuilt_at = timezone.now()
                    pool.save(update_fields=["stats_from", "stats_until", "rebuilt_at"])
                _write_items(pool, items)
        except IntegrityError:
            # Another worker built this cohort between our read and our write. Theirs stands.
            pool = DailyQuestionPool.objects.get(month=month, subject=subject, level=level)
        existing[(subject, level)] = pool
        logger.info("daily question pool %s: %d questions", pool, len(items))
    return list(existing.values())


def pool_for(month: date, subject: str, level: str) -> DailyQuestionPool:
    """The cohort's list for ``month``, building the month's lists first if nobody has yet.

    The 1st-of-the-month beat task is the intended builder. This is what keeps the card
    working when that task did not run — celery beat on this server has hung silently before.
    """
    month = month_start(month)
    pool = DailyQuestionPool.objects.filter(month=month, subject=subject, level=level).first()
    if pool is not None:
        return pool
    build_pools(month)
    return DailyQuestionPool.objects.get(month=month, subject=subject, level=level)
