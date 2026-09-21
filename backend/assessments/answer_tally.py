"""Which wrong answer the class actually picked — the counting half, shared by both reports.

Both item analyses could already say that 12 of 20 students missed question 7. Neither could
say that 9 of those 12 picked C, and that is the sentence a teacher acts on: C is a misread
of the stem, B is an arithmetic slip, and they are two different lessons. The builders throw
the chosen answer away at the moment they grade it; this module is what they hand it to
instead. Pure arithmetic — no models, no queries, no request. A builder feeds it one answer
per student and gets back the payload block with the privacy rule already applied.

**Two shapes, because there are two kinds of question, and one shape flatters neither.**
A multiple-choice question has a fixed, small set of options, so the useful answer is a count
for every one of them — in the order the student saw them, with the key marked — including
the options nobody touched, because an option nobody picked is itself information. A grid-in
or short-text question has no options: a full tally of what twenty students typed is twenty
rows of noise, so the useful answer is the few WRONG answers that came up more than once.
``kind`` says which of the two a block is, so a client draws bars or a short list instead of
inferring it from which field happens to be populated.

**A tally must not name a student, and that takes two floors, not one.**

*The cohort floor,* ``MIN_RESPONSES``. On a class of four, "3 picked C" plus the gradebook
the teacher already has is every student's answer, and this is a learning center where a
homework routinely comes back from five or six of the class. So below ``MIN_RESPONSES``
answers the counts do not travel at all.

*The cell floor,* ``MIN_CELL``. A big enough cohort does not make a cell of one safe: in
``A 0 · B 9 · C 0 · D 1`` the ``1`` is one student's answer written into a table. So a cell
below ``MIN_CELL`` does not travel either — and never alone, because this block publishes
``responses`` and a single hidden cell is simply whatever the visible ones do not account
for. Small cells are held back together with one more, so what is left is a sum the reader
cannot split. The free-entry shape does the same by listing only the wrong answers that more
than one student gave; the rest are counted in ``distinct_wrong_answers``, which is a number
about the question and names nobody.

What the two floors do **not** do is hide anything from someone who could not already see
it: the teacher reading this page can open each attempt. They keep the aggregate from
spelling out an individual answer that nobody asked it for — that, and not access control,
is the whole of what they buy.

*Why suppressed rather than ranked-without-counts.* Ranking hides the arithmetic, not the
identity: on four answers the ranking IS the counts, and on one answer the option that sorts
out of its natural place is that student's answer, spelled out. The option list still travels
with the key marked — that is about the question, not about anybody — but every count comes
back ``null``.

*Why five.* It is the small-cell floor education statistics normally use, and it sits below a
real class here (8–20 students), so the rule bites on a half-returned homework rather than on
the ordinary case a teacher opens this page for.

**Four states, never two.** ``no_data`` (nobody answered), ``unreadable`` (answers were
recorded but not one of them matches an option this question offers — a defect, not a
silence), ``suppressed`` (too few answers to count out loud) and ``data`` are distinct,
because "we are not showing you this", "there is nothing to show" and "what is stored here
does not fit the question" are three different sentences and a client must be able to print
the right one. A client that drew an empty state over ``unreadable`` would be reporting
nothing where the truth is a data defect.

**An answer we cannot read is no answer.** A blank, a ``null``, a JSON blob where a letter
should be, a choice id that matches no option on the question — none of those is evidence
about what the class thought, and guessing at one would put an invented mistake on a
re-teaching list. They land in ``no_answer``, and the option form discloses separately how
many were recorded but unrecognised, because a pile of those is a data defect worth seeing.

**``no_answer`` counts a different population in each report, and the name cannot say so.**
Past papers store every counted sitting's whole module blob, so the builder knows who saw the
question and left it blank: there, ``no_answer`` is *shown it and wrote nothing*. Assessments
write an ``AssessmentAnswer`` row only when a student answers, so a student who never reached
the question leaves no trace at all; there, ``no_answer`` is only *wrote something unreadable
or blank into a row*, and the students who never got that far are invisible to it. A client
must therefore not label this field "left blank" across both reports — it is right on the
past-paper one and silently low on the assessment one. Counting it properly for assessments
needs a per-``assessment_set`` count of who sat which question, which this module cannot see;
until a builder supplies one, the field means what each builder's docstring says it means.

**The payload contract, identical for both shapes.** Every key below is present on every
block; a key that cannot apply to a shape is ``null`` rather than absent, so one TypeScript
type covers both and a missing value reads as "not applicable here" instead of "the mapper
dropped it".

``kind`` ``"options"`` | ``"answers"``
``state`` ``"data"`` | ``"suppressed"`` | ``"no_data"`` | ``"unreadable"``
``responses`` readable answers that matched this question (the share denominator)
``no_answer`` see above — a different population per report
``unrecognised`` options shape: recorded answers matching no option. answers shape: ``null``
``ungraded`` recorded answers with no verdict yet
``min_responses`` / ``min_cell`` the two floors, so a page can explain a held-back count
``options`` options shape: every option, in order, ``count``/``share`` ``null`` when held
    back. answers shape: ``[]``
``top_wrong`` answers shape: the wrong answers more than one student gave, commonest first.
    options shape: ``[]``
``distinct_wrong_answers`` answers shape: how many distinct wrong answers there were in all,
    including the ones too rare to list. options shape: ``null`` — nothing is truncated there
``note`` the sentence to print, or ``""``
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal

from django.utils.html import strip_tags

from .grading import _norm_text

#: Fewest answers a question needs before its counts are reported. See the module docstring.
MIN_RESPONSES = 5

#: Fewest students behind a single count before that count is reported. One student's answer
#: is not an aggregate. See the module docstring.
MIN_CELL = 2

#: How many wrong answers a free-entry question reports. The point is the mistakes the class
#: made in common; a long tail of one-off typos is not a lesson.
TOP_WRONG_ANSWERS = 5

#: Enough of an option to recognise it beside a count, not the whole choice.
OPTION_LABEL_CHARS = 80

#: A grid-in answer is a number. Anything much longer than this is a paste accident, and it
#: still has to fit on one line next to its count.
ANSWER_CHARS = 40

KIND_OPTIONS = "options"
KIND_ANSWERS = "answers"

STATE_DATA = "data"
STATE_SUPPRESSED = "suppressed"
STATE_NO_DATA = "no_data"
STATE_UNREADABLE = "unreadable"

_NO_DATA_NOTE = "Nobody has answered this question yet."
_SUPPRESSED_NOTE = (
    f"Fewer than {MIN_RESPONSES} students have answered this question, so the breakdown is "
    "held back — on a handful of answers a tally names the students who gave them."
)
_UNREADABLE_NOTE = (
    "Answers were recorded here, but none of them matches an option this question offers — "
    "the options were most likely re-authored after these students sat it. Worth checking "
    "the question itself before reading anything into the rest of this row."
)
_SMALL_CELL_NOTE = (
    f"Counts under {MIN_CELL} are held back: an option a single student picked would point "
    "straight at that student, so it is pooled with one more option rather than shown alone."
)
_ALL_CORRECT_NOTE = "Every answer given here matched the key."
_UNGRADED_NOTE = "These answers have not been scored yet, so there is nothing to rank."
_NO_SHARED_MISTAKE_NOTE = (
    "No wrong answer here was given by more than one student, so there is no shared mistake "
    "to re-teach — and a one-off answer is not listed on its own, because it would name the "
    "student who gave it."
)

#: What an answer may be and still be countable. A JSONField will hold anything; a list or a
#: dict where a choice should be is a defect, not a mistake a class made together.
_SCALARS = (str, int, float, bool, Decimal)


def normalise(value: object) -> str:
    """The comparison form of an answer — the grader's own, deliberately.

    Grouping answers by a rule the grader does not share is how a tally starts disagreeing
    with the verdict beside it: a choice posted as ``"b"`` would split from one posted as
    ``"B"`` and halve both counts, while the grader had already called them the same answer.
    ``assessments.grading._norm_text`` is the rule every assessment verdict already rests on
    (NFKC, case-folded, whitespace collapsed), so it is the rule this counts by. The exams
    builder grades through ``Question.check_answer``, which case-folds and strips the same
    way for the two shapes that reach here: a choice letter and a typed answer.

    Note what it deliberately does NOT do: it is a text rule, not a numeric one, so ``0.5``
    and ``0.50`` stay two entries in a free-entry ranking. That is wanted — a teacher reading
    the mistakes back wants the spelling the class actually typed — but it means the ranking
    groups by spelling, not by value, and the verdict beside it may still call both wrong for
    the same reason.
    """
    return _norm_text(value)


def _plain(text: object, limit: int) -> str:
    """Tag-free, single-line, capped. Option text is authored as rich text, and a ``<p>``
    in a teacher's list of counts is noise."""
    plain = " ".join(strip_tags("" if text is None else str(text)).split())
    if len(plain) <= limit:
        return plain
    return f"{plain[:limit].rstrip()}…"


