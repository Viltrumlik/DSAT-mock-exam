"""The error report: what a student got wrong on a pastpaper, and what it has in common.

A list of wrong question numbers is not a report — it tells a student they made mistakes,
which they knew. The useful shape is **grouped by skill**, because that is the thing they can
go and practise: "four of your six mistakes were Linear Functions" is an instruction, and
"you got questions 7, 12, 19, 23, 31 and 34 wrong" is not.

Derived live from the attempt, never frozen. `TestAttempt.get_module_results()` already
computes per-question correctness at read time, and a report that cached its own copy would
disagree with the review screen the moment an answer key was corrected — which happens on this
platform (midterm 9 had 17 mis-entered keys).

**Unclassified questions get their own bucket rather than being dropped.** Roughly 2000 legacy
questions predate `Question.skill`, so silently omitting them would produce a report whose
totals do not add up to the student's own score — the fastest way to make them stop trusting
it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Bucket for questions with no skill attached. Named, not blank — a heading a student can
#: read beats an empty one they cannot.
UNCLASSIFIED = "Unclassified"


@dataclass
class SkillBucket:
    skill: str
    domain: str
    wrong: int = 0
    total: int = 0
    question_numbers: list = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        return round(100.0 * (self.total - self.wrong) / self.total, 1) if self.total else 0.0


def _skill_map(question_ids):
    """``{question_id: (skill_name, domain_name)}`` in one query."""
    if not question_ids:
        return {}
    from exams.models import Question

    rows = (
        Question.objects.filter(pk__in=question_ids)
        .select_related("skill", "skill__domain")
        .values_list("id", "skill__name", "skill__domain__name")
    )
    return {
        qid: (skill or UNCLASSIFIED, domain or UNCLASSIFIED)
        for qid, skill, domain in rows
    }


def build_error_report(attempt) -> dict:
    """Everything the report needs, for one completed attempt.

    Returns ``{"total", "correct", "wrong", "accuracy", "skills": [...], "questions": [...]}``.
    ``skills`` is ordered worst-first — the point of the report is what to work on, so the
    weakest skill has to be the first thing read, not something found by scrolling.
    """
    modules = attempt.get_module_results() or []

    numbered = []
    order = 0
    for module in modules:
        for question in module.get("questions") or []:
            order += 1
            numbered.append((order, module, question))

    skills = _skill_map([q.get("id") for _n, _m, q in numbered if q.get("id")])

    buckets: dict[str, SkillBucket] = {}
    questions = []
    wrong_total = 0

    for number, module, question in numbered:
        skill, domain = skills.get(question.get("id"), (UNCLASSIFIED, UNCLASSIFIED))
        bucket = buckets.setdefault(skill, SkillBucket(skill=skill, domain=domain))
        bucket.total += 1

        is_correct = bool(question.get("is_correct"))
        if not is_correct:
            wrong_total += 1
            bucket.wrong += 1
            bucket.question_numbers.append(number)
            questions.append({
                "number": number,
                "module": module.get("module_order"),
                "skill": skill,
                "domain": domain,
                # Both answers, because "wrong" without the right answer is a scolding rather
                # than a lesson.
                "your_answer": _clean(question.get("student_answer")),
                "correct_answer": _clean(question.get("correct_answers")),
            })

    total = len(numbered)
    ranked = sorted(
        buckets.values(),
        # Worst first: most mistakes, then lowest accuracy, then name so the order is stable
        # between two calls that produce the same numbers.
        key=lambda b: (-b.wrong, b.accuracy, b.skill),
    )

    return {
        "total": total,
        "correct": total - wrong_total,
        "wrong": wrong_total,
        "accuracy": round(100.0 * (total - wrong_total) / total, 1) if total else 0.0,
        "skills": [
            {
                "skill": b.skill,
                "domain": b.domain,
                "wrong": b.wrong,
                "total": b.total,
                "accuracy": b.accuracy,
                "question_numbers": b.question_numbers,
            }
            for b in ranked
        ],
        "questions": questions,
        # The one sentence worth putting at the top. Growth-oriented on purpose: this screen
        # is read straight after a disappointing score, and the school's rule is that student
        # copy never punishes.
        "headline": _headline(wrong_total, total, ranked),
    }


def _clean(value) -> str:
    """Answers arrive as a string, a list, or None depending on the question type."""
    if value is None:
        return "—"
    if isinstance(value, (list, tuple, set)):
        return ", ".join(str(v) for v in value if v not in (None, "")) or "—"
    text = str(value).strip()
    return text or "—"


def _headline(wrong: int, total: int, ranked) -> str:
    if total == 0:
        return "No questions to review yet."
    if wrong == 0:
        return "Nothing to review — every question correct."
    focus = ranked[0] if ranked and ranked[0].wrong else None
    if focus and focus.skill != UNCLASSIFIED and focus.wrong > 1:
        return f"Start with {focus.skill} — {focus.wrong} of your {wrong} mistakes are there."
    return f"{wrong} question{'' if wrong == 1 else 's'} to look at again."
