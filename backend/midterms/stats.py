"""Midterm statistics: one pass rate, computed the same way at every level.

THE formula, and it is the school owner's rather than a derivation:

    pass_rate = 100 * (passed at the first sitting + passed on a retake)
                / EVERY student on the classroom roster

In the owner's words — *"jami o'quvchilarni 100% deb olsak … 10ta studentdan 9tasi o'tsa
90%"*: take all the students as the 100%, and if 9 of 10 pass, that is 90%.

Three consequences follow. Each is a decision somebody could reasonably have made
differently, so each is written down rather than left to be inferred from an expression:

* **Absent counts as failed.** The denominator is the roster, never "those who turned up".
  A class where half the students never sat the paper has not scored 100%, and a report
  that said so would be the one number a head teacher must not be able to game.
* **A retake pass is a pass**, and it lands in the numerator of the PARENT midterm. That is
  why a retake paper is never a row of its own here (:func:`is_countable_unit`) — *no*
  retake, parent or no parent: counting one separately would put the same roster in the
  denominator twice and would additionally show the retake itself at a dismal rate, since
  only the students who did not pass ever sit one. A retake with no parent has nothing to
  fold into, so it is excluded and **named** in ``orphan_retakes`` rather than silently
  dropped. Of the passers, ``first_try_share`` says how many needed no second chance — a
  share of PASSERS, never of the roster.
* **A month the school has not reached is a plan, not a result.** Every teacher assign path
  writes ``MidtermSchedule.starts_at``, so a paper booked for next month already dates into
  next month. Such a month is offered (who is booked for what is real information) but is
  never the DEFAULT — see :func:`default_month` / :func:`is_future_month` — because its whole
  roster is "absent", and absent counts as failed, so it reads as the school scoring 0%.
* **Roll-ups are pooled**: a teacher's, a department's or a branch's rate is
  ``sum(passed) / sum(roster)``, never the mean of its classrooms' percentages. A mean of
  means lets a 4-student group outweigh a 30-student one.

Four structural facts this module is shaped around, none of them guesses:

1. **A midterm has no date.** ``Midterm`` is a paper; the sitting is
   ``classes.MidtermSchedule``, one row per ``(classroom, midterm)``. **The month is
   therefore per classroom**, and is resolved through :func:`month_key_for` — schedule,
   then the earliest completed sitting by that classroom's cohort, then the midterm's
   publication, then its creation. Never ``MidtermOutcome.decided_at``: that is
   ``auto_now_add``, so a backfill restamps every verdict into the month it ran in.
2. **PRE_MIDTERM is a diagnostic and issues no verdict** (``Midterm.GRADED_TYPES``). It is
   excluded from every denominator; left in, it would dilute each classroom's rate by the
   size of a paper nobody can pass or fail.
3. **The roster is the classroom, not the attempt table** — ``classroom_student_ids``, the
   same denominator the existing ops report already prints as ``summary.students``, so the
   two surfaces cannot disagree about how many students a class has.
4. **Department == ``Classroom.subject``** (ENGLISH / MATH). There is no Department model.
   Note that ``Midterm.subject`` speaks the OTHER vocabulary (READING_WRITING / MATH), so
   nothing here compares the two as strings — see :data:`SUBJECT_ALIASES`.

Empty denominator returns ``None``, never ``0.0``, exactly as ``classes.progress`` does: a
rate over nobody is "we don't know", and a class with no roster has not failed everyone.

Pure aggregation — no views, no DRF. The HTTP surface is ``midterms.views_stats``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, fields
from datetime import datetime

from django.utils import timezone

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from classes.models import Classroom
from classes.models_schedule import MidtermSchedule

from .admin_report import (
    STATE_ABSENT,
    STATUS_FAILED,
    STATUS_PASSED,
    STATUS_PASSED_ON_RETAKE,
    classroom_midterm_ids,
    classroom_student_ids,
    final_status_for,
    midterm_ids_by_resource_id,
    pick_sitting,
    resolve_retake,
    retakes_for,
    sitting_for,
)
from .models import Midterm, MidtermAttempt, MidtermOutcome
from .views_report import display_name

#: ``strftime`` format of a month key. Computed in LOCAL time (``TIME_ZONE`` is
#: Asia/Tashkent): a paper sat at 09:00 Tashkent on the 1st is stored as 04:00 UTC on the
#: 1st, but one sat at 01:00 on the 1st is stored in the PREVIOUS month, and a report that
#: put a September midterm in August would be argued with for the rest of the term.
MONTH_FMT = "%Y-%m"

#: A month key, zero-padded. ``strptime`` is NOT enough on its own: ``strptime("2026-9",
#: "%Y-%m")`` succeeds, so an unpadded month passed validation, matched none of the padded
#: keys the index produces, fell through to the empty shell, and the page announced "No
#: midterms in this month" for a month with a full set of results.
MONTH_RE = re.compile(r"\d{4}-\d{2}")

#: Which authority gave a ``(classroom, midterm)`` pair its month, in the order they are
#: consulted. Reported alongside the month in the manner of ``classes.progress``'s ``basis``
#: list — a month derived from "whenever this paper happened to be created" is a weaker fact
#: than one read off a schedule, and the page should be able to say which it is looking at.
MONTH_BASIS_SCHEDULE = "schedule"
MONTH_BASIS_ATTEMPT = "first_sitting"
MONTH_BASIS_PUBLISHED = "published"
MONTH_BASIS_CREATED = "created"

#: The bucket name for a classroom whose branch or teacher is NULL.
#:
#: Load-bearing, not cosmetic. ``Classroom.branch`` went unset for every class created
#: between two releases (a create-form regression, never backfilled) and some classes have
#: no teacher assigned at all. Dropping those rows would quietly shrink the school's own
#: totals below the sum of its branches, and nothing on screen would say why.
UNASSIGNED = "Unassigned"

#: What the numbers mean, carried in every payload.
#:
#: The school reads these figures to evaluate teachers, so the page has to be able to STATE
#: the rule rather than imply it: a "pass rate" that counted only the students who turned up
#: is a different number under the same name, and no reader could tell which one they had.
#: Same discipline as the ``weights`` block ``classes.progress`` returns.
DEFINITION = {
    "pass_rate": "passed (first sitting or retake) / all roster students",
    "absent_counts_as": "failed",
    "rollup": "pooled",
    "denominator": (
        "every non-removed student membership in the classroom, whether or not they sat the paper"
    ),
    "first_try_share": "of the students who passed, the share who passed at the first sitting",
    "excluded": (
        "pre-midterms (diagnostics, never graded) and retake papers "
        "(folded into the midterm they are the second chance at)"
    ),
    "month": (
        "the month that midterm was sat in THAT classroom: its schedule, "
        "else the earliest completed sitting"
    ),
    "empty_denominator": "null, never 0",
    "default_month": (
        "the most recent month the school has actually reached; a month scheduled ahead is "
        "offered but never opened on, because nobody has sat it yet"
    ),
}


def _build_subject_aliases() -> dict[str, str]:
    """``Classroom.subject`` keyed by every spelling a caller might send.

    ``Midterm.subject`` is READING_WRITING/MATH while ``Classroom.subject`` is ENGLISH/MATH.
    The two vocabularies share the token "MATH" and disagree on the other one, so a bare
    string compare silently drops every English classroom while looking like it works.

    Built by asking ``Classroom.platform_subject`` — the model's own conversion — rather
    than by writing a second mapping table here for it to drift out of step with.
    """
    aliases: dict[str, str] = {}
    for key, _label in Classroom.SUBJECT_CHOICES:
        aliases[key] = key
        platform = Classroom(subject=key).platform_subject
        if platform:
            aliases.setdefault(platform, key)
    return aliases


SUBJECT_ALIASES = _build_subject_aliases()

_SUBJECT_LABELS = dict(Classroom.SUBJECT_CHOICES)
_LEVEL_LABELS = dict(Classroom.LEVEL_CHOICES)


# ── the tally ────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Tally:
    """Counts for one roster against one midterm. The only thing rates are computed from.

    ``roster == passed_first + passed_retake + failed + absent + pending`` always holds, and
    is what makes :meth:`merged` a legitimate pooled roll-up: adding two tallies adds two
    numerators and two denominators, which is exactly the school's rule.

    The retake trio describes the second chance itself and is deliberately NOT the same
    thing as ``passed_retake``: ``retake_passed`` counts everyone on the roster who passed
    any retake of this paper, while ``passed_retake`` counts only those the retake actually
    rescued — a student who somehow sat a retake without having failed the parent is in the
    first and not the second.
    """

    roster: int = 0
    attended: int = 0
    passed_first: int = 0
    passed_retake: int = 0
    failed: int = 0
    absent: int = 0
    pending: int = 0
    retake_taken: int = 0
    retake_passed: int = 0
    retake_failed: int = 0

    @property
    def passed(self) -> int:
        return self.passed_first + self.passed_retake

    @property
    def pass_rate(self) -> float | None:
        """THE number. ``None`` — not 0.0 — when there is nobody to have passed."""
        return _rate(self.passed, self.roster)

    @property
    def attendance_rate(self) -> float | None:
        """How much of the roster actually sat the paper."""
        return _rate(self.attended, self.roster)

    @property
    def first_try_share(self) -> float | None:
        """Of the PASSERS, the share who needed no retake. ``None`` when nobody passed."""
        return _rate(self.passed_first, self.passed)

    @property
    def retake_share(self) -> float | None:
        """The other half of :attr:`first_try_share`, and ``None`` on the same condition.

        Taken as ``100 - first_try_share`` rather than recomputed, so the pair always sums
        to exactly 100.0 instead of to 99.9 on a third of the possible cohorts.
        """
        first = self.first_try_share
        return None if first is None else round(100.0 - first, 1)

    def merged(self, other: "Tally") -> "Tally":
        """Field-wise addition — the pooled roll-up, and the only one this module does."""
        return Tally(**{f.name: getattr(self, f.name) + getattr(other, f.name) for f in fields(self)})

    def as_dict(self) -> dict:
        """Flat counts + every derived rate, for a payload row."""
        out = {f.name: getattr(self, f.name) for f in fields(self)}
        out["passed"] = self.passed
        out["pass_rate"] = self.pass_rate
        out["attendance_rate"] = self.attendance_rate
        out["first_try_share"] = self.first_try_share
        out["retake_share"] = self.retake_share
        return out


EMPTY_TALLY = Tally()


def _rate(numerator: int, denominator: int) -> float | None:
    """``round(100 * n / d, 1)``, or ``None`` when there is no denominator to divide by.

    Every division in this module goes through here. An empty roster, a month with no
    sittings and a cohort in which nobody passed all reach it, and all three are "no
    answer" rather than zero.
    """
    if not denominator:
        return None
    return round(100.0 * numerator / denominator, 1)


#: The paper types that are a unit of assessment in their own right — everything graded that
#: is not somebody's second chance. Derived from ``GRADED_TYPES`` rather than written out, so
#: a graded type added later is counted rather than silently dropped.
COUNTABLE_TYPES = tuple(t for t in Midterm.GRADED_TYPES if t != Midterm.TYPE_RETAKE)


def is_countable_unit(midterm) -> bool:
    """Whether ``midterm`` is a unit of assessment in its own right.

    A paper counts unless it is somebody else's second chance. That excludes pre-midterms
    (never graded) and **every** RETAKE — parent or no parent.

    The parentless case is the one that had to be decided rather than assumed. A RETAKE with
    a NULL ``retake_of`` is an ordinary authoring mistake, not an exotic one: the builder's
    parent picker offers "— No parent midterm —" as its initial value, ``exams.serializers``
    accepts it, ``midterms.sync`` produces it whenever the parent's mirror does not exist
    yet, and ``midterms.access`` already treats it as a known mistake. Standing it on its own
    put the WHOLE roster in the denominator of a paper only the students who did not pass
    were ever offered, which halved the month for every class that had one and pooled up into
    branch, department, teacher and school totals.

    It cannot be folded either, because there is no parent to fold it into — so it is
    excluded and disclosed, never silently dropped. See :func:`is_orphan_retake` and the
    ``orphan_retakes`` list every payload carries.

    ``retake_of_id`` is still consulted alongside the type, and not as a leftover: a paper
    that names a parent IS folded into it (``retakes_by_parent`` groups on ``retake_of_id``
    without looking at the type), so counting it here as well would put its passes in the
    numerator twice. Type and parentage each exclude on their own.
    """
    return (
        bool(midterm.is_graded)
        and midterm.midterm_type != Midterm.TYPE_RETAKE
        and midterm.retake_of_id is None
    )


def is_orphan_retake(midterm) -> bool:
    """A RETAKE with no parent: excluded from every number, and named in the payload."""
    return midterm.midterm_type == Midterm.TYPE_RETAKE and midterm.retake_of_id is None


# ── month resolution ─────────────────────────────────────────────────────────
def _month_of(value) -> str | None:
    """A datetime → ``"YYYY-MM"`` in local time, or ``None`` if there is no datetime.

    Tolerates a naive datetime rather than raising the ``ValueError`` ``localtime`` gives
    for one. Everything the ORM hands back is aware under ``USE_TZ``, but this function is
    on the path of a whole-school roll-up and a single bad row must not take the page down.
    """
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_default_timezone())
    return timezone.localtime(value).strftime(MONTH_FMT)


def month_for(classroom_id: int, midterm_id: int) -> tuple[str | None, str | None]:
    """``(month_key, basis)`` for one ``(classroom, midterm)`` pair.

    The authorities, in order: the classroom's ``MidtermSchedule.starts_at``, the earliest
    completed sitting among that classroom's roster, the midterm's ``published_at``, its
    ``created_at``. Returns ``(None, None)`` when the pair yields nothing at all — a grant
    pointing at a midterm that has since been deleted, most obviously — so a roll-up drops
    the pair from every month instead of raising.
    """
    starts_at = (
        MidtermSchedule.objects.filter(
            classroom_id=classroom_id, midterm_id=midterm_id, starts_at__isnull=False
        )
        .values_list("starts_at", flat=True)
        .first()
    )
    if starts_at is not None:
        return _month_of(starts_at), MONTH_BASIS_SCHEDULE

    roster = classroom_student_ids(classroom_id)
    if roster:
        first_sitting = (
            MidtermAttempt.objects.filter(
                midterm_id=midterm_id,
                student_id__in=roster,
                is_completed=True,
                completed_at__isnull=False,
            )
            .order_by("completed_at")
            .values_list("completed_at", flat=True)
            .first()
        )
        if first_sitting is not None:
            return _month_of(first_sitting), MONTH_BASIS_ATTEMPT

    meta = Midterm.objects.filter(pk=midterm_id).values("published_at", "created_at").first()
    if meta is None:
        return None, None
    if meta["published_at"] is not None:
        return _month_of(meta["published_at"]), MONTH_BASIS_PUBLISHED
    if meta["created_at"] is not None:
        return _month_of(meta["created_at"]), MONTH_BASIS_CREATED
    return None, None


def month_key_for(classroom_id: int, midterm_id: int) -> str | None:
    """The month one classroom sat one midterm in, as ``"YYYY-MM"``. ``None`` if unknowable."""
    return month_for(classroom_id, midterm_id)[0]


def countable_midterm_ids() -> set[int]:
    """Every paper that is a unit of assessment in its own right. See :func:`is_countable_unit`.

    The two conditions here are that function's, in SQL. Keep them in step: a paper this
    query returns but ``is_countable_unit`` rejects becomes a month with no rows in it.
    """
    return set(
        Midterm.objects.filter(
            midterm_type__in=COUNTABLE_TYPES, retake_of__isnull=True
        ).values_list("id", flat=True)
    )


def orphan_retake_ids() -> set[int]:
    """Every RETAKE that names no parent. See :func:`is_orphan_retake`."""
    return set(
        Midterm.objects.filter(
            midterm_type=Midterm.TYPE_RETAKE, retake_of__isnull=True
        ).values_list("id", flat=True)
    )


def _unit_pairs(classroom_ids=None, units=None) -> dict[tuple[int, int], object]:
    """``{(classroom_id, midterm_id): starts_at|None}`` for every pair in ``units``.

    Both legs ``classroom_midterm_ids`` uses — scheduled there, or granted classroom-scoped
    — but resolved for the whole school in a handful of queries rather than two per
    classroom. Grant status is deliberately unfiltered, for the reason stated on
    ``classroom_midterm_ids``: a report is history, not an access check.

    ``units`` defaults to the countable papers; the orphan-retake disclosure passes its own
    set through the same dating machinery rather than growing a second copy of it.
    """
    units = countable_midterm_ids() if units is None else set(units)
    if not units:
        return {}

    schedules = MidtermSchedule.objects.filter(midterm_id__in=units)
    grants = ResourceAccessGrant.objects.filter(
        classroom__isnull=False,
        scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM_V2,
    )
    if classroom_ids is not None:
        schedules = schedules.filter(classroom_id__in=classroom_ids)
        grants = grants.filter(classroom_id__in=classroom_ids)

    pairs: dict[tuple[int, int], object] = {}
    for classroom_id, midterm_id, starts_at in schedules.values_list(
        "classroom_id", "midterm_id", "starts_at"
    ):
        pairs[(classroom_id, midterm_id)] = starts_at

    grant_pairs = list(grants.values_list("classroom_id", "resource_id"))
    by_resource = midterm_ids_by_resource_id({rid for _, rid in grant_pairs})
    for classroom_id, resource_id in grant_pairs:
        midterm_id = by_resource.get(resource_id)
        if midterm_id in units:
            pairs.setdefault((classroom_id, midterm_id), None)
    return pairs


def month_index(classroom_ids=None, units=None) -> dict[tuple[int, int], tuple[str, str]]:
    """``{(classroom_id, midterm_id): (month_key, basis)}`` for every countable pair.

    The workhorse behind :func:`available_months` and :func:`school_month_stats`. Bounded in
    queries rather than in rows: the schedule leg answers most pairs outright, and only the
    leftovers — a midterm reached through a grant, or scheduled with a NULL ``starts_at`` —
    pay for a roster and an attempt lookup. Pairs that resolve to nothing are simply absent.
    """
    pairs = _unit_pairs(classroom_ids, units)
    if not pairs:
        return {}

    index: dict[tuple[int, int], tuple[str, str]] = {}
    unresolved: list[tuple[int, int]] = []
    for pair, starts_at in pairs.items():
        month = _month_of(starts_at)
        if month is not None:
            index[pair] = (month, MONTH_BASIS_SCHEDULE)
        else:
            unresolved.append(pair)
    if not unresolved:
        return index

    # Attempts carry no classroom FK, so the cohort has to come from the roster. One roster
    # query per classroom that still needs one — never one per student, and never one per
    # (classroom, midterm) pair.
    rosters = {cid: classroom_student_ids(cid) for cid in {cid for cid, _ in unresolved}}
    classrooms_by_student: dict[int, set[int]] = {}
    for cid, student_ids in rosters.items():
        for sid in student_ids:
            classrooms_by_student.setdefault(sid, set()).add(cid)

    earliest: dict[tuple[int, int], object] = {}
    if classrooms_by_student:
        rows = MidtermAttempt.objects.filter(
            midterm_id__in={mid for _, mid in unresolved},
            student_id__in=list(classrooms_by_student),
            is_completed=True,
            completed_at__isnull=False,
        ).values_list("midterm_id", "student_id", "completed_at")
        for midterm_id, student_id, completed_at in rows:
            for cid in classrooms_by_student.get(student_id, ()):
                key = (cid, midterm_id)
                if key in earliest and earliest[key] <= completed_at:
                    continue
                earliest[key] = completed_at

    meta = {
        row["id"]: row
        for row in Midterm.objects.filter(id__in={mid for _, mid in unresolved}).values(
            "id", "published_at", "created_at"
        )
    }
    for pair in unresolved:
        month = _month_of(earliest.get(pair))
        if month is not None:
            index[pair] = (month, MONTH_BASIS_ATTEMPT)
            continue
        row = meta.get(pair[1])
        if row is None:
            continue
        month = _month_of(row["published_at"])
        if month is not None:
            index[pair] = (month, MONTH_BASIS_PUBLISHED)
            continue
        month = _month_of(row["created_at"])
        if month is not None:
            index[pair] = (month, MONTH_BASIS_CREATED)
    return index


def _scoped_classrooms(*, branch_id=None, subject=None, teacher_id=None):
    """``(queryset, classroom_ids)`` for a filtered request; ``ids`` is ``None`` unfiltered.

    One place, because the month PICKER and the numbers under it have to agree about which
    classrooms they are looking at. They did not: the picker was built from the school-wide
    month list whatever the filter said, so choosing a branch offered months that branch has
    no data for — and an omitted ``month`` then defaulted to one of them, opening a filtered
    page on a month its own scope is empty in.
    """
    classrooms = Classroom.objects.select_related("teacher", "branch", "branch__region")
    filtered = False
    if branch_id is not None:
        classrooms, filtered = classrooms.filter(branch_id=branch_id), True
    if subject:
        classrooms = classrooms.filter(subject=SUBJECT_ALIASES.get(subject, subject))
        filtered = True
    if teacher_id is not None:
        classrooms, filtered = classrooms.filter(teacher_id=teacher_id), True
    scoped_ids = list(classrooms.values_list("id", flat=True)) if filtered else None
    return classrooms, scoped_ids


def available_months(*, branch_id=None, subject=None, teacher_id=None) -> list[str]:
    """Every month a scope has midterm data for, newest first.

    Unfiltered that is the whole school. Filtered it is that branch's / department's /
    teacher's own months — the list the picker may offer for the page the caller is actually
    looking at. Future months are INCLUDED: a paper booked for next month is real information
    and the picker may offer it. It must simply never be the default — :func:`default_month`.
    """
    _classrooms, scoped_ids = _scoped_classrooms(
        branch_id=branch_id, subject=subject, teacher_id=teacher_id
    )
    if scoped_ids is not None and not scoped_ids:
        return []
    return sorted({month for month, _basis in month_index(scoped_ids).values()}, reverse=True)


def classroom_months(classroom_id: int) -> list[str]:
    """Every month ONE classroom has midterm data for, newest first."""
    return sorted(
        {month for month, _basis in month_index([classroom_id]).values()}, reverse=True
    )


def current_month_key() -> str:
    """The month the school is in now, in ``TIME_ZONE`` — never the server's or a browser's."""
    return timezone.localtime(timezone.now()).strftime(MONTH_FMT)


def is_future_month(month) -> bool:
    """Whether ``month`` is after the current one — a plan rather than a result.

    A plain string compare, which is why every key in this module is zero-padded and why
    :func:`is_month_key` now insists on it: ``"2026-9" > "2026-10"`` lexicographically, and
    an unpadded key sneaking in here would answer this question backwards.
    """
    return bool(month) and str(month) > current_month_key()


def default_month(months) -> str | None:
    """The month a page should OPEN on, given a descending list: the newest already reached.

    Not simply ``months[0]``. ``MidtermSchedule.starts_at`` is mandatory on every teacher
    assign path, so a midterm assigned for next month already carries next month, and that
    month sorts first. Opening on it showed a full roster of absentees — and absent counts
    as failed — so an admin was told the school had scored 0.0% on a paper nobody had sat.
    The empty-state branch does not catch it either: the month HAS a midterm in it.

    ``None`` when every month a scope has is still ahead of it. That is an honest "no results
    yet" rather than a plan reported as a score; the caller carries ``future_months`` beside
    it so the page can say what is coming instead of merely showing nothing.
    """
    now = current_month_key()
    for month in months:
        if month <= now:
            return month
    return None


def future_months(months) -> list[str]:
    """The subset of ``months`` the school has not reached — scheduled, never scored.

    Computed here rather than in the browser: the month is the school's local month
    (Asia/Tashkent) and a reader's device may be on any other date entirely.
    """
    now = current_month_key()
    return [month for month in months if month > now]


def is_month_key(value) -> bool:
    """Whether ``value`` is a well-formed, zero-padded ``"YYYY-MM"``.

    Both halves are load-bearing. ``strptime("2026-9", "%Y-%m")`` SUCCEEDS, so the format
    string alone let an unpadded month through validation; it then matched none of the padded
    keys the index produces, fell past ``if not pairs`` and rendered "No midterms in this
    month" over a month with a full set of results — the exact lie the page's own error
    handling refuses to tell for a failed request. ``strptime`` still runs after the regex,
    because a padded ``"2026-13"`` is well-formed and is still not a month.
    """
    if not isinstance(value, str):
        return False
    if MONTH_RE.fullmatch(value) is None:
        return False
    try:
        datetime.strptime(value, MONTH_FMT)
    except ValueError:
        return False
    return True


# ── tallying ─────────────────────────────────────────────────────────────────
def _prefetch(midterm_ids, student_ids) -> tuple[dict, dict]:
    """``(attempts, outcomes)`` indexed ``{midterm_id: {student_id: row}}``, in two queries.

    Two queries whatever the cohort's size, because ``build_midterm_rows`` — which issues
    four per (classroom, midterm) and materialises a row per student — is O(classrooms ×
    midterms × students) once a whole month is being rolled up. Nothing below issues a query
    inside a loop over students.
    """
    attempts: dict[int, dict[int, MidtermAttempt]] = {}
    outcomes: dict[int, dict[int, MidtermOutcome]] = {}
    if not midterm_ids or not student_ids:
        return attempts, outcomes

    for attempt in MidtermAttempt.objects.filter(
        midterm_id__in=midterm_ids, student_id__in=student_ids
    ).order_by("created_at"):
        slot = attempts.setdefault(attempt.midterm_id, {})
        slot[attempt.student_id] = pick_sitting(slot.get(attempt.student_id), attempt)

    for outcome in MidtermOutcome.objects.filter(
        midterm_id__in=midterm_ids, student_id__in=student_ids
    ):
        outcomes.setdefault(outcome.midterm_id, {})[outcome.student_id] = outcome

    return attempts, outcomes


def _tally_from(midterm, roster_ids, retakes, attempts, outcomes) -> Tally:
    """One classroom's tally for one midterm, from rows already fetched. Issues no queries.

    The verdict itself is ``admin_report.final_status_for`` over
    ``admin_report.sitting_for`` — the same two functions the per-student admin table runs
    on, so a classroom's pass rate and the table a head teacher opens underneath it cannot
    disagree about a single student.
    """
    m_attempts = attempts.get(midterm.id, {})
    m_outcomes = outcomes.get(midterm.id, {})

    attended = 0
    passed_first = passed_retake = failed = absent = pending = 0
    retake_taken: set[int] = set()
    retake_passed: set[int] = set()

    for student_id in roster_ids:
        sitting = sitting_for(midterm, student_id, m_attempts, m_outcomes)
        attempt = m_attempts.get(student_id)
        if attempt is not None and attempt.is_completed:
            attended += 1

        # Every retake of this parent, unioned — and by exactly the rule the per-student
        # evidence table now applies, so the headline and the table underneath it cannot
        # disagree about which second chance decided a student's fate.
        best_retake, took_one, rescued = resolve_retake(retakes, student_id, attempts, outcomes)
        if took_one:
            retake_taken.add(student_id)
        if rescued:
            retake_passed.add(student_id)

        status = final_status_for(sitting, best_retake)
        if status == STATUS_PASSED:
            passed_first += 1
        elif status == STATUS_PASSED_ON_RETAKE:
            passed_retake += 1
        elif status == STATUS_FAILED:
            failed += 1
        elif status == STATE_ABSENT:
            absent += 1
        else:
            # PENDING, and the NOT_GRADED a finished pre-midterm produces. Every caller here
            # filters pre-midterms out before this point (``is_countable_unit``), so in
            # practice this is PENDING only; folding both in keeps the invariant that the
            # five columns sum to the roster, which is what makes ``merged`` a pooled rate.
            pending += 1

    # A frozen verdict is proof of a sitting even where the attempt row has since gone, and
    # without this a passer with no attempt row would give a negative ``retake_failed``.
    # ``resolve_retake`` already reports a pass as a sitting; belt and braces.
    retake_taken |= retake_passed
    return Tally(
        roster=len(roster_ids),
        attended=attended,
        passed_first=passed_first,
        passed_retake=passed_retake,
        failed=failed,
        absent=absent,
        pending=pending,
        retake_taken=len(retake_taken),
        retake_passed=len(retake_passed),
        retake_failed=len(retake_taken) - len(retake_passed),
    )


def classroom_midterm_tally(classroom, midterm) -> Tally:
    """The tally for one classroom against one midterm, fetching what it needs."""
    roster_ids = classroom_student_ids(classroom.id)
    retakes = list(retakes_for(midterm))
    attempts, outcomes = _prefetch([midterm.id] + [r.id for r in retakes], roster_ids)
    return _tally_from(midterm, roster_ids, retakes, attempts, outcomes)


# ── payload shaping ──────────────────────────────────────────────────────────
def _teacher_brief(user) -> dict | None:
    return {"id": user.id, "name": display_name(user)} if user is not None else None


def _branch_brief(branch) -> dict | None:
    if branch is None:
        return None
    return {
        "id": branch.id,
        "name": branch.name,
        "region": branch.region.name if branch.region_id else None,
    }


def classroom_brief(classroom) -> dict:
    return {
        "id": classroom.id,
        "name": classroom.name,
        "subject": classroom.subject,
        # Never render a raw DB enum: ENGLISH is "English" and senior is "Senior".
        "subject_label": _SUBJECT_LABELS.get(classroom.subject, classroom.subject),
        "level": classroom.level or "",
        "level_label": _LEVEL_LABELS.get(classroom.level, ""),
        "teacher": _teacher_brief(classroom.teacher if classroom.teacher_id else None),
        "branch": _branch_brief(classroom.branch if classroom.branch_id else None),
    }


def _midterm_brief(midterm) -> dict:
    return {
        "id": midterm.id,
        "title": midterm.title,
        "subject": midterm.subject,
        "midterm_type": midterm.midterm_type,
        "pass_mark": midterm.effective_pass_mark if midterm.is_graded else None,
        "score_ceiling": midterm.score_ceiling,
    }


def _sort_rows(rows: list[dict], name_key: str = "name") -> list[dict]:
    """Best pass rate first, ``None`` last, ties broken by name.

    ``None`` sorts last on purpose: a group with no roster has not come bottom of the
    school, it has not been measured, and putting it under the worst-performing branch would
    read as though it had.
    """
    return sorted(
        rows,
        key=lambda row: (
            row.get("pass_rate") is None,
            -(row.get("pass_rate") or 0.0),
            str(row.get(name_key) or "").lower(),
        ),
    )


class _Group:
    """A pooled bucket: one merged tally, plus what it was pooled over."""

    def __init__(self) -> None:
        self.tally = EMPTY_TALLY
        self.classroom_ids: set[int] = set()
        self.student_ids: set[int] = set()

    def add(self, tally: Tally, classroom_id: int, student_ids) -> None:
        self.tally = self.tally.merged(tally)
        self.classroom_ids.add(classroom_id)
        self.student_ids.update(student_ids)

    def payload(self) -> dict:
        return {
            **self.tally.as_dict(),
            "classrooms": len(self.classroom_ids),
            # Beside ``roster`` on purpose. 112 of 226 students hold two active memberships,
            # so a branch or department that pools two classrooms one student sits in counts
            # that student twice — accepted, because the pooled formula is defined on
            # rosters, but it must be VISIBLE rather than inferred from a discrepancy.
            "distinct_students": len(self.student_ids),
        }


# ── the public reports ───────────────────────────────────────────────────────
def _classroom_month_summary(rows: list[dict], tally: Tally, classroom) -> dict:
    return {
        **tally.as_dict(),
        "midterms": len(rows),
        # Beside ``roster`` on purpose: one classroom's roster holds each student once, so
        # this is its size — but a class that sat TWO midterms this month has that roster in
        # ``roster`` twice, which is what the pooled formula asks for and what a reader
        # comparing the two numbers needs to be able to see.
        "distinct_students": len(classroom_student_ids(classroom.id)) if rows else 0,
    }


def orphan_retakes_in(month, classroom_ids=None) -> list[dict]:
    """``[{id, title}]`` for every parentless RETAKE that dates into ``month``, oldest first.

    The disclosure half of :func:`is_countable_unit`'s exclusion. Such a paper cannot be
    counted (its denominator would be a roster it was never offered to) and cannot be folded
    (there is no parent to fold it into), so the only honest thing left is to leave it out
    and SAY SO — "1 retake paper has no parent midterm and was left out" — rather than let a
    paper somebody can see in the builder go missing from the table with no explanation.

    Dated through the same :func:`month_index` ladder as the countable papers, so a warning
    never lands in a different month from the sitting it describes.
    """
    if not month:
        return []
    ids = orphan_retake_ids()
    if not ids:
        return []
    hits = {
        midterm_id
        for (_cid, midterm_id), (key, _basis) in month_index(classroom_ids, ids).items()
        if key == month
    }
    if not hits:
        return []
    return [
        {"id": m.id, "title": m.title}
        for m in Midterm.objects.filter(id__in=hits).order_by("id")
    ]


def classroom_month(classroom, month) -> tuple[list[dict], dict, list[dict]]:
    """One classroom's month: rows per countable midterm, the pooled summary, the warnings.

    Which midterms belong to the classroom is ``classroom_midterm_ids`` — the same union of
    schedule rows and classroom-scoped grants the existing ops report walks, so the two
    surfaces list the same papers.

    Returned as a triple because the detail page needs all three and they cost the same
    queries; :func:`classroom_month_rows` and :func:`classroom_month_summary` are the
    single-answer views onto it. The third member is ``orphan_retakes`` — papers deliberately
    left out of the rows above, named so the page can account for their absence.
    """
    orphans = orphan_retakes_in(month, [classroom.id])
    if not month:
        return [], _classroom_month_summary([], EMPTY_TALLY, classroom), orphans

    candidates = [
        m
        for m in Midterm.objects.filter(id__in=classroom_midterm_ids(classroom.id))
        if is_countable_unit(m)
    ]
    scoped = [
        (m, basis)
        for m, (key, basis) in ((m, month_for(classroom.id, m.id)) for m in candidates)
        if key == month
    ]
    if not scoped:
        return [], _classroom_month_summary([], EMPTY_TALLY, classroom), orphans

    midterm_ids = [m.id for m, _ in scoped]
    retakes_by_parent: dict[int, list[Midterm]] = {}
    for retake in Midterm.objects.filter(retake_of_id__in=midterm_ids).order_by("id"):
        retakes_by_parent.setdefault(retake.retake_of_id, []).append(retake)

    roster_ids = classroom_student_ids(classroom.id)
    every_id = midterm_ids + [r.id for group in retakes_by_parent.values() for r in group]
    attempts, outcomes = _prefetch(every_id, roster_ids)

    rows = []
    total = EMPTY_TALLY
    for midterm, basis in scoped:
        retakes = retakes_by_parent.get(midterm.id, [])
        tally = _tally_from(midterm, roster_ids, retakes, attempts, outcomes)
        total = total.merged(tally)
        rows.append(
            {
                **_midterm_brief(midterm),
                "month": month,
                "month_basis": basis,
                "retakes": [{"id": r.id, "title": r.title} for r in retakes],
                **tally.as_dict(),
            }
        )
    rows = _sort_rows(rows, name_key="title")
    return rows, _classroom_month_summary(rows, total, classroom), orphans


def classroom_month_rows(classroom, month) -> list[dict]:
    """One row per countable midterm this classroom sat in ``month``, best rate first."""
    return classroom_month(classroom, month)[0]


def classroom_month_summary(classroom, month) -> dict:
    """One classroom's whole month: the pooled tally over its midterms, and what it covered."""
    return classroom_month(classroom, month)[1]


