"""Item analysis — the questions a class got wrong often enough to be worth a lesson.

The school owner's rule, in their words: *"Assessmentlarda bitta savolda agar 25% yoki undan
ko'p o'quvchi xato qilgan bo'lsa, ularni analiz qilish shart"* — when a quarter or more of the
students got a single question wrong, the teacher must go and analyse that question. So the
whole job of this module is to hand a teacher a short, RANKED, actionable list of exactly
those questions, each row carrying enough context to act on without asking the API a second
question: the prompt, which set it came from, where in that set it sits, how many students got
it wrong, and the rate.

Five counting rules, none of them obvious, all of them load-bearing.

**The denominator is "graded", not "assigned".** A skipped question leaves NO
``AssessmentAnswer`` row at all — the runner writes a row when a student answers, never when
they merely see the question. There is no stored difference between "saw it and skipped it"
and "ran out of time before reaching it", and manufacturing one by counting the roster would
turn a class that ran short of time into a class that got the question wrong. The payload
says ``denominator: "graded"`` out loud so nothing downstream has to guess.

**Ungraded is its own number — neither a wrong answer nor part of the denominator.**
``AssessmentAnswer.is_correct`` is nullable: ``True`` correct, ``False`` wrong, ``NULL`` not
scored yet — grading runs in a Celery worker (``grading_service.grade_attempt``), so a queued
or failed job leaves NULLs behind. Folding NULL into wrong would mint error rates out of a
stuck worker. Leaving it in the denominator is the subtler mistake and was the first thing
this module got wrong: it dilutes the rate downwards, and this rate exists to trip a 25%
threshold, so a question the class genuinely failed could sit under the line and never be
flagged. Both ``students_answered`` (everyone who wrote something) and ``ungraded`` stay on
the row, so a rate resting on thin grading is visible instead of merely correct.

**One verdict per student, taken from their FIRST counted attempt.** The unique constraint on
``AssessmentAttempt`` is partial (IN_PROGRESS only), so a student can hold several
SUBMITTED/GRADED attempts on one homework, and the retry path re-serves exactly the questions
they previously got wrong. A later attempt is therefore not a fresh sample of the class, it is
a sample of the class's mistakes: counting rows — or letting the newest verdict win — would let
the very questions this report exists to find quietly repair themselves. The first attempt is
the only unbiased sample, and it is the same rule the pastpaper item analysis follows.

**Pooled, never a mean of means.** A breakdown row's error rate is
``sum(wrong) / sum(answered)`` across its questions, not the average of their percentages. A
question two students answered must not weigh as much as one thirty students answered.

**Students who have since left the classroom still count.** This is a question about the
QUESTION, not about the current roster: their answer was a real answer to it. Dropping them
would silently change the numbers every time a teacher tidies up a class list.

## Inside one homework, after its deadline

The same analysis is also served *per homework* — the owner's second sentence about it:
*"assessment va pastpaper statisticslar har homework deadline tugaganda o'sha homeworkning
ichida ko'rinib turishi kerak"*. ``build_homework_item_analysis`` narrows to the assessment
sets one ``classes.Assignment`` carries and gates the whole payload on that assignment's
``due_at`` — see ``homework_deadline_block`` for the three states and why "not yet" is a 200.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field

from django.utils import timezone
from django.utils.html import strip_tags

from access.services import is_global_scope_staff
from classes.models import Classroom, ClassroomMembership

from .models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    HomeworkAssignment,
)

#: The owner's line in the sand, as a percentage of the students who answered.
DEFAULT_THRESHOLD = 25.0
#: A caller may retune it, but not to nonsense: 0 would flag every question a class got
#: perfectly right, and anything over 100 flags nothing at all.
MIN_THRESHOLD = 1.0
MAX_THRESHOLD = 100.0

#: How much of the prompt travels with each row. Enough to recognise the question on a list;
#: short enough that a hundred rows are still one small response.
PROMPT_CHARS = 200

#: Only terminal work counts. An IN_PROGRESS attempt is a student mid-thought and an
#: ABANDONED one is a student who walked away — neither is evidence about the question.
COUNTED_ATTEMPT_STATUSES = (
    AssessmentAttempt.STATUS_SUBMITTED,
    AssessmentAttempt.STATUS_GRADED,
)

#: The three things a homework's deadline can be. ``open`` is the only one that hides the
#: numbers; see ``homework_deadline_block``.
HOMEWORK_CLOSED = "closed"
HOMEWORK_OPEN = "open"
HOMEWORK_NO_DEADLINE = "no_deadline"

#: What an untagged question is called in the skill/domain breakdowns. Spelled exactly as
#: ``classes.pastpaper_report.UNCLASSIFIED`` spells it, so the two reports do not invent two
#: different words for the same absence. It is never folded into a real skill row.
UNTAGGED = "Untagged"

_QUESTION_TYPE_LABELS = dict(AssessmentQuestion.TYPE_CHOICES)
_SUBJECT_LABELS = dict(Classroom.SUBJECT_CHOICES)
_LEVEL_LABELS = dict(Classroom.LEVEL_CHOICES)

_WHITESPACE = re.compile(r"\s+")


class UnknownAssessmentSet(ValueError):
    """The requested set is not assigned to that classroom.

    Raised rather than returning an empty analysis on purpose. A teacher who followed a stale
    link deserves to be told the set is not here; an empty page would read as "nobody got
    anything wrong", which is the opposite of the truth.
    """


def parse_threshold(raw: object) -> float:
    """The caller's threshold, clamped to 1..100. Raises ``ValueError`` on junk.

    Clamping rather than rejecting an out-of-range number: ``?threshold=0`` is a teacher
    asking for "show me everything", and answering that with a 400 helps nobody. Text that
    is not a number at all is a different thing — that is a broken caller, and it gets an
    error instead of a silent default that would hand back the wrong report.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return DEFAULT_THRESHOLD
    value = float(raw)  # ValueError propagates to the caller
    return max(MIN_THRESHOLD, min(MAX_THRESHOLD, value))


