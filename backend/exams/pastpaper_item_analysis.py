"""Which past-paper questions a class actually got wrong — and what those questions have in common.

The school's rule, in the owner's words: *"Past paperda bitta savolda agar 25% yoki undan
ko'p o'quvchi xato qilgan bo'lsa, ularni analiz qilish shart va savol turlari boyicha
statistika chiqishi kerak"* — any question a quarter of the class got wrong is re-taught, and
the sheet must also break the paper down by question type. So this module produces two things
from one pass: a flagged question list a teacher can act on directly, and the by-type
statistics that say whether the misses are a topic or an accident.

**There is no per-question result table for a past paper.** A midterm freezes
``MidtermQuestionResult`` at scoring time; a ``TestAttempt`` stores ``module_answers`` and one
scalar score, and correctness is computed at read time (``TestAttempt.get_module_results``).
Aggregation therefore happens here, in Python, over the recorded answer blobs — and the
grading atom is always ``Question.check_answer``, never a re-implementation: grid-ins compare
numerically against comma-separated variants within a tolerance, so ``.5``, ``0.50`` and
``1/2`` are one answer, and any local string compare would mark two of those wrong.

## The recorded data is not clean, and every defect pushes the error rate UP

An inflated error rate is not a harmless rounding problem: it sends a teacher to re-teach
material the class already knew, on a list that looks authoritative. Four rules exist purely
to keep that from happening, and each is a measured defect rather than a hypothetical:

**COPIED attempts are excluded.** Until 2026-07-21 a retried Module 1 submit could land on the
just-advanced Module 2 and finalise it with Module 1's answers (see
``exams/management/commands/audit_pastpaper_module2_skips.py``, whose ``_classify`` detection
this module reuses verbatim). 82 of 343 completed two-module past-paper attempts — 24% — carry
that signature. Their Module 2 record is not a weak performance, it is not the student's work
at all, and counting it marks every Module 2 question wrong for a quarter of the cohort. The
attempt is dropped whole, and the count is disclosed in ``data_quality.excluded``.

**Answer keys are intersected with the module's real question ids.** The same bug files
Module 1's question ids under the Module 2 key. Anything that flattens ``module_answers``
values into one list therefore counts Module 1 twice — which is exactly what the classroom
analytics' ``sat_topic_accuracy`` did before it was removed, and why numbers computed that way
must not be reused here. Looking each question up by its own id inside its own module makes
the intersection structural.

**A module nobody opened is skipped, not marked omitted.** An absent module key means the
student never reached that module; treating its questions as blank omissions would inflate
``miss_rate`` for the whole back half of the paper. A key that is present but empty is a
different event — a module submitted blank — and is counted as seen-and-omitted, because it is.

**Omitted is never folded into wrong.** A question nobody had time for is a pacing problem; a
question half the class answered incorrectly is a teaching problem. They are separate numbers
(``seen`` / ``answered`` / ``omitted`` / ``wrong`` / ``correct``), the headline ``error_rate``
divides by ``answered``, and ``miss_rate`` over ``seen`` is emitted alongside so a caller that
wants the harsher reading can have it without recomputing anything.

Two more, for weight and for trust:

**One sitting per student.** A student who sat the paper three times must not carry triple
weight, so only *one* completed sitting counts, ordered by ``completed_at`` then ``id``. It is
the first sitting that is actually **countable**, not simply the first recorded: a student
whose first sitting carries the COPIED signature falls through to their next clean one. The
two rules meet in exactly the population the copy bug created — 51 distinct students — and
consuming a student's one slot on a record nobody trusts would reject their good re-sit as a
repeat, silently shrinking the denominator of every question on the paper. Once a sitting is
counted the later ones are excluded as ``repeat_sitting``; a student whose every sitting is
copied is excluded entirely and disclosed in ``excluded.copied``. The ledger balances:
``attempts_considered == attempts_counted + copied + repeat_sitting``.

**``suspect_key``.** A wrong answer key manufactures a ~100% error rate, and this school has a
known paper with 17 of 29 keys wrong that was never corrected. Any question at or above 90%
is flagged rather than hidden — the row is real evidence, but of a broken key rather than a
misunderstood topic, and only a human can tell those apart.

**…and a suspect row is held out of every rate that is read as a topic result.** Flagging the
question and then pooling it into "Math — 50%" would put the argument above into the report
and the contradiction of it in the same payload: a breakdown row exists to be read as a
statement about a topic, and one broken key is enough to make that statement false. So every
group row, and ``totals.error_rate``, divide over the questions whose key is trustworthy, and
each says how many it held out (``suspect_key_count`` per group, ``totals.analysed`` for the
paper). Held out, never deleted: the group keeps its full ``questions`` count, a group that is
entirely suspect stays visible with an empty rate rather than vanishing, and the flagged list
itself is untouched — a suspect question is exactly the one a teacher must look at.

## Taxonomy

``question_type`` (MATH/READING/WRITING) and grid-in-vs-MCQ (``is_math_input``) are stored on
every question and always group cleanly. ``skill`` — and ``domain``, reachable only as
``skill.domain``, never stored on ``Question`` — and ``bank_question.difficulty`` are nullable:
~2000 legacy questions predate them. Untagged questions get their own bucket, labelled exactly
as the single-attempt error report labels it (``classes.pastpaper_report.UNCLASSIFIED``), and
every group list carries a ``coverage`` count so the page can say how much of the paper is
tagged instead of implying the whole of it is.

## Inside one homework, after its deadline

``build_homework_pastpaper_item_analysis`` serves the owner's second sentence about this
report — *"assessment va pastpaper statisticslar har homework deadline tugaganda o'sha
homeworkning ichida ko'rinib turishi kerak"*. It analyses the papers one ``classes.Assignment``
attaches and withholds the lot until that homework's ``due_at`` has passed. The deadline rule
itself is ``assessments.item_analysis.homework_deadline_block``, imported rather than
restated: it decides what a teacher may see, and two copies of that rule would eventually
disagree.

Pure aggregation: no DRF, no request, no permission logic. ``exams/views_item_analysis.py``
owns scoping and HTTP.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from django.db.models import F
from django.utils.html import strip_tags
from django.utils.text import Truncator

from assessments.item_analysis import homework_deadline_block
from classes.models import assignment_target_practice_test_ids
from classes.pastpaper_report import UNCLASSIFIED

from .models import PracticeTest, Question, TestAttempt

#: The owner's rule. Callers may override per request; ``clamp_threshold`` keeps it sane.
DEFAULT_THRESHOLD = 25
MIN_THRESHOLD = 1
MAX_THRESHOLD = 100

#: At or above this, a question is far likelier to have a broken answer key than a hard idea.
SUSPECT_KEY_THRESHOLD = 90.0

#: Enough stem for a teacher to recognise the question in the list without opening the paper.
STEM_MAX_CHARS = 200

#: What ``error_rate`` divides by, stated in the payload so nobody has to guess.
DENOMINATOR = "answered"

#: How many past papers one homework's analysis will actually crunch in a single request.
#: Each paper costs three queries plus a pass over every counted sitting, so the work grows
#: with the bundle, and a homework can legally attach a whole pack through
#: ``practice_test_pack_ids`` — there is no ceiling on that in the model. Eight is a judgement
#: call, not a measurement: it clears a two-module paper and a normal multi-paper homework
#: with room to spare, and stops one pathological assignment from turning a page load into a
#: report generator. When the cap bites the payload SAYS SO (``papers_truncated``, plus a
#: sentence in ``truncation_note`` pointing at the standalone page, which does one paper at a
#: time) — a silently short list is the same lie as a wrong number.
MAX_PAPERS_PER_HOMEWORK = 8


def clamp_threshold(raw) -> int:
    """Query-string threshold → an integer percentage in 1..100, falling back to the default.

    Clamped rather than rejected: a 0 threshold would flag every question including the ones
    the class aced, which is not a report, and a caller that fat-fingers ``threshold=abc``
    wants the school's rule, not a 400.
    """
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_THRESHOLD
    return max(MIN_THRESHOLD, min(MAX_THRESHOLD, value))


def _percent(numerator: int, denominator: int) -> float | None:
    """House rounding. Empty denominator is ``None`` — never ``0.0``, which reads as "perfect"."""
    if not denominator:
        return None
    return round(100.0 * numerator / denominator, 1)


def _stem(text: str) -> str:
    """A one-line preview. Question text carries markup, and raw ``<p>`` tags in a teacher's
    list are noise, so tags come out before the truncation counts characters."""
    return Truncator(" ".join(strip_tags(text or "").split())).chars(STEM_MAX_CHARS)


@dataclass
class _Item:
    """One question's cohort tally. ``seen`` counts students who were shown the module."""

    question: Question
    number: int
    module_order: int
    seen: int = 0
    answered: int = 0
    omitted: int = 0
    correct: int = 0
    wrong: int = 0

    @property
    def error_rate(self) -> float | None:
        return _percent(self.wrong, self.answered)

    @property
    def miss_rate(self) -> float | None:
        """Wrong *and* blank over everyone who saw it — the pacing-aware reading."""
        return _percent(self.wrong + self.omitted, self.seen)

    def needs_analysis(self, threshold: int) -> bool:
        rate = self.error_rate
        return rate is not None and rate >= threshold

    @property
    def suspect_key(self) -> bool:
        rate = self.error_rate
        return rate is not None and rate >= SUSPECT_KEY_THRESHOLD