def school_month_stats(month, *, branch_id=None, subject=None, teacher_id=None) -> dict:
    """The whole school for one month: totals, then branches, departments, teachers, classes.

    Every level is the SAME pooled formula over the same tallies — the branch figure is not
    an average of its classrooms, it is its classrooms' passers over its classrooms' rosters.

    ``subject`` accepts either subject vocabulary (see :data:`SUBJECT_ALIASES`) and filters
    on the CLASSROOM's, because a department is a ``Classroom.subject``.
    """
    def shell(orphans=()):
        return {
            "month": month,
            "definition": dict(DEFINITION),
            "totals": {
                **EMPTY_TALLY.as_dict(), "classrooms": 0, "midterms": 0, "distinct_students": 0
            },
            "branches": [],
            "departments": [],
            "teachers": [],
            "classrooms": [],
            # Always present, empty or not: a page that reads the key only when it is there
            # cannot tell "no warnings" from "an older backend that never sent any".
            "orphan_retakes": list(orphans),
        }

    if not month:
        return shell()

    # A filtered request resolves months for its own classrooms only, rather than dating
    # every pair in the school and throwing away all but one branch's worth.
    classrooms, scoped_ids = _scoped_classrooms(
        branch_id=branch_id, subject=subject, teacher_id=teacher_id
    )
    if scoped_ids is not None and not scoped_ids:
        return shell()

    # Resolved before the early returns: a month whose only paper is an orphan retake has no
    # statistics at all, and that is exactly the month whose emptiness needs explaining.
    orphans = orphan_retakes_in(month, scoped_ids)

    pairs = [pair for pair, (key, _basis) in month_index(scoped_ids).items() if key == month]
    if not pairs:
        return shell(orphans)

    by_id = {c.id: c for c in classrooms.filter(id__in={cid for cid, _ in pairs})}
    pairs = [(cid, mid) for cid, mid in pairs if cid in by_id]
    if not pairs:
        return shell(orphans)

    midterm_ids = {mid for _, mid in pairs}
    midterms = {m.id: m for m in Midterm.objects.filter(id__in=midterm_ids)}
    retakes_by_parent: dict[int, list[Midterm]] = {}
    for retake in Midterm.objects.filter(retake_of_id__in=midterm_ids).order_by("id"):
        retakes_by_parent.setdefault(retake.retake_of_id, []).append(retake)

    rosters = {cid: classroom_student_ids(cid) for cid in by_id}
    every_id = list(midterm_ids) + [r.id for group in retakes_by_parent.values() for r in group]
    every_student = {sid for ids in rosters.values() for sid in ids}
    attempts, outcomes = _prefetch(every_id, every_student)

    totals = _Group()
    branches: dict[int | None, _Group] = {}
    departments: dict[str, _Group] = {}
    teachers: dict[int | None, _Group] = {}
    per_classroom: dict[int, _Group] = {}
    # A teacher may hold classes of two subjects, or at two branches; the row says so only
    # when there is one answer, and says nothing rather than picking one when there is not.
    teacher_subjects: dict[int | None, set[str]] = {}
    teacher_branches: dict[int | None, set[str]] = {}
    papers_per_classroom: dict[int, int] = {}
    counted = 0

    for classroom_id, midterm_id in sorted(pairs):
        midterm = midterms.get(midterm_id)
        if midterm is None:  # a grant pointing at a midterm deleted since
            continue
        counted += 1
        papers_per_classroom[classroom_id] = papers_per_classroom.get(classroom_id, 0) + 1
        classroom = by_id[classroom_id]
        roster_ids = rosters.get(classroom_id, [])
        tally = _tally_from(
            midterm, roster_ids, retakes_by_parent.get(midterm_id, []), attempts, outcomes
        )

        totals.add(tally, classroom_id, roster_ids)
        branches.setdefault(classroom.branch_id, _Group()).add(tally, classroom_id, roster_ids)
        departments.setdefault(classroom.subject, _Group()).add(tally, classroom_id, roster_ids)
        teachers.setdefault(classroom.teacher_id, _Group()).add(tally, classroom_id, roster_ids)
        per_classroom.setdefault(classroom_id, _Group()).add(tally, classroom_id, roster_ids)
        teacher_subjects.setdefault(classroom.teacher_id, set()).add(classroom.subject)
        if classroom.branch_id:
            teacher_branches.setdefault(classroom.teacher_id, set()).add(classroom.branch.name)

    def _only(values: set[str]) -> str | None:
        return next(iter(values)) if len(values) == 1 else None

    branch_names = {
        c.branch_id: (c.branch.name if c.branch_id else UNASSIGNED) for c in by_id.values()
    }
    branch_rows = [
        {"id": key, "name": branch_names.get(key, UNASSIGNED), **group.payload()}
        for key, group in branches.items()
    ]
    department_rows = [
        {
            "subject": key,
            "label": _SUBJECT_LABELS.get(key, key),
            "name": _SUBJECT_LABELS.get(key, key),  # so one sort key serves every table
            **group.payload(),
        }
        for key, group in departments.items()
    ]
    teacher_names = {
        c.teacher_id: (display_name(c.teacher) if c.teacher_id else UNASSIGNED)
        for c in by_id.values()
    }
    teacher_rows = []
    for key, group in teachers.items():
        subject_key = _only(teacher_subjects.get(key, set()))
        teacher_rows.append(
            {
                "id": key,
                "name": teacher_names.get(key, UNASSIGNED),
                "subject": subject_key,
                "subject_label": _SUBJECT_LABELS.get(subject_key) if subject_key else None,
                "branch": _only(teacher_branches.get(key, set())),
                **group.payload(),
            }
        )
    classroom_rows = [
        {
            **classroom_brief(by_id[key]),
            **group.payload(),
            "midterms": papers_per_classroom.get(key, 0),
        }
        for key, group in per_classroom.items()
    ]

    return {
        "month": month,
        "definition": dict(DEFINITION),
        "totals": {**totals.payload(), "midterms": counted},
        "branches": _sort_rows(branch_rows),
        "departments": _sort_rows(department_rows),
        "teachers": _sort_rows(teacher_rows),
        "classrooms": _sort_rows(classroom_rows),
        "orphan_retakes": orphans,
    }