def homework_deadline_block(assignment) -> dict:
    """One homework's deadline, as the three states a page has to draw differently.

    The owner's condition for showing item analysis inside a homework is *"deadline
    tugaganda"* — once the deadline has finished. So:

    * ``closed`` — ``due_at`` is set and has arrived. The numbers show.
    * ``open`` — ``due_at`` is set and is still ahead. **This is the only locked state.**
      Every question row, prompt, answer key and error rate is withheld: a student who can
      still hand the work in must not be able to read which questions the class got wrong,
      and a teacher's screen is not a private channel — it is projected, screenshotted and
      shared. The endpoint answers **200 with ``locked: true``, never 403**, because "the
      deadline has not passed yet" is a state of the homework, not a failure of the request,
      and a 403 renders as an error page. "Locked", "empty" and "broken" are three different
      screens in this product and each one has to be reachable from the payload alone.
    * ``no_deadline`` — ``due_at`` is NULL (the column is nullable and plenty of live rows
      use it). Not locked: the owner's condition can never arrive for such a homework, and
      withholding the analysis forever would be a worse answer than showing it with the
      state saying the homework is still open and the figures cover whoever has handed in.

    ``due_at`` exactly equal to now counts as arrived — the deadline is the instant the
    homework closes, not the instant after it.

    The comparison is ``timezone.now()``, server side. The reader's device clock is not
    evidence about a deadline; a phone set a day forward would otherwise unlock a homework
    that is still open.

    This is a ``classes.Assignment`` concept and its natural home would be ``classes/``.
    It lives here because both item-analysis modules — assessments and past papers — have to
    agree on it exactly, and a second copy of a rule that decides what is visible is the bug
    class this codebase keeps paying for (three separate classroom whitelists, two answer
    mappers). ``exams.pastpaper_item_analysis`` imports this rather than restating it.
    """
    due_at = assignment.due_at
    if due_at is None:
        state, locked = HOMEWORK_NO_DEADLINE, False
    elif due_at <= timezone.now():
        state, locked = HOMEWORK_CLOSED, False
    else:
        state, locked = HOMEWORK_OPEN, True
    return {
        "id": assignment.pk,
        "title": assignment.title,
        # A datetime, rendered by DRF's encoder as an ISO-8601 string with a ``Z``. The
        # page needs the instant, not a pre-formatted string in the server's idea of a
        # locale, and ``None`` is a real value here rather than a missing one.
        "due_at": due_at,
        "state": state,
        "locked": locked,
    }