@dataclass
class _Group:
    """One row of a by-type breakdown — a statement about a topic, so a broken key stays out.

    ``questions`` counts every question in the group, including the suspect ones, so a group
    that is entirely suspect is visible as such instead of vanishing from the breakdown.
    Everything the rate is read against — ``seen``/``answered``/``wrong`` and ``error_rate``
    — is pooled over the ``analysed_questions`` only, so the caption a page prints beside the
    rate ("0 wrong of 12 answers") describes the same population the rate does.

    ``needs_analysis_count`` is deliberately the other way round: it counts every flagged
    question in the group, suspect included, because that list is the teacher's work queue and
    a suspect key is the first thing on it.
    """

    key: object
    label: str
    questions: int = 0
    suspect_key_count: int = 0
    seen: int = 0
    answered: int = 0
    wrong: int = 0
    needs_analysis_count: int = 0

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "questions": self.questions,
            # Held out of the rate below — flagged for a human, not folded into a topic result.
            "suspect_key_count": self.suspect_key_count,
            "analysed_questions": self.questions - self.suspect_key_count,
            "seen": self.seen,
            "answered": self.answered,
            "wrong": self.wrong,
            # None when every question in the group is suspect: an em dash, never a 0% that
            # would read as "this class aced a topic nobody could answer".
            "error_rate": _percent(self.wrong, self.answered),
            "needs_analysis_count": self.needs_analysis_count,
        }