def display_answer(value: object, limit: int = ANSWER_CHARS) -> str:
    """What the class wrote, in their own spelling. Ranked answers are quoted back to a
    teacher, so ``1/2`` stays ``1/2`` rather than becoming the grader's decimal."""
    return _plain(value, limit)


def _percent(numerator: int, denominator: int) -> float | None:
    """House rounding, and ``None`` on an empty denominator — never ``0.0``, which reads as
    a real measurement of nothing."""
    if not denominator:
        return None
    return round(100.0 * numerator / denominator, 1)


def _state(responses: int) -> str:
    if responses <= 0:
        return STATE_NO_DATA
    if responses < MIN_RESPONSES:
        return STATE_SUPPRESSED
    return STATE_DATA


@dataclass(frozen=True)
class Option:
    """One answer a student could choose between, as the tally needs it.

    ``aliases`` carries the spellings that mean this option besides its key — its own text,
    mostly, plus whatever else the grader would accept for it. A runner that posts the
    choice's text instead of its id, or a True/False question stored as ``1``, must land on
    the option rather than in ``unrecognised``; which spelling a given runner posts is not
    something this module should have an opinion about, and the grader's own list of
    acceptable spellings is the only one that cannot drift away from the verdict.
    """

    key: str
    label: str
    is_correct: bool
    aliases: tuple = ()

    @classmethod
    def build(
        cls, key: str, text: object, *, is_correct: bool, extra_aliases: tuple = ()
    ) -> "Option":
        label = _plain(text, OPTION_LABEL_CHARS)
        return cls(
            key=key,
            # An option can be an image with no text at all; its letter is then the only
            # name it has, and it is the name the student saw beside it anyway.
            label=label or key,
            is_correct=is_correct,
            aliases=((str(text),) if label else ()) + tuple(extra_aliases),
        )