def teacher_classroom_ids(user) -> set[int] | None:
    """Classroom ids this user may analyse. ``None`` means every classroom.

    The corrected version of the scoping block in ``views_review.TeacherSubmissionQueueView``,
    which matches ``role=ROLE_TEACHER`` alone and never looks at ``status``. Two bugs fall out
    of that, in opposite directions: a classroom OWNER, a legacy ADMIN or a TA sees NOTHING —
    their membership row carries a different role — and a teacher who was REMOVED from the
    class still matches, because a removal here is a soft delete (``status=REMOVED``), not a
    deleted row. ``STAFF_ROLES`` and ``NON_REMOVED_STATUSES`` are the canonical sets for both
    halves of that question; ``classes.models`` asks that they be referenced rather than
    re-spelled inline.

    ``Classroom.teacher`` is unioned in because it is the single-FK owner of the class and is
    not guaranteed to have a membership row of its own.
    """
    if is_global_scope_staff(user):
        return None
    return set(
        Classroom.objects.filter(teacher=user).values_list("id", flat=True)
    ) | set(
        ClassroomMembership.objects.filter(
            user=user,
            role__in=ClassroomMembership.STAFF_ROLES,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        ).values_list("classroom_id", flat=True)
    )


@dataclass(frozen=True)
class ItemTally:
    """One question's verdicts, counted once per student.

    ``students_answered`` counts everyone who wrote something; ``students_graded`` counts
    the ones a verdict actually came back for. The rate is over the second, and both are
    reported, so a question resting on half-graded work says so.
    """

    correct: int = 0
    wrong: int = 0
    ungraded: int = 0

    @property
    def students_answered(self) -> int:
        return self.correct + self.wrong + self.ungraded

    @property
    def students_graded(self) -> int:
        return self.correct + self.wrong

    @property
    def error_rate(self) -> float | None:
        """Percent of GRADED answers that were wrong, or ``None`` when none are graded yet.

        The denominator excludes ``ungraded`` on purpose. Grading is asynchronous — a
        submitted attempt waits on Celery, and a broker outage leaves ``is_correct`` NULL for
        as long as it lasts. Dividing a real wrong-count by a partly-imaginary cohort errs in
        one direction only: downwards. That matters more here than it would anywhere else,
        because this number exists to trip a 25% threshold — a question the class genuinely
        failed would slip under the line and never be flagged, which is the exact failure
        this report was built to prevent. ``students_answered`` and ``ungraded`` both stay in
        the payload, so a rate resting on thin grading is visible rather than merely correct.

        ``None``, never ``0.0``. An empty denominator is "we do not know yet", and a question
        nobody has reached is not a question everybody got right.
        """
        graded = self.students_graded
        if not graded:
            return None
        return round(100.0 * self.wrong / graded, 1)

    def needs_analysis(self, threshold: float) -> bool:
        rate = self.error_rate
        return rate is not None and rate >= threshold


