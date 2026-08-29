"""My Progress — how far a student is through each level they have studied.

One number per level, out of two halves the school named: **did they turn up**, and **did
they do the work**. Both already exist as primitives elsewhere; nothing here re-implements
either, because a second copy of "has this student completed that homework" is how a progress
page ends up disagreeing with the gradebook it is supposed to summarise.

    attendance  ← the weighted percent from `classes.attendance`, minus its FINALIZED gate
    homework    ← `classes.analytics._completion_map`, the one canonical completion primitive

**A level is anchored to a CLASSROOM, not to the student.** Level lives on
``Classroom.level`` (a student has no level of their own — ``users/models.py`` forbids it),
so "how did they do at Junior" is answerable exactly for the levels they have actually sat in
a classroom for. A level nobody enrolled them at has no attendance register and no homework,
and is reported as having no record rather than as 0%.

That is also why this reaches back through EVERY non-removed membership rather than only the
current one, the way ``roadmap.build_roadmap`` does: the roadmap answers "where are you now",
and this page answers "how did each level go", which is a question about levels the student
has already left.
"""

from __future__ import annotations

from collections import defaultdict

from .attendance import compute_attendance_score
from .models import Classroom, ClassroomMembership
from .models_attendance import AttendanceRecord

#: Display order of the ladder — the union of every level any subject offers. Each track
#: filters this through its own subject's offered set, exactly as the roadmap does.
_LEVEL_ORDER = [
    Classroom.LEVEL_FOUNDATION,
    Classroom.LEVEL_JUNIOR,
    Classroom.LEVEL_MIDDLE,
    Classroom.LEVEL_SENIOR,
]
_LEVEL_LABELS = dict(Classroom.LEVEL_CHOICES)

#: (classroom subject constant, domain subject, human label). Ordered for stable display.
_SUBJECTS = [
    (Classroom.SUBJECT_MATH, "math", "Math"),
    (Classroom.SUBJECT_ENGLISH, "english", "English"),
]

#: How the two halves combine. Equal by decision, not by derivation.
#:
#: Nothing in this codebase currently mixes attendance with homework for a student — the one
#: formula that did (``classes/ranking/academic.py``) has been dead since the XP cutover and
#: its attendance weight defaulted to 0.00. So this is a product choice and is written as one
#: named constant rather than smuggled into an expression: turning up and doing the work are
#: the two things the school asks of a student, and it did not say one counts for more.
WEIGHT_ATTENDANCE = 0.5
WEIGHT_HOMEWORK = 0.5


def _attendance_for(classroom, student) -> dict | None:
    """This student's attendance in one classroom, or ``None`` if nothing is marked.

    **Deliberately NOT gated on FINALIZED sessions**, unlike ``classes.attendance``'s own
    readers. Production has 111 attendance sessions and has never finalized one — both
    ``rewards.hooks`` and ``rewards.strikes`` dropped the same gate for the same reason, and
    recorded the measurement. Keeping it here would make this page show an em dash for every
    student in the school while their teachers can see the register full of marks, and would
    quietly reduce a "combined" percentage to homework-only with nothing saying so.

    A gate keyed on a step humans are not required to take is an off switch, not caution.

    EXCUSED is excluded from the denominator rather than counted as an absence — the rule
    ``compute_attendance_score`` states, restated here only because the counts below are
    shown next to the percentage and have to agree with it.
    """
    rows = list(
        AttendanceRecord.objects.filter(session__classroom=classroom, student=student)
        .values_list("status", flat=True)
    )
    if not rows:
        return None
    counts = defaultdict(int)
    for status in rows:
        counts[status] += 1
    return {
        "rate": compute_attendance_score(rows),
        "present": counts[AttendanceRecord.STATUS_PRESENT],
        "late": counts[AttendanceRecord.STATUS_LATE],
        "absent": counts[AttendanceRecord.STATUS_ABSENT],
        "excused": counts[AttendanceRecord.STATUS_EXCUSED],
        # What the percentage is actually out of, so "92% of 14" is checkable on screen.
        "counted": len(rows) - counts[AttendanceRecord.STATUS_EXCUSED],
    }


def _homework_for(classroom, student) -> dict | None:
    """This student's homework completion in one classroom, or ``None`` if none was set.

    Measured against PUBLISHED work only. DRAFT never counts, and ARCHIVED keeps its grade
    but LEAVES the denominator — which means a teacher archiving old work raises every
    student's percentage. That is the rule the gradebook already uses; agreeing with it
    matters more here than picking a different one.
    """
    from .analytics import _academic_assignments, _completion_map
    from .models import Assignment

    assignments = _academic_assignments(classroom)
    published = [a for a in assignments if a.status == Assignment.STATUS_PUBLISHED]
    if not published:
        return None
    done = _completion_map(classroom, [student.id], assignments).get(student.id, set())
    completed = len({a.id for a in published} & done)
    return {
        "rate": round(100.0 * completed / len(published), 1),
        "completed": completed,
        "total": len(published),
    }