@dataclass
class _Selection:
    """The attempts that survived selection, and the ledger of what did not."""

    answer_blobs: list = field(default_factory=list)
    students: int = 0
    considered: int = 0
    copied: int = 0
    repeat_sitting: int = 0


def looks_copied(answers: dict, modules: list, module_question_ids: dict) -> bool:
    """The Module-2-answered-with-Module-1's-ids signature, detected as the audit command does.

    Same three guards as ``audit_pastpaper_module2_skips._classify``: fewer than two module
    keys cannot show it, a paper without both modules cannot show it, and an empty Module 2
    answer map is a blank submission rather than a copy. The runner only ever posts answers
    for the questions it is showing, so a Module 2 map whose keys are *entirely* foreign to
    Module 2 has no honest explanation.

    ``modules`` is ``[(module_id, module_order), …]``; ``module_question_ids`` maps a module
    id to its question ids **as strings**, matching the JSON keys.
    """
    if len(answers) < 2:
        return False

    m1 = next((mid for mid, order in modules if order == 1), None)
    m2 = next((mid for mid, order in modules if order == 2), None)
    if m1 is None or m2 is None:
        return False

    m2_answers = answers.get(str(m2)) or {}
    if not isinstance(m2_answers, dict) or not m2_answers:
        return False

    keys = set(m2_answers.keys())
    return bool(keys) and not (keys & module_question_ids.get(m2, set()))