@dataclass
class _Group:
    """A breakdown bucket. Pooled across its questions — never a mean of percentages."""

    key: object
    label: str
    questions: int = 0
    students_answered: int = 0
    students_graded: int = 0
    students_wrong: int = 0
    needs_analysis_count: int = 0
    #: Untagged sorts last whatever its rate: it is a disclosure, not a thing to go and teach.
    is_untagged: bool = False

    def add(self, tally: ItemTally, flagged: bool) -> None:
        self.questions += 1
        self.students_answered += tally.students_answered
        self.students_graded += tally.students_graded
        self.students_wrong += tally.wrong
        if flagged:
            self.needs_analysis_count += 1

    @property
    def error_rate(self) -> float | None:
        """Pooled over the bucket's graded answers — the same denominator ``ItemTally`` uses,
        for the same reason, and never a mean of the questions' percentages."""
        if not self.students_graded:
            return None
        return round(100.0 * self.students_wrong / self.students_graded, 1)

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "questions": self.questions,
            "students_answered": self.students_answered,
            "students_graded": self.students_graded,
            "students_wrong": self.students_wrong,
            "error_rate": self.error_rate,
            "needs_analysis_count": self.needs_analysis_count,
        }


@dataclass
class _Buckets:
    """Insertion-ordered group accumulator, so ties keep a stable order before sorting."""

    groups: dict = field(default_factory=dict)

    def bucket(self, key: object, label: str, *, untagged: bool = False) -> _Group:
        group = self.groups.get(key)
        if group is None:
            group = _Group(key=key, label=label, is_untagged=untagged)
            self.groups[key] = group
        return group

    def sorted_dicts(self) -> list[dict]:
        return [g.as_dict() for g in sorted(self.groups.values(), key=_group_sort_key)]


def _group_sort_key(group: _Group):
    """Worst first, ``None`` last, Untagged last of all, then alphabetical."""
    rate = group.error_rate
    return (1 if group.is_untagged else 0, rate is None, -(rate or 0.0), group.label)


def _row_sort_key(row: dict):
    """Worst first, ``None`` last, then the set and the position inside it."""
    rate = row["error_rate"]
    return (rate is None, -(rate or 0.0), -row["students_wrong"], row["set"]["title"], row["position"])


def _excerpt(text: str, limit: int = PROMPT_CHARS) -> tuple[str, bool]:
    """A plain-text opening of the prompt, and whether it was cut.

    Tags are stripped rather than carried: prompts are authored as rich text, and slicing
    markup at 200 characters produces an unclosed tag that a renderer has to guess about.
    An excerpt is for recognising the question in a list, so plain text is the honest form
    of it — the full prompt is a click away in the builder.
    """
    plain = _WHITESPACE.sub(" ", html.unescape(strip_tags(text or ""))).strip()
    if len(plain) <= limit:
        return plain, False
    cut = plain[:limit].rstrip()
    # Prefer a word boundary, but only when one is near the end — a long unbroken token
    # must not shrink the excerpt to nothing.
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space].rstrip()
    return f"{cut}…", True


def _first_counted_attempts(homework_ids: list[int]) -> dict[int, int]:
    """``{attempt_id: student_id}`` — one attempt per (homework, student): their first.

    Ordered in Python, not in SQL, on purpose: ``submitted_at`` is nullable and the two
    backends this project runs on disagree about where NULLs sort (SQLite first, Postgres
    last), which would silently pick a different attempt in tests than in production.
    ``started_at`` has a default and is never NULL, so it is the fallback key.
    """
    rows = AssessmentAttempt.objects.filter(
        homework_id__in=homework_ids,
        status__in=COUNTED_ATTEMPT_STATUSES,
    ).values_list("id", "student_id", "homework_id", "submitted_at", "started_at")

    first: dict[tuple[int, int], tuple] = {}
    for attempt_id, student_id, homework_id, submitted_at, started_at in rows:
        key = (homework_id, student_id)
        rank = (submitted_at or started_at, attempt_id)
        current = first.get(key)
        if current is None or rank < current[0]:
            first[key] = (rank, attempt_id, student_id)
    return {attempt_id: student_id for _rank, attempt_id, student_id in first.values()}


