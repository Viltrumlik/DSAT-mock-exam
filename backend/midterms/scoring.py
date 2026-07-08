"""Midterm scorer + review builder.

LOCKED scoring rules (per product decision):
  - Count QUESTIONS, not points (each question equal weight; ``Question.score`` ignored).
  - SCALE_100 = round(correct / total * 100)              (0 when total == 0)
  - SCALE_800 = 200 + round(correct / total * 600)        (200 when total == 0; perfect = 800)
  - Python builtin round() (banker's rounding) so migrated SCALE_100 scores recompute identically.

The single grading atom is ``exams.Question.check_answer`` (reused verbatim, never reimplemented).
The scorer and the review builder share one ``_grade`` pass so a review can NEVER disagree with the
stored score for a newly-scored attempt.

Migrated (historical) attempts copy their FROZEN score verbatim and MUST NOT be re-scored here — the
legacy SCALE_800 formula (per-module SAT cap) differs and re-running would change historical results.
"""

from __future__ import annotations

SCALE_100 = "SCALE_100"
SCALE_800 = "SCALE_800"


def _grade(questions, answers):
    """Yield ``(question, is_correct)`` for each question in the midterm's question set.

    ``answers`` is a FLAT dict ``{str(question_id): answer}``. A missing/blank answer grades
    as incorrect (``check_answer`` returns False), which lowers ``correct_count`` but never
    ``total_count`` — omitted questions still count against the denominator.
    """
    answers = answers or {}
    for q in questions:
        ans = answers.get(str(q.id))
        yield q, bool(q.check_answer(ans))


def compute_score(correct_count: int, total_count: int, scoring_scale: str) -> int:
    """Map a correct/total tally onto the 100 or 800 scale (see module docstring)."""
    if total_count <= 0:
        return 200 if scoring_scale == SCALE_800 else 0
    fraction = correct_count / total_count
    if scoring_scale == SCALE_800:
        return 200 + round(fraction * 600)
    return round(fraction * 100)


def grade_questions(questions, answers, scoring_scale: str) -> dict:
    """Pure tally + score over an explicit question set. Returns score/correct/total."""
    correct_count = 0
    total_count = 0
    for _q, is_correct in _grade(questions, answers):
        total_count += 1
        if is_correct:
            correct_count += 1
    return {
        "score": compute_score(correct_count, total_count, scoring_scale),
        "correct_count": correct_count,
        "total_count": total_count,
        "scoring_scale": scoring_scale,
    }


def score_midterm_attempt(attempt) -> dict:
    """Compute the score for a MidtermAttempt from the midterm's authoritative question set."""
    midterm = attempt.midterm
    questions = list(midterm.questions())
    return grade_questions(questions, attempt.answers or {}, midterm.scoring_scale)


def build_midterm_review(attempt, *, include_answer_key: bool = False) -> dict:
    """Per-question review rows for the exam-runner review visuals.

    ``include_answer_key`` defaults to False: student-facing reviews NEVER expose
    ``correct_answers``/``is_correct``/per-option correctness (LOCKED masking decision). A
    teacher/admin/staff review may pass ``include_answer_key=True``.

    The score is recomputed via the SAME ``_grade`` pass as ``score_midterm_attempt`` so a
    review is byte-consistent with the stored score for freshly-scored attempts.
    """
    midterm = attempt.midterm
    questions = list(midterm.questions())
    answers = attempt.answers or {}
    correct_count = 0
    rows = []
    for q in questions:
        student_ans = answers.get(str(q.id))
        is_correct = bool(q.check_answer(student_ans))
        if is_correct:
            correct_count += 1
        row = {
            "id": q.id,
            "student_answer": student_ans,
            "score": int(q.score or 0),
            "text": q.question_text,
            "question_prompt": q.question_prompt,
            "image": q.question_image.url if getattr(q, "question_image", None) else None,
            "type": q.get_question_type_display(),
            "options": q.get_options(),
            "is_math_input": q.is_math_input,
        }
        if include_answer_key:
            row["is_correct"] = is_correct
            row["correct_answers"] = q.correct_answers
        rows.append(row)
    total_count = len(questions)
    return {
        "score": compute_score(correct_count, total_count, midterm.scoring_scale),
        "correct_count": correct_count,
        "total_count": total_count,
        "scoring_scale": midterm.scoring_scale,
        "questions": rows,
    }