def _select_attempts(practice_test, student_ids, modules, module_question_ids) -> _Selection:
    """One query for the cohort's completed sittings, then the first *countable* one each.

    Ordered ``completed_at`` then ``id`` per the contract, with NULLs last so the ordering is
    the same on Postgres and SQLite rather than backend-dependent — a legacy attempt with no
    ``completed_at`` must not silently become somebody's "first" sitting.

    A student is marked as counted only when their sitting is actually counted, never when it
    is discarded. The copy bug is the very reason a student would sit the paper again, so a
    corrupt first sitting has to fall through to the next one; marking them "seen" on the way
    past would spend their single slot on the discarded record and then reject the good re-sit
    as a repeat. A student whose every sitting is copied contributes nothing and is disclosed
    once per discarded sitting.

    Repeat sittings are still set aside without inspection, so ``excluded.copied`` counts the
    sittings that would otherwise have been analysed rather than every copied row ever
    recorded, and the ledger balances: considered == counted + copied + repeat_sitting.
    """
    selection = _Selection()
    if not student_ids:
        return selection

    rows = (
        TestAttempt.objects.filter(
            practice_test=practice_test,
            student_id__in=student_ids,
            is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED,
        )
        .order_by("student_id", F("completed_at").asc(nulls_last=True), "id")
        .values("id", "student_id", "module_answers")
    )

    counted_students: set[int] = set()
    for row in rows:
        selection.considered += 1
        if row["student_id"] in counted_students:
            selection.repeat_sitting += 1
            continue

        answers = row["module_answers"] or {}
        if not isinstance(answers, dict):
            answers = {}
        if looks_copied(answers, modules, module_question_ids):
            selection.copied += 1
            continue

        # Only now is the student's one slot spent.
        counted_students.add(row["student_id"])
        selection.answer_blobs.append(answers)

    selection.students = len(selection.answer_blobs)
    return selection


def _tally(items_by_module: dict, module_question_ids: dict, modules: list, selection: _Selection) -> None:
    """Fold every counted attempt into the per-question tallies. Pure Python, no queries."""
    for answers in selection.answer_blobs:
        for module_id, _order in modules:
            raw = answers.get(str(module_id))
            if not isinstance(raw, dict):
                # No key (or a corrupt one) means the student never opened this module.
                # Its questions were never put in front of them, so they are not omissions.
                continue

            # Explicit even though the per-question lookup below is already id-scoped: this
            # is the line that stops a foreign key set from being counted as answers.
            answered_ids = {str(key) for key in raw} & module_question_ids.get(module_id, set())

            for item in items_by_module.get(module_id, ()):
                item.seen += 1
                key = str(item.question.id)
                answer = raw.get(key) if key in answered_ids else None
                if answer is None or str(answer).strip() == "":
                    item.omitted += 1
                    continue
                item.answered += 1
                if item.question.check_answer(answer):
                    item.correct += 1
                else:
                    item.wrong += 1


# ── taxonomy resolvers ───────────────────────────────────────────────────────
# Each returns ``(key, label)`` for a question, or ``(None, UNCLASSIFIED)`` when the paper
# never carried that tag. ``None`` is the untagged marker everywhere below.

def _resolve_question_type(question: Question) -> tuple[object, str]:
    return question.question_type, question.get_question_type_display()


def _resolve_format(question: Question) -> tuple[object, str]:
    """Grid-in vs multiple choice. Stored as a boolean, so it is never untagged."""
    if question.is_math_input:
        return "GRID_IN", "Grid-in"
    return "MCQ", "Multiple choice"


def _resolve_skill(question: Question) -> tuple[object, str]:
    skill = question.skill
    if skill is None:
        return None, UNCLASSIFIED
    return skill.pk, skill.name


def _resolve_domain(question: Question) -> tuple[object, str]:
    """Domain lives on the skill, never on the question — an untagged skill has no domain."""
    skill = question.skill
    domain = getattr(skill, "domain", None) if skill is not None else None
    if domain is None:
        return None, UNCLASSIFIED
    return domain.pk, domain.name


