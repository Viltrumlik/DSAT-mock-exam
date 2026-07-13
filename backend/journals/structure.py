"""Course structure for Journals.

Every level's course collapses to one uniform rule (verified against the product spec):

    total_lessons = 12 * duration_months
    a MIDTERM lesson at every multiple of 12; every other lesson is a HOMEWORK lesson.

    Subject · Level        Months  Lessons  Midterms
    Math · Foundation        1       12      @12
    English/Math · Junior    3       36      @12,24,36
    English/Math · Middle    2       24      @12,24
    English/Math · Senior    2       24      @12,24

English has **no** Foundation, so it is absent from the map below (7 journals total).
"""

from __future__ import annotations

# Subjects are stored uppercase (mirrors classes.Classroom.subject); levels lowercase
# (mirrors classes.Classroom.level / assessments.AssessmentSet.level).
SUBJECT_ENGLISH = "ENGLISH"
SUBJECT_MATH = "MATH"

LESSON_TYPE_HOMEWORK = "HOMEWORK"
LESSON_TYPE_MIDTERM = "MIDTERM"

MIDTERM_INTERVAL = 12
LESSONS_PER_MONTH = 12

# (subject, level) -> duration in months
COURSE_STRUCTURE: dict[tuple[str, str], int] = {
    (SUBJECT_MATH, "foundation"): 1,
    (SUBJECT_ENGLISH, "junior"): 3,
    (SUBJECT_MATH, "junior"): 3,
    (SUBJECT_ENGLISH, "middle"): 2,
    (SUBJECT_MATH, "middle"): 2,
    (SUBJECT_ENGLISH, "senior"): 2,
    (SUBJECT_MATH, "senior"): 2,
}


class InvalidCourse(ValueError):
    """Raised when a (subject, level) pair is not a real course (e.g. English + Foundation)."""


def _key(subject: str, level: str) -> tuple[str, str]:
    return (str(subject or "").upper(), str(level or "").lower())


def is_valid_course(subject: str, level: str) -> bool:
    return _key(subject, level) in COURSE_STRUCTURE


def months_for(subject: str, level: str) -> int:
    key = _key(subject, level)
    if key not in COURSE_STRUCTURE:
        raise InvalidCourse(
            f"No course exists for subject={subject!r} level={level!r} "
            f"(English has no Foundation)."
        )
    return COURSE_STRUCTURE[key]


def total_lessons_for(subject: str, level: str) -> int:
    return months_for(subject, level) * LESSONS_PER_MONTH


def lesson_plan(subject: str, level: str) -> list[tuple[int, str]]:
    """Return [(lesson_number, lesson_type), ...] for one course, 1-indexed."""
    total = total_lessons_for(subject, level)
    return [
        (
            n,
            LESSON_TYPE_MIDTERM if n % MIDTERM_INTERVAL == 0 else LESSON_TYPE_HOMEWORK,
        )
        for n in range(1, total + 1)
    ]


def all_courses() -> list[tuple[str, str]]:
    """Every valid (subject, level) pair — the 7 canonical journals."""
    return list(COURSE_STRUCTURE.keys())