def _verdicts(attempt_students: dict[int, int]) -> dict[int, dict[int, bool | None]]:
    """``{question_id: {student_id: is_correct}}`` over the counted attempts only.

    Keyed by student rather than accumulated as counters so "distinct students" is literal
    rather than something the arithmetic has to be trusted to preserve.
    """
    per_question: dict[int, dict[int, bool | None]] = {}
    if not attempt_students:
        return per_question
    rows = AssessmentAnswer.objects.filter(
        attempt_id__in=list(attempt_students.keys())
    ).values_list("attempt_id", "question_id", "is_correct")
    for attempt_id, question_id, is_correct in rows:
        student_id = attempt_students.get(attempt_id)
        if student_id is None:  # pragma: no cover - defensive
            continue
        per_question.setdefault(question_id, {}).setdefault(student_id, is_correct)
    return per_question


def _tally_for(verdicts: dict[int, bool | None]) -> ItemTally:
    correct = sum(1 for v in verdicts.values() if v is True)
    wrong = sum(1 for v in verdicts.values() if v is False)
    ungraded = sum(1 for v in verdicts.values() if v is None)
    return ItemTally(correct=correct, wrong=wrong, ungraded=ungraded)


def _taxonomy_for(question: AssessmentQuestion) -> tuple[object, str, object, str]:
    """``(skill_id, skill_name, domain_id, domain_name)`` for one question, via the bank.

    ``AssessmentQuestion`` carries no taxonomy of its own; the SAT skill and domain exist
    only on the linked ``questionbank.BankQuestion``, and that FK is nullable. Domain is read
    from the bank row directly (it stores its own ``domain`` FK) and falls back to the skill's
    domain, so a question tagged with a skill but not a domain still lands in the right place.
    """
    bank = question.bank_question
    if bank is None:
        return None, "", None, ""
    skill = bank.skill
    domain = bank.domain or (skill.domain if skill else None)
    return (
        bank.skill_id,
        skill.name if skill else "",
        domain.id if domain else None,
        domain.name if domain else "",
    )


def _classroom_block(classroom: Classroom) -> dict:
    """The classroom header every form of this report carries, spelled once."""
    return {
        "id": classroom.id,
        "name": classroom.name,
        "subject": classroom.subject,
        "subject_label": _SUBJECT_LABELS.get(classroom.subject, classroom.subject),
        "level": classroom.level or None,
        "level_label": _LEVEL_LABELS.get(classroom.level) if classroom.level else None,
    }