def _resolve_difficulty(question: Question) -> tuple[object, str]:
    """Only the question bank knows difficulty, and the link is nullable and often blank."""
    bank = question.bank_question
    value = (getattr(bank, "difficulty", "") or "") if bank is not None else ""
    if not value:
        return None, UNCLASSIFIED
    return value, bank.get_difficulty_display()


def _collect(items: list, resolver, threshold: int) -> dict:
    """One breakdown: its group rows plus how much of the paper carries that tag."""
    groups: dict[object, _Group] = {}
    tagged = 0

    for item in items:
        key, label = resolver(item.question)
        if key is not None:
            tagged += 1
        group = groups.get(key)
        if group is None:
            group = groups[key] = _Group(key=key, label=label)
        group.questions += 1
        if item.suspect_key:
            # Counted in the group, held out of its rate: a ~100% row is evidence about the
            # answer key, and pooling it would state something false about the topic.
            group.suspect_key_count += 1
        else:
            group.seen += item.seen
            group.answered += item.answered
            group.wrong += item.wrong
        if item.needs_analysis(threshold):
            group.needs_analysis_count += 1

    rows = sorted(
        (g.as_dict() for g in groups.values()),
        key=lambda row: (row["error_rate"] is None, -(row["error_rate"] or 0.0), row["label"]),
    )
    return {"coverage": {"tagged": tagged, "total": len(items)}, "groups": rows}


def _question_row(item: _Item, threshold: int) -> dict:
    """Everything needed to act on the question without opening the paper."""
    question = item.question
    skill = question.skill
    domain = getattr(skill, "domain", None) if skill is not None else None
    bank = question.bank_question
    difficulty = (getattr(bank, "difficulty", "") or "") if bank is not None else ""

    return {
        "question_id": question.pk,
        # Continuous across modules: ``Question.order`` restarts at 0 in Module 2, and a
        # teacher reading "Q7" off a paper means the seventh question, not Module 2's first.
        "number": item.number,
        "module": item.module_order,
        "module_label": f"Module {item.module_order}",
        "stem": _stem(question.question_text),
        "correct_answer": (question.correct_answers or "").strip(),
        "question_type": question.question_type,
        "question_type_label": question.get_question_type_display(),
        "format": "GRID_IN" if question.is_math_input else "MCQ",
        "format_label": "Grid-in" if question.is_math_input else "Multiple choice",
        "skill_id": skill.pk if skill is not None else None,
        "skill": skill.name if skill is not None else UNCLASSIFIED,
        "domain_id": domain.pk if domain is not None else None,
        "domain": domain.name if domain is not None else UNCLASSIFIED,
        "difficulty": difficulty or None,
        "difficulty_label": bank.get_difficulty_display() if difficulty else UNCLASSIFIED,
        "seen": item.seen,
        "answered": item.answered,
        "omitted": item.omitted,
        "correct": item.correct,
        "wrong": item.wrong,
        "error_rate": item.error_rate,
        "miss_rate": item.miss_rate,
        "needs_analysis": item.needs_analysis(threshold),
        "suspect_key": item.suspect_key,
    }


