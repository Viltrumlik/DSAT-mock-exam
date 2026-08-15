"""The error report: what a student got wrong on a pastpaper, and what it has in common.

**Deliberately the same payload as the midterm error report** (``midterms.views_report.
build_error_report``), because the two are rendered by the same code — a student who sits both
should be handed the same document with a different title, not two sheets that happen to be
about the same thing. Every key the shared renderer reads is here under the same name, and the
extra ``questions`` list is additive: only the in-app screen uses it.

A list of wrong question numbers is not a report — it tells a student they made mistakes,
which they knew. The useful shape is **grouped by skill**, because that is the thing they can
go and practise: "five of your eleven mistakes were Linear Functions" is an instruction, and
"you got questions 7, 12, 19, 23, 31 and 34 wrong" is not.

Two places this differs from the midterm builder, both forced rather than chosen:

**Derived live, not from frozen rows.** A midterm freezes ``MidtermQuestionResult`` at scoring
time and rebuilds from those, because midterm content is live-synced from the builder and a
re-derived report would disagree with the score the student was given. A pastpaper has no such
table — ``TestAttempt`` stores answers and one scalar score, and correctness is computed at
read time by ``get_module_results()``. Live is the only option here without adding a freeze
table, and it has a compensation: a corrected answer key reaches a student who opens their
report afterwards.

**Unclassified questions are disclosed, not bucketed as a skill.** Same rule the midterm
report follows — they are counted separately and reported in a footnote, rather than folded
into a skill row where they would quietly inflate that skill's question count. ~2000 legacy
questions predate ``Question.skill``, so this is the common case, not an edge one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: What an untagged question is called on the in-app screen. It never becomes a skill row on
#: the report — see the module docstring.
UNCLASSIFIED = "Untagged"

#: Matches `midterms.views_report.SUBJECT_LABELS` so the two sheets name a subject identically.
_SUBJECT_LABELS = {"MATH": "Mathematics", "READING_WRITING": "English"}


def _display_name(user) -> str:
    full = (user.get_full_name() or "").strip() if hasattr(user, "get_full_name") else ""
    return full or getattr(user, "username", None) or getattr(user, "email", "") or "Student"


def _report_date(attempt) -> str:
    """"15 August 2026" — no leading zero, and platform-independent (`%-d` is glibc-only)."""
    when = getattr(attempt, "completed_at", None) or getattr(attempt, "submitted_at", None)
    if when is None:
        return ""
    return f"{when.day} {when.strftime('%B %Y')}"


@dataclass
class SkillBucket:
    skill_id: object
    skill: str
    domain: str
    wrong: int = 0
    total: int = 0
    question_numbers: list = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        return round(100.0 * (self.total - self.wrong) / self.total, 1) if self.total else 0.0


def _skill_map(question_ids):
    """``{question_id: (skill_id, skill_name, domain_name)}`` in one query."""
    if not question_ids:
        return {}
    from exams.models import Question

    rows = (
        Question.objects.filter(pk__in=question_ids)
        .select_related("skill", "skill__domain")
        .values_list("id", "skill_id", "skill__name", "skill__domain__name")
    )
    return {qid: (skill_id, skill, domain) for qid, skill_id, skill, domain in rows}


def build_error_report(attempt) -> dict:
    """Everything the report needs, for one completed attempt.

    Carries the midterm payload's keys verbatim — ``correct_count``, ``total_count``,
    ``skills[{skill_id, skill, domain, total, wrong}]``, ``unclassified_total``,
    ``unclassified_wrong`` — so ``midterms.report_pdf`` can draw it unchanged. The rest
    (``accuracy``, ``questions``, ``headline``) is additive and only the in-app screen reads
    it.
    """
    modules = attempt.get_module_results() or []

    numbered = []
    order = 0
    for module in modules:
        for question in module.get("questions") or []:
            order += 1
            numbered.append((order, module, question))

    skills = _skill_map([q.get("id") for _n, _m, q in numbered if q.get("id")])

    buckets: dict[object, SkillBucket] = {}
    questions = []
    wrong_total = 0
    unclassified_total = 0
    unclassified_wrong = 0

    for number, module, question in numbered:
        skill_id, skill, domain = skills.get(question.get("id"), (None, "", ""))
        is_correct = bool(question.get("is_correct"))
        tagged = bool(skill_id or skill)

        if tagged:
            # Keyed on the FK, falling back to the name, so a retired taxonomy row still
            # groups — the same key the midterm builder uses.
            key = skill_id or f"name:{skill}"
            bucket = buckets.setdefault(
                key, SkillBucket(skill_id=skill_id, skill=skill, domain=domain or "")
            )
            bucket.total += 1
            if not is_correct:
                bucket.wrong += 1
                bucket.question_numbers.append(number)
        else:
            # Counted, never folded into a skill row: doing that would inflate that skill's
            # question count and quietly misstate its accuracy. Disclosed in a footnote.
            unclassified_total += 1
            if not is_correct:
                unclassified_wrong += 1

        if not is_correct:
            wrong_total += 1
            questions.append({
                "number": number,
                "module": module.get("module_order"),
                "skill": skill or UNCLASSIFIED,
                "domain": domain or UNCLASSIFIED,
                # Both answers, because "wrong" without the right answer is a scolding rather
                # than a lesson.
                "your_answer": _clean(question.get("student_answer")),
                "correct_answer": _clean(question.get("correct_answers")),
            })

    total = len(numbered)
    correct = total - wrong_total

    # Only skills that actually cost marks — a fully-correct skill is not an error. Same rule,
    # and the same sort key, as the midterm report.
    ranked = sorted(
        (b for b in buckets.values() if b.wrong > 0),
        key=lambda b: (-b.wrong, b.skill),
    )

    paper = attempt.practice_test
    return {
        "attempt_id": attempt.pk,
        "student_name": _display_name(attempt.student),
        "date": _report_date(attempt),
        # `exam`, not `midterm` — the shared renderer reads either, and a pastpaper carrying a
        # dict called "midterm" would be a lie in the payload to save one line there.
        "exam": {
            "title": (getattr(paper, "collection_name", "") or getattr(paper, "title", "")
                      or "Past Paper"),
            "subject": getattr(paper, "subject", "") or "",
            "subject_label": _SUBJECT_LABELS.get(getattr(paper, "subject", ""), "Past Paper"),
            "score_ceiling": 800,
        },
        "score": attempt.score,
        "correct_count": correct,
        "total_count": total,
        "unclassified_total": unclassified_total,
        "unclassified_wrong": unclassified_wrong,
        "skills": [
            {
                "skill_id": b.skill_id,
                "skill": b.skill,
                "domain": b.domain,
                "total": b.total,
                "wrong": b.wrong,
                "accuracy": b.accuracy,
                "question_numbers": b.question_numbers,
            }
            for b in ranked
        ],
        # Additive — the shared PDF renderer ignores these.
        "wrong": wrong_total,
        "accuracy": round(100.0 * correct / total, 1) if total else 0.0,
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
    focus = ranked[0] if ranked else None
    if focus and focus.wrong > 1:
        return f"Start with {focus.skill} — {focus.wrong} of your {wrong} mistakes are there."
    return f"{wrong} question{'' if wrong == 1 else 's'} to look at again."