def build_item_analysis(
    *,
    classroom: Classroom,
    assessment_set_id: int | None = None,
    homework_ids: list[int] | None = None,
    threshold: float = DEFAULT_THRESHOLD,
) -> dict:
    """Everything a teacher needs to act on one classroom's wrong answers.

    The flagged questions come back FIRST, under ``needs_analysis``, so the caller never has
    to filter to find the thing the owner's rule is about; ``questions`` then carries every
    question in the same worst-first order.

    ``assessment_set_id`` and ``homework_ids`` are two alternative narrowings and the view
    never passes both. They differ in what an empty result means, which is the whole point:
    a ``set`` the classroom was never assigned is a stale link and raises, whereas a homework
    that simply carries no assessments is an ordinary, correct, empty answer — see
    ``build_homework_item_analysis``.
    """
    homeworks = list(
        HomeworkAssignment.objects.filter(classroom=classroom)
        .select_related("assessment_set")
        .order_by("id")
    )
    if assessment_set_id is not None:
        scoped = [hw for hw in homeworks if hw.assessment_set_id == assessment_set_id]
        if not scoped:
            raise UnknownAssessmentSet(
                "That assessment set is not assigned to this classroom."
            )
        homeworks = scoped
    if homework_ids is not None:
        # Intersected with this classroom's rows rather than queried on their own: a
        # ``HomeworkAssignment`` whose ``classroom`` has drifted from its assignment's is
        # not this classroom's work, and this is the direction that errs towards showing
        # less.
        wanted = set(homework_ids)
        homeworks = [hw for hw in homeworks if hw.id in wanted]

    set_ids = {hw.assessment_set_id for hw in homeworks}
    attempt_students = _first_counted_attempts([hw.id for hw in homeworks])
    verdicts = _verdicts(attempt_students)

    questions = list(
        AssessmentQuestion.objects.filter(assessment_set_id__in=set_ids, is_active=True)
        .select_related(
            "assessment_set",
            "bank_question",
            "bank_question__domain",
            "bank_question__skill",
            "bank_question__skill__domain",
        )
        .order_by("assessment_set_id", "order", "id")
    )

    by_type = _Buckets()
    by_skill = _Buckets()
    by_domain = _Buckets()

    rows: list[dict] = []
    positions: dict[int, int] = {}
    linked = 0
    for question in questions:
        aset = question.assessment_set
        positions[aset.id] = positions.get(aset.id, 0) + 1
        tally = _tally_for(verdicts.get(question.id, {}))
        flagged = tally.needs_analysis(threshold)
        prompt, truncated = _excerpt(question.prompt)
        skill_id, skill_name, domain_id, domain_name = _taxonomy_for(question)
        if question.bank_question_id:
            linked += 1

        rows.append(
            {
                "question_id": question.id,
                "order": question.order,
                "position": positions[aset.id],
                "prompt": prompt,
                "prompt_truncated": truncated,
                "question_type": question.question_type,
                "question_type_label": _QUESTION_TYPE_LABELS.get(
                    question.question_type, question.question_type
                ),
                "set": {
                    "id": aset.id,
                    "title": aset.title,
                    "subject": aset.subject,
                },
                "students_answered": tally.students_answered,
                "students_graded": tally.students_graded,
                "students_correct": tally.correct,
                "students_wrong": tally.wrong,
                "ungraded": tally.ungraded,
                "error_rate": tally.error_rate,
                "needs_analysis": flagged,
                "skill": skill_name or None,
                "domain": domain_name or None,
            }
        )

        by_type.bucket(
            question.question_type,
            _QUESTION_TYPE_LABELS.get(question.question_type, question.question_type),
        ).add(tally, flagged)
        if skill_id or skill_name:
            by_skill.bucket(skill_id or f"name:{skill_name}", skill_name).add(tally, flagged)
        else:
            by_skill.bucket("untagged", UNTAGGED, untagged=True).add(tally, flagged)
        if domain_id or domain_name:
            by_domain.bucket(domain_id or f"name:{domain_name}", domain_name).add(tally, flagged)
        else:
            by_domain.bucket("untagged", UNTAGGED, untagged=True).add(tally, flagged)

    rows.sort(key=_row_sort_key)
    flagged_rows = [r for r in rows if r["needs_analysis"]]

    # "There is nothing here" has two different reasons and they must not share a sentence.
    # Narrowed to a homework, an empty result means that homework carries no assessments —
    # the classroom may be full of them.
    empty_note = (
        "This homework has no assessments attached."
        if homework_ids is not None
        else "This classroom has no assessment questions yet."
    )

    scoped_question_ids = {q.id for q in questions}
    retired = len([qid for qid in verdicts if qid not in scoped_question_ids])

    return {
        "classroom": _classroom_block(classroom),
        # Always present so a caller can read it unconditionally; only the per-homework form
        # fills it in (``build_homework_item_analysis`` overwrites this). The standalone
        # question-analysis page spans a whole classroom and belongs to no one homework.
        "homework": None,
        "threshold": threshold,
        # What ``error_rate`` is a percentage OF: answers with a verdict back. A skipped
        # question writes no answer row, so a student who never reached one is in no
        # denominator here; an answer still queued for grading is in none either.
        "denominator": "graded",
        "counting_rule": "first submitted or graded attempt per student, counted once",
        "summary": {
            "questions_total": len(questions),
            # A question with answers but no verdicts yet is NOT analysed — it has no rate.
            "questions_analysed": sum(1 for r in rows if r["students_graded"] > 0),
            "questions_awaiting_grading": sum(
                1 for r in rows if r["students_graded"] == 0 and r["ungraded"] > 0
            ),
            "questions_flagged": len(flagged_rows),
            "students_counted": len(set(attempt_students.values())),
            "attempts_counted": len(attempt_students),
            "sets": len(set_ids),
        },
        "taxonomy_coverage": _coverage(linked, len(questions), empty_note=empty_note),
        # Answers whose question has since been deactivated in the builder. They are excluded
        # from every number above; saying how many is cheaper than a teacher wondering why the
        # totals do not match a student's review page.
        "excluded": {"retired_questions": retired},
        "needs_analysis": flagged_rows,
        "questions": rows,
        "by_question_type": by_type.sorted_dicts(),
        # Skill and domain exist only through the nullable bank link. With no coverage at all
        # the only possible grouping is one giant "Untagged" row, which looks like an analysis
        # and contains none — so the honest answer is an empty list plus the note below.
        "by_skill": by_skill.sorted_dicts() if linked else [],
        "by_domain": by_domain.sorted_dicts() if linked else [],
        "sets": [
            {
                "id": hw.assessment_set_id,
                "title": hw.assessment_set.title,
                "subject": hw.assessment_set.subject,
            }
            for hw in homeworks
        ],
    }