def build_pastpaper_item_analysis(practice_test, student_ids, *, threshold: int = DEFAULT_THRESHOLD) -> dict:
    """Per-question item analysis of one past paper for one classroom's roster.

    ``student_ids`` is the roster — the caller decides who that is, because "the class" is a
    classroom concept and this module only knows about papers. A student on the roster who
    never sat the paper contributes nothing: unlike the midterm pass rate, an item analysis
    denominator is "students who answered this question", not "students enrolled". The roster
    size is reported anyway so the gap is visible.

    Three queries, all constant: the paper's modules, the paper's questions (with taxonomy
    joined), and the cohort's completed attempts. Everything after that is arithmetic — there
    is no query inside the per-question or per-attempt loop.
    """
    threshold = clamp_threshold(threshold)
    roster = list(dict.fromkeys(student_ids or []))

    # Read from the module rows rather than inferring from the questions: a Module 2 with no
    # questions still has to exist for the COPIED signature to be recognisable, and that is
    # precisely the shape a copy-affected paper can have.
    modules = list(practice_test.modules.order_by("module_order").values_list("id", "module_order"))

    questions = (
        Question.objects.filter(module__practice_test=practice_test)
        .select_related("module", "skill", "skill__domain", "bank_question")
        .order_by("module__module_order", "order", "id")
    )

    items: list[_Item] = []
    items_by_module: dict[int, list] = defaultdict(list)
    module_question_ids: dict[int, set[str]] = {mid: set() for mid, _order in modules}

    for number, question in enumerate(questions, start=1):
        item = _Item(question=question, number=number, module_order=question.module.module_order)
        items.append(item)
        items_by_module[question.module_id].append(item)
        module_question_ids.setdefault(question.module_id, set()).add(str(question.pk))

    selection = _select_attempts(practice_test, roster, modules, module_question_ids)
    _tally(items_by_module, module_question_ids, modules, selection)

    rows = [_question_row(item, threshold) for item in items]
    flagged = sorted(
        (row for row in rows if row["needs_analysis"]),
        key=lambda row: (-(row["error_rate"] or 0.0), -row["wrong"], row["number"]),
    )

    untagged = [item for item in items if item.question.skill_id is None]
    totals_seen = sum(item.seen for item in items)
    totals_answered = sum(item.answered for item in items)
    totals_wrong = sum(item.wrong for item in items)

    # The paper's headline rate is read the same way a breakdown row is — as a statement about
    # how the class did — so the questions whose key cannot be trusted are held out of it. The
    # raw tallies above stay whole: they describe the sitting as recorded, and the page prints
    # them beside other captions ("N answers left blank"). ``analysed`` names, in the payload,
    # exactly what ``error_rate`` divided, so the two can never be mistaken for each other.
    analysed = [item for item in items if not item.suspect_key]
    analysed_seen = sum(item.seen for item in analysed)
    analysed_answered = sum(item.answered for item in analysed)
    analysed_wrong = sum(item.wrong for item in analysed)

    return {
        "practice_test": {
            "id": practice_test.pk,
            "title": practice_test.title or practice_test.collection_name or "Past Paper",
            "collection_name": practice_test.collection_name or "",
            "subject": practice_test.subject,
            "subject_label": practice_test.get_subject_display(),
        },
        "threshold": threshold,
        # Stated, not implied: the headline rate divides by the students who answered, and
        # one sitting per student is what "students" means anywhere in this payload.
        "denominator": DENOMINATOR,
        # "Clean", not merely "first": a sitting carrying the COPIED signature is discarded and
        # the student's next sitting is considered, because that bug is why they sat it again.
        "attempt_selection": "first_clean_completed_sitting_per_student",
        # First — this is the list the rule is about.
        "needs_analysis": flagged,
        "questions": rows,
        "totals": {
            "questions": len(items),
            "seen": totals_seen,
            "answered": totals_answered,
            "omitted": sum(item.omitted for item in items),
            "correct": sum(item.correct for item in items),
            "wrong": totals_wrong,
            # Over the trustworthy questions only — see ``analysed`` for what that was.
            "error_rate": _percent(analysed_wrong, analysed_answered),
            "analysed": {
                "questions": len(analysed),
                "seen": analysed_seen,
                "answered": analysed_answered,
                "wrong": analysed_wrong,
            },
            "needs_analysis": len(flagged),
            "suspect_key": sum(1 for row in rows if row["suspect_key"]),
        },
        "groups": {
            "question_type": _collect(items, _resolve_question_type, threshold),
            "format": _collect(items, _resolve_format, threshold),
            "skill": _collect(items, _resolve_skill, threshold),
            "domain": _collect(items, _resolve_domain, threshold),
            "difficulty": _collect(items, _resolve_difficulty, threshold),
        },
        # The same two footnote numbers the single-attempt error report carries, so a page can
        # disclose untagged content identically. Here they are cohort-wide: how many questions
        # on the paper carry no skill, and how many wrong answers landed on them.
        "unclassified_total": len(untagged),
        "unclassified_wrong": sum(item.wrong for item in untagged),
        "data_quality": {
            "roster": len(roster),
            "attempts_considered": selection.considered,
            "attempts_counted": len(selection.answer_blobs),
            "students_counted": selection.students,
            "excluded": {
                # Module 2 answered with Module 1's question ids — the pre-2026-07-21 submit
                # bug. Not a weak sitting; not the student's work.
                "copied": selection.copied,
                # A second or third sitting of the same paper by the same student.
                "repeat_sitting": selection.repeat_sitting,
            },
            # Error rate at or above 90%: read the answer key before re-teaching anything.
            "suspect_key_questions": sum(1 for row in rows if row["suspect_key"]),
        },
    }