@dataclass
class ResponseTally:
    """One question's answers, one per student, before the privacy rules are applied.

    Counted by normalised answer rather than by student: this is a question about the
    question, and no student id ever enters. That is not by itself a privacy guarantee —
    a count of one is still one student's answer — which is why ``MIN_RESPONSES`` and
    ``MIN_CELL`` are applied on the way out, in the two block builders below.
    """

    counts: Counter = field(default_factory=Counter)
    #: normalised answer → the spelling to quote back for it (the first one seen).
    display: dict = field(default_factory=dict)
    #: normalised answer → how many students gave it AND were marked wrong for it. Counted
    #: here rather than reconstructed later: one normalised answer can carry both verdicts
    #: (a key corrected or a tolerance widened mid-flight), and reporting its whole count as
    #: wrong would inflate exactly the mistake a teacher opens this page to check.
    wrong_counts: Counter = field(default_factory=Counter)
    no_answer: int = 0
    ungraded: int = 0

    def record(self, raw: object, *, is_correct: bool | None = None) -> None:
        """One student's answer to this question, with its verdict when there is one."""
        if not isinstance(raw, _SCALARS):
            self.no_answer += 1
            return
        key = normalise(raw)
        if not key:
            self.no_answer += 1
            return
        self.counts[key] += 1
        self.display.setdefault(key, display_answer(raw))
        if is_correct is False:
            self.wrong_counts[key] += 1
        elif is_correct is None:
            self.ungraded += 1

    def record_no_answer(self) -> None:
        """A student who was shown the question and wrote nothing."""
        self.no_answer += 1

    @property
    def responses(self) -> int:
        return sum(self.counts.values())


def _held_back_cells(counts: list) -> set:
    """Indices whose count must not travel on its own, smallest first.

    A cell under ``MIN_CELL`` is one student's answer. Hiding it by itself would not hide it:
    the block publishes ``responses``, so a lone hidden cell is exactly what the visible ones
    do not account for. So whenever anything is held back, at least two cells are — the next
    smallest comes with it, a zero included — and the reader is left with a sum across two or
    more options that cannot be split back into who picked what.
    """
    small = {index for index, count in enumerate(counts) if 0 < count < MIN_CELL}
    if not small or len(small) >= 2:
        return small
    for index in sorted(range(len(counts)), key=lambda i: (counts[i], i)):
        if index not in small:
            small.add(index)
            break
    return small