def build_homework_item_analysis(
    *,
    assignment,
    threshold: float = DEFAULT_THRESHOLD,
) -> dict:
    """The same analysis, narrowed to one homework and gated on its deadline.

    Two things are different from the classroom-wide form and both are load-bearing.

    **The scope is the assignment's own ``HomeworkAssignment`` rows, all of them.**
    ``HomeworkAssignment.assignment`` is a plain FK, not a OneToOne — one homework may bundle
    several assessment sets, and the constraint that was dropped to allow that is named in
    ``assessments/models.py``. Analysing only the first would quietly report on part of the
    homework while looking like it reported on all of it. The ``sets`` list in the payload
    names every one of them, so the page can say which sets these numbers came from.

    **A locked homework returns almost nothing.** Not a trimmed report — a payload that
    physically does not contain a prompt, an answer key, an error rate or a question row, so
    there is no future field to leak through and nothing for a devtools tab to find. See
    ``homework_deadline_block`` for why that is a 200 and not a 403.

    An assignment carrying no assessments at all is an ordinary empty result: the caller
    simply does not draw this half. It is not an error, and ``taxonomy_coverage.note`` says
    which kind of empty it is.
    """
    homework = homework_deadline_block(assignment)
    classroom = assignment.classroom

    if homework["locked"]:
        return {
            "classroom": _classroom_block(classroom),
            "homework": homework,
            "threshold": threshold,
        }

    homework_ids = list(
        HomeworkAssignment.objects.filter(assignment=assignment).values_list("id", flat=True)
    )
    payload = build_item_analysis(
        classroom=classroom, homework_ids=homework_ids, threshold=threshold
    )
    payload["homework"] = homework
    return payload


def _coverage(
    linked: int,
    total: int,
    *,
    empty_note: str = "This classroom has no assessment questions yet.",
) -> dict:
    """How much of this classroom's content can be grouped by SAT skill, and a plain note.

    The note is not decoration. Nothing in production links assessment questions to the bank
    yet, so the skill and domain breakdowns are usually empty, and an empty chart with no
    explanation reads as a bug. ``empty_note`` exists for the same reason one step further
    out: narrowed to a single homework, "no questions" means something else again, and the
    caller is the only one who knows which emptiness this is.
    """
    if not total:
        note = empty_note
    elif linked == 0:
        note = (
            "No question here is linked to the question bank, so there is no SAT skill or "
            "domain to group by. The breakdown by question type below covers every question."
        )
    elif linked < total:
        note = (
            f"{total - linked} of {total} questions are not linked to the question bank; "
            f"they are grouped under {UNTAGGED}."
        )
    else:
        note = ""
    return {
        "linked": linked,
        "total": total,
        "rate": round(100.0 * linked / total, 1) if total else None,
        "note": note,
    }