def combined_rate(attendance_rate, homework_rate) -> tuple[float | None, list[str]]:
    """One percentage out of the halves that are known, and which halves those were.

    Returns ``(None, [])`` when neither half can be measured. It does NOT return 0.

    A rate over an empty denominator is "we don't know", not "you have done none of it" —
    the rule ``roadmap._track_progress`` already states and ``DashboardProgress`` already
    renders as an em dash. A student whose classroom has not had a lesson yet must not be
    shown 0% complete.

    When only one half exists the answer is that half, and ``basis`` says so, in the manner
    of ``months_to_sat_basis``. Averaging a known 90 with an unknown treated as 0 would
    invent a 45 that describes nothing.
    """
    parts: list[tuple[float, float]] = []
    basis: list[str] = []
    if attendance_rate is not None:
        parts.append((WEIGHT_ATTENDANCE, float(attendance_rate)))
        basis.append("attendance")
    if homework_rate is not None:
        parts.append((WEIGHT_HOMEWORK, float(homework_rate)))
        basis.append("homework")
    if not parts:
        return None, []
    weight = sum(w for w, _ in parts)
    return round(sum(w * v for w, v in parts) / weight, 1), basis


def _classrooms_by_level(student) -> dict[str, dict[str, Classroom]]:
    """``{classroom_subject: {level: classroom}}`` over every class this student has sat in.

    ``NON_REMOVED_STATUSES``, not ``STATUS_ACTIVE`` alone — the rule stated on
    ``ClassroomMembership`` and followed by every other sweep in this codebase. An INVITED
    student who has attendance marked against them has attended.

    Where a student has been in TWO classrooms at one level (a transfer, a repeat), the
    most-recently-joined one wins, matching ``roadmap.build_roadmap``. The other one's marks
    are not merged in: the two have separate registers and separate homework, and adding
    them would produce a percentage that is not true of either.
    """
    by_subject: dict[str, dict[str, Classroom]] = defaultdict(dict)
    memberships = (
        ClassroomMembership.objects.filter(
            user=student,
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        )
        .select_related("classroom")
        .order_by("joined_at", "id")   # later rows overwrite earlier ones
    )
    for membership in memberships:
        classroom = membership.classroom
        if not classroom or not classroom.level:
            continue
        by_subject[classroom.subject][classroom.level] = classroom
    return by_subject


def student_progress(student) -> dict:
    """The whole page: one track per subject, one row per level of that subject's ladder."""
    by_subject = _classrooms_by_level(student)
    tracks = []

    for subject_key, domain, label in _SUBJECTS:
        classrooms = by_subject.get(subject_key, {})
        offered = [lv for lv in _LEVEL_ORDER if lv in Classroom.allowed_levels_for_subject(subject_key)]
        # The safety valve `roadmap.build_roadmap` already has, and for the same reason: a
        # classroom MIS-TAGGED with a level its subject does not offer (an English class at
        # `foundation`) keeps its rung anyway. Without this the student's real classroom —
        # its attendance, its homework, its name — vanished from the payload entirely, and
        # the page told them every English level was still ahead of them while they sat in
        # one. A rung that should not exist is a data-entry mistake to show, not to hide.
        offered += [lv for lv in _LEVEL_ORDER if lv in classrooms and lv not in offered]
        if not classrooms:
            # A subject the student does not study at all is left out entirely rather than
            # shown as an empty ladder. English has no Foundation rung either — `offered`
            # already handles that, and a mis-tagged classroom keeps its rung below.
            continue

        # "Where they are now" is the highest rung they hold a classroom at. Highest, not
        # most-recent: a student who joined a Junior revision group while sitting Middle has
        # not gone backwards.
        studied = [lv for lv in offered if lv in classrooms]
        current = studied[-1] if studied else None

        levels = []
        for level in offered:
            classroom = classrooms.get(level)
            if classroom is None:
                # No classroom at this rung — nothing to measure. Below their current level
                # it means they joined the course part-way through; above it, they have not
                # got there yet. Either way it is "no record", never 0%.
                state = (
                    "upcoming"
                    if current is None or offered.index(level) > offered.index(current)
                    else "not-recorded"
                )
                levels.append({
                    "level": level,
                    "level_label": _LEVEL_LABELS.get(level, level),
                    "state": state,
                    "classroom_id": None,
                    "classroom_name": None,
                    "attendance": None,
                    "homework": None,
                    "overall": None,
                    "basis": [],
                })
                continue

            attendance = _attendance_for(classroom, student)
            homework = _homework_for(classroom, student)
            overall, basis = combined_rate(
                attendance["rate"] if attendance else None,
                homework["rate"] if homework else None,
            )
            levels.append({
                "level": level,
                "level_label": _LEVEL_LABELS.get(level, level),
                "state": "current" if level == current else "done",
                "classroom_id": classroom.id,
                "classroom_name": classroom.name,
                "attendance": attendance,
                "homework": homework,
                "overall": overall,
                "basis": basis,
            })

        tracks.append({
            "subject": domain,
            "subject_label": label,
            "current_level": current,
            "current_level_label": _LEVEL_LABELS.get(current) if current else None,
            "levels": levels,
        })

    # One figure across everything measurable, for the page header. The mean of the levels
    # that HAVE a number — never of all of them, which would let an untaught rung drag the
    # headline down as though the student had failed a course nobody ran.
    measured = [lv["overall"] for t in tracks for lv in t["levels"] if lv["overall"] is not None]
    return {
        "tracks": tracks,
        "overall": round(sum(measured) / len(measured), 1) if measured else None,
        # What the combination weighted, so the page can say it rather than imply it.
        "weights": {"attendance": WEIGHT_ATTENDANCE, "homework": WEIGHT_HOMEWORK},
    }
