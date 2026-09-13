"""My Progress — you, beside your group.

The progress ladder (``classes.progress``) answers "how did each level go". This answers the
question a student asks straight after: "is that good?" — by putting their numbers for the class
they are in NOW beside the same numbers for the rest of that class. The owner, 2026-09-13:
*"student progressi o'zini classroomdagi guruhdoshlarini attendance bilan solishtirilsin"*.

Three rules, and each one is the reason for a piece of code below.

**The same definitions, or the comparison is a lie.** Every figure is computed from the primitives
the ladder uses for the student's own number: ``compute_attendance_score`` over every MARKED record
(not gated on FINALIZED — see ``progress._attendance_for`` for why), and
``analytics._completion_map`` over PUBLISHED homework with classwork left out (see
``progress._homework_for``). The student's own value comes out of the same pass as their
classmates', and a test pins it to the ladder's number for the same classroom.

**Only aggregates leave this module.** No classmate's name, id or individual value — the average
and median over the group, and which quarter of the group the student stands in. Nothing finer.

**Too small a group says nothing.** Below ``MIN_PEERS`` classmates with a value, the group figures
are ``None``. With one classmate, "your group's average" and your own number ARE their number; a
few more only blur it. The page says why the figure is missing rather than showing a thin one.
"""

from __future__ import annotations

import math
from collections import defaultdict
from statistics import median

from .attendance import compute_attendance_score
from .models import Assignment, Classroom, ClassroomMembership
from .models_attendance import AttendanceRecord
from .progress import combined_rate, student_progress

#: Fewest classmates (not counting the student) who must have a value before any group figure is
#: shown. Four keeps a single classmate's number from being recoverable out of an average.
MIN_PEERS = 4

#: How many of the student's own marked lessons the strip shows, newest last.
RECENT_LESSONS = 8

#: How many calendar months the attendance trend reaches back over (months with marks only).
TREND_MONTHS = 4

#: Standing is a band, never a rank: "top quarter" is something to aim at, "17th of 18" is not.
STANDING_TOP_QUARTER = "top_quarter"
STANDING_UPPER_HALF = "upper_half"
STANDING_LOWER_HALF = "lower_half"


def _cohort_ids(classroom: Classroom) -> list[int]:
    """The classroom's students: ACTIVE and STUDENT — exactly the roster the class lists.

    Not every membership row. Removal is a soft delete, so an unfiltered count carries every
    student who ever left, and the teacher and TAs besides (the #125 bug class). A group average
    over people who are not in the group describes nobody.
    """
    return list(
        ClassroomMembership.objects.filter(
            classroom=classroom,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        ).values_list("user_id", flat=True)
    )


def _attendance_rows(classroom: Classroom, student_ids: list[int]):
    """Every marked record for these students in this classroom, in ONE query.

    ``(student_id, status, session_date)`` — the same rows ``progress._attendance_for`` reads for
    one student, for all of them at once.
    """
    return AttendanceRecord.objects.filter(
        session__classroom=classroom, student_id__in=student_ids
    ).values_list("student_id", "status", "session__date")


def _published_homework(classroom: Classroom) -> tuple[list[Assignment], list[Assignment]]:
    """``(assignments, published)`` exactly as ``progress._homework_for`` selects them."""
    from .analytics import _academic_assignments

    assignments = [
        a for a in _academic_assignments(classroom) if a.category != Assignment.CATEGORY_CLASSWORK
    ]
    published = [a for a in assignments if a.status == Assignment.STATUS_PUBLISHED]
    return assignments, published


def _standings_hidden(classroom: Classroom) -> bool:
    """Has the teacher hidden this class's leaderboard from students?

    Then no band either: "top quarter of your group" is a ranking in all but name, and a teacher
    who chose HIDDEN chose that students should not be ranked against each other. The averages
    stay — an average ranks nobody. Read without ``get_or_create``: a GET must not write a config
    row, and a class with no row is on the model's default (FULL).
    """
    from .models_ranking import ClassroomRankingConfig

    mode = (
        ClassroomRankingConfig.objects.filter(classroom=classroom)
        .values_list("leaderboard_mode", flat=True)
        .first()
    )
    return mode == ClassroomRankingConfig.MODE_HIDDEN


def _words_mastered(student_ids: list[int]) -> dict[int, float]:
    """Vocabulary words each student has proved in all four games, in one grouped query.

    Mastery is per student across the whole site, not per classroom — a word learned in one
    class is learned. Zero is a real measurement here (never opened vocabulary), so every student
    on the roster has a value.
    """
    from django.db.models import Count

    from vocabulary.models import VocabWordProgress

    counts = dict(
        VocabWordProgress.objects.filter(
            user_id__in=student_ids, status=VocabWordProgress.STATUS_MASTERED
        )
        .order_by()  # a default ordering would split the GROUP BY
        .values("user_id")
        .annotate(n=Count("id"))
        .values_list("user_id", "n")
    )
    return {sid: float(counts.get(sid, 0)) for sid in student_ids}