def build_homework_pastpaper_item_analysis(
    assignment, student_ids, *, threshold: int = DEFAULT_THRESHOLD
) -> dict:
    """The same analysis, for the past papers one homework carries, gated on its deadline.

    Three things are different from the single-paper form, and each one is a way of getting
    this wrong that looks fine on a screen.

    **A homework can carry several papers, so the answer is a list.** ``papers`` holds one
    complete analysis per attached paper — each entry exactly the shape
    ``build_pastpaper_item_analysis`` already returns, ``practice_test`` header included, so
    the page renders N of the same block rather than a second, thinner dialect of it. There
    is deliberately no merged "all papers" report: pooling two different papers' questions
    into one error rate would state something about a topic that neither paper's cohort
    supports, and the two papers may not even share a subject.

    **The papers come from** ``assignment_target_practice_test_ids``, **never from one
    field.** An assignment attaches past papers through four of them — ``practice_test``,
    ``practice_test_pack``, ``practice_test_ids``, ``practice_test_pack_ids`` — and reading
    any single one silently analyses part of a homework. That resolver also applies
    ``practice_scope``, so an English-only homework does not report on the Math sections of
    the pack it points at, and it returns Reading & Writing before Math, an order worth
    keeping. Its results are then filtered to ``mock_exam__isnull=True``: a mock or midterm
    section is scored, sat and repaired under different rules, and this report's counting
    would be wrong about it rather than merely unavailable.

    **No papers is an empty list, not an error.** Most homework carries assessments, or a
    link, or nothing at all; ``papers: []`` means this half of the page simply does not draw.

    Locked works exactly as it does for assessments — 200, the ``homework`` block, and no
    ``papers`` key at all. Not an empty list: "the deadline has not passed" and "there are no
    past papers here" are two different sentences and an empty list already means the second.
    """
    homework = homework_deadline_block(assignment)
    threshold = clamp_threshold(threshold)

    if homework["locked"]:
        # Nothing else. No stems, no answer keys, no rates, and no shape for a future field
        # to be added to by someone who has not read ``homework_deadline_block``.
        return {"homework": homework, "threshold": threshold}

    wanted = assignment_target_practice_test_ids(assignment)
    by_id = {
        paper.pk: paper
        for paper in PracticeTest.objects.filter(pk__in=wanted, mock_exam__isnull=True)
    }
    # ``wanted`` carries the resolver's order (Reading & Writing first); the dict does not.
    ordered = [by_id[pk] for pk in wanted if pk in by_id]
    analysed = ordered[:MAX_PAPERS_PER_HOMEWORK]
    truncated = len(ordered) > len(analysed)

    return {
        "homework": homework,
        "threshold": threshold,
        "papers": [
            build_pastpaper_item_analysis(paper, student_ids, threshold=threshold)
            for paper in analysed
        ],
        "papers_total": len(ordered),
        "papers_analysed": len(analysed),
        "papers_limit": MAX_PAPERS_PER_HOMEWORK,
        "papers_truncated": truncated,
        "truncation_note": (
            f"This homework attaches {len(ordered)} past papers; the first "
            f"{MAX_PAPERS_PER_HOMEWORK} are analysed here. The question analysis page covers "
            f"the rest one paper at a time."
            if truncated
            else ""
        ),
    }