def option_block(tally: ResponseTally, options: list) -> dict:
    """The per-option counts for one multiple-choice question.

    Every option is listed whatever its count, in the order the student saw them, with the
    key marked — an option nobody picked is a fact about the class, and a list that dropped
    it would read as though it had never been offered. Below the cohort floor the rows still
    travel and every ``count`` is ``null``; above it, a count under ``MIN_CELL`` is held back
    with one more so it cannot be recovered by subtraction.
    """
    # Two passes, keys before aliases, because an option's TEXT must never claim a form that
    # is another option's KEY. On a question whose options read `A) B  B) C  C) D` a single
    # pass let A's text swallow the id "B", and every student who picked the key B was
    # reported as having picked A — a mistake nobody made, at the top of a re-teaching list.
    lookup: dict = {}
    for index, option in enumerate(options):
        normalised = normalise(option.key)
        if normalised and normalised not in lookup:
            lookup[normalised] = index
    for index, option in enumerate(options):
        for form in option.aliases:
            normalised = normalise(form)
            if normalised and normalised not in lookup:
                lookup[normalised] = index

    counts = [0] * len(options)
    unrecognised = 0
    for key, count in tally.counts.items():
        index = lookup.get(key)
        if index is None:
            # Not this question's answer to give. Counting it under a nearby option would
            # put a mistake nobody made on a re-teaching list.
            unrecognised += count
        else:
            counts[index] += count

    responses = sum(counts)
    state = _state(responses)
    if state == STATE_NO_DATA and unrecognised:
        # Something WAS recorded here; it simply does not fit the question as it now stands.
        # Calling that "nobody answered" would print an empty state over a data defect.
        state = STATE_UNREADABLE
    show = state == STATE_DATA
    held_back = _held_back_cells(counts) if show else set()

    if state == STATE_NO_DATA:
        note = _NO_DATA_NOTE
    elif state == STATE_UNREADABLE:
        note = _UNREADABLE_NOTE
    elif state == STATE_SUPPRESSED:
        note = _SUPPRESSED_NOTE
    elif held_back:
        note = _SMALL_CELL_NOTE
    else:
        note = ""

    return {
        "kind": KIND_OPTIONS,
        "state": state,
        "responses": responses,
        "no_answer": tally.no_answer + unrecognised,
        # Recorded, readable, and matching no option on the question — a defect rather than
        # a blank, so it is counted as no answer AND said out loud.
        "unrecognised": unrecognised,
        "ungraded": tally.ungraded,
        "min_responses": MIN_RESPONSES,
        "min_cell": MIN_CELL,
        "options": [
            {
                "key": option.key,
                "label": option.label,
                "is_correct": option.is_correct,
                "count": counts[index] if show and index not in held_back else None,
                "share": _percent(counts[index], responses)
                if show and index not in held_back
                else None,
            }
            for index, option in enumerate(options)
        ],
        "top_wrong": [],
        # Nothing is truncated in the options shape — every option is on the list — so there
        # is no "5 of 12" for a page to print here.
        "distinct_wrong_answers": None,
        "note": note,
    }


def answer_block(tally: ResponseTally) -> dict:
    """The wrong answers a free-entry question drew most often.

    Wrong only, and ranked: on a grid-in the correct answer is one value and the mistakes are
    the information. An answer is wrong here because a verdict said so when it was recorded —
    a recorded answer nobody has scored yet is neither right nor wrong, it is ``ungraded``,
    and inventing a verdict for it would put an imaginary mistake at the top of the list.

    Only mistakes ``MIN_CELL`` students or more made are listed. A wrong answer exactly one
    student typed is not a shared mistake to re-teach, and quoting it back beside a count of
    one hands the teacher that student's answer in a table that claims to be about the class.
    ``distinct_wrong_answers`` still counts every one of them, so the list never reads as the
    whole of it.
    """
    responses = tally.responses
    state = _state(responses)
    show = state == STATE_DATA

    wrong = {key: count for key, count in tally.wrong_counts.items() if count}
    shared = {key: count for key, count in wrong.items() if count >= MIN_CELL}
    # Commonest first; the normalised form breaks ties so the same data always ranks the
    # same way, on either database.
    ranked = sorted(shared.items(), key=lambda pair: (-pair[1], pair[0]))

    if state == STATE_NO_DATA:
        note = _NO_DATA_NOTE
    elif state == STATE_SUPPRESSED:
        note = _SUPPRESSED_NOTE
    elif not wrong:
        note = _UNGRADED_NOTE if tally.ungraded else _ALL_CORRECT_NOTE
    elif not shared:
        note = _NO_SHARED_MISTAKE_NOTE
    else:
        note = ""

    return {
        "kind": KIND_ANSWERS,
        "state": state,
        "responses": responses,
        "no_answer": tally.no_answer,
        # A typed answer matches no option because the question offers none; "unrecognised"
        # is a question this shape cannot be asked.
        "unrecognised": None,
        # Answers still waiting on a verdict. A short list resting on half-scored work says
        # so rather than looking like a class that mostly got it right.
        "ungraded": tally.ungraded,
        "min_responses": MIN_RESPONSES,
        "min_cell": MIN_CELL,
        "options": [],
        "top_wrong": [
            {"answer": tally.display[key], "count": count}
            for key, count in ranked[:TOP_WRONG_ANSWERS]
        ]
        if show
        else [],
        # How many distinct wrong answers there were in all — including the ones too rare to
        # list — so a page can say "2 of 7" instead of implying the list is the whole of it.
        "distinct_wrong_answers": len(wrong) if show else None,
        "note": note,
    }