def _metric(values: dict[int, float | None], student_id: int, *, rank: bool = True) -> dict:
    """You, the group's average and median, and your band — or ``None`` where it can't be said."""
    mine = values.get(student_id)
    measured = [v for v in values.values() if v is not None]
    others = [v for sid, v in values.items() if sid != student_id and v is not None]
    enough = len(others) >= MIN_PEERS

    standing = None
    if rank and enough and mine is not None:
        # Ties count in the student's favour: sharing a 100% with half the class is the top.
        at_or_below = sum(1 for v in others if v <= mine) / len(others)
        standing = (
            STANDING_TOP_QUARTER if at_or_below >= 0.75
            else STANDING_UPPER_HALF if at_or_below >= 0.5
            else STANDING_LOWER_HALF
        )

    return {
        "you": mine,
        "group_average": round(sum(measured) / len(measured), 1) if enough else None,
        "group_median": round(float(median(measured)), 1) if enough else None,
        # How many students the group figures are over, the student included when measured —
        # so "average of 17" is checkable against "18 students".
        "measured": len(measured) if enough else None,
        "standing": standing,
    }


def _attendance_trend(rows, student_id: int) -> list[dict]:
    """Month by month, the student's attendance and the group's, for the last few marked months."""
    by_month: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
    for sid, status, day in rows:
        by_month[day.strftime("%Y-%m")][sid].append(status)

    trend = []
    for month in sorted(by_month)[-TREND_MONTHS:]:
        rates = {sid: compute_attendance_score(statuses) for sid, statuses in by_month[month].items()}
        metric = _metric(rates, student_id)
        trend.append({"month": month, "you": metric["you"], "group": metric["group_average"]})
    return trend


def _group_for(level_row: dict, subject: str, subject_label: str, student) -> dict | None:
    """The comparison for the classroom on the student's current rung of one subject."""
    classroom = Classroom.objects.filter(pk=level_row["classroom_id"]).first()
    if classroom is None:
        return None

    cohort = _cohort_ids(classroom)
    # The student is always in their own comparison, even on a membership the roster doesn't
    # list (an INVITED seat the ladder still counts) — "you" must never go missing.
    student_ids = sorted(set(cohort) | {student.id})

    rows = list(_attendance_rows(classroom, student_ids))
    statuses: dict[int, list[str]] = defaultdict(list)
    for sid, status, _day in rows:
        statuses[sid].append(status)
    attendance_rates = {sid: compute_attendance_score(statuses.get(sid, [])) for sid in student_ids}

    assignments, published = _published_homework(classroom)
    if published:
        from .analytics import _completion_map

        done = _completion_map(classroom, student_ids, assignments)
        published_ids = {a.id for a in published}
        completed = {sid: len(published_ids & done.get(sid, set())) for sid in student_ids}
        homework_rates = {
            sid: round(100.0 * completed[sid] / len(published), 1) for sid in student_ids
        }
    else:
        completed = {sid: 0 for sid in student_ids}
        homework_rates = {sid: None for sid in student_ids}

    overall_rates = {
        sid: combined_rate(attendance_rates[sid], homework_rates[sid])[0] for sid in student_ids
    }

    rank = not _standings_hidden(classroom)
    attendance = _metric(attendance_rates, student.id, rank=rank)
    my_statuses = statuses.get(student.id, [])
    attendance["detail"] = {
        "present": my_statuses.count(AttendanceRecord.STATUS_PRESENT),
        "late": my_statuses.count(AttendanceRecord.STATUS_LATE),
        "absent": my_statuses.count(AttendanceRecord.STATUS_ABSENT),
        "excused": my_statuses.count(AttendanceRecord.STATUS_EXCUSED),
    }

    homework = _metric(homework_rates, student.id, rank=rank)
    total = len(published)
    mine_done = completed.get(student.id, 0)
    to_reach = 0
    if homework["group_average"] is not None and total:
        # The smallest number of further pieces that would lift the student to the group's
        # average — a thing they can go and do, where "8 points below" is only a verdict.
        to_reach = max(0, math.ceil(homework["group_average"] * total / 100 - 1e-9) - mine_done)
    homework["detail"] = {
        "completed": mine_done,
        "total": total,
        "remaining": max(0, total - mine_done),
        "to_reach_average": to_reach,
    }

    mine_rows = sorted(
        ((day, status) for sid, status, day in rows if sid == student.id), key=lambda r: r[0]
    )
    recent = [
        {"date": day.isoformat(), "status": status} for day, status in mine_rows[-RECENT_LESSONS:]
    ]

    metrics = {
        "attendance": attendance,
        "homework": homework,
        "overall": _metric(overall_rates, student.id, rank=rank),
    }
    # Vocabulary is the English side of the course; on a Math group it would compare a thing
    # the class does not teach.
    if subject == "english":
        metrics["vocabulary"] = _metric(_words_mastered(student_ids), student.id, rank=rank)

    return {
        "subject": subject,
        "subject_label": subject_label,
        "classroom_id": classroom.id,
        "classroom_name": classroom.name,
        "level": level_row["level"],
        "level_label": level_row["level_label"],
        "group_size": len(student_ids),
        # Said, so the page can explain a missing band instead of looking broken.
        "standings_hidden": not rank,
        "metrics": metrics,
        "recent_lessons": recent,
        "attendance_trend": _attendance_trend(rows, student.id),
    }


def peer_progress(student) -> dict:
    """One comparison per subject, for the classroom the ladder calls the student's current one.

    The current classroom is read off ``student_progress`` itself rather than worked out again, so
    "your group" is always the class the ladder above it marks "Studying now".
    """
    ladder = student_progress(student)
    groups = []
    for track in ladder["tracks"]:
        current = next(
            (lv for lv in track["levels"] if lv["state"] == "current" and lv["classroom_id"]), None
        )
        if current is None:
            continue
        group = _group_for(current, track["subject"], track["subject_label"], student)
        if group is not None:
            groups.append(group)
    return {"groups": groups, "min_peers": MIN_PEERS}
