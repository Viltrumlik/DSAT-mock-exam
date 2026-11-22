"""The /ops Groups list in lc-up's shape (canvas board "Groups", owner 22 Nov 2026): what it adds to a class row of
the changelist (``ops_classrooms.class_row``) and to its filters.

Every figure is one we hold: the price and start date are the class's own; trial seats are the seats lc-up marks
"trial" (``ClassroomMembership.seat_status``); "lessons done" counts the registers marked since the course began
(``start_date`` is lc-up's ``course_start_date``), and the course's length is lc-up's own ``lessons_count`` for the
group's course, from the nightly archive. A class with no lc-up course, or a course with no length, has none —
never a guessed one.
"""

from __future__ import annotations

from django.db.models import Count, Exists, F, OuterRef, Q
from django.utils import timezone

from users.changelist import to_int
from users.people_detail import iso

from .models import Classroom, ClassroomMembership
from .ops_classrooms import CLASS_FILTERS, _present, class_row

_SEAT = ClassroomMembership
#: Active student seats lc-up marks "trial" (on a trial lesson).
TRIAL_SEATS = Count(
    "memberships",
    filter=Q(
        memberships__role=_SEAT.ROLE_STUDENT, memberships__status=_SEAT.STATUS_ACTIVE,
        memberships__seat_status=_SEAT.SEAT_TRIAL,
    ),
    distinct=True,
)
#: Every group meets three days a week (ODD = Mon Wed Fri, EVEN = Tue Thu Sat): three lessons or fewer left means
#: the course ends within the week.
ENDS_WITHIN = 3

_LEVEL_ORDER = {level: i for i, (level, _) in enumerate(Classroom.LEVEL_CHOICES)}
_LEVELS = dict(Classroom.LEVEL_CHOICES)
_SUBJECTS = dict(Classroom.SUBJECT_CHOICES)


def course_lengths() -> dict[str, int]:
    """lc-up course id → its lessons (``lessons_count``), for the courses that state one."""
    from lcup.models_archive import ArchiveEntity, LcupArchiveRecord

    out: dict[str, int] = {}
    rows = LcupArchiveRecord.objects.filter(entity=ArchiveEntity.COURSE, gone_at__isnull=True)
    for key, payload in rows.values_list("lcup_id", "payload"):
        n = to_int((payload or {}).get("lessons_count"))
        if n and n > 0:
            out[str(key)] = n
    return out


def lessons_for(rooms, today=None) -> dict[int, dict]:
    """``{class pk: {"done": n, "total": t}}`` for each class that has a start date and an lc-up course of known
    length. ``done`` is the days since the start (today included) whose register holds at least one mark."""
    from lcup.models import GroupLinkStatus, LcupGroupLink

    from .models_attendance import AttendanceRecord, AttendanceSession

    started = [r.pk for r in rooms if getattr(r, "start_date", None)]
    if not started:
        return {}
    lengths = course_lengths()
    if not lengths:
        return {}
    totals: dict[int, int] = {}
    links = LcupGroupLink.objects.filter(classroom_id__in=started, status=GroupLinkStatus.CONFIRMED)
    for classroom_id, snapshot in links.values_list("classroom_id", "snapshot"):
        course = (snapshot or {}).get("course")
        course_id = course.get("id") if isinstance(course, dict) else None
        total = lengths.get(str(course_id)) if course_id is not None else None
        if total:
            totals[classroom_id] = total
    if not totals:
        return {}
    marked = Exists(AttendanceRecord.objects.filter(session=OuterRef("pk")))
    done = dict(
        AttendanceSession.objects.filter(
            classroom_id__in=list(totals), date__gte=F("classroom__start_date"), date__lte=today or timezone.localdate()
        )
        .filter(marked)
        .order_by()
        .values("classroom_id")
        .annotate(n=Count("date", distinct=True))
        .values_list("classroom_id", "n")
    )
    return {pk: {"done": done.get(pk, 0), "total": total} for pk, total in totals.items()}


# ── filters ───────────────────────────────────────────────────────────────


def _course_choices(qs):
    rows = (
        qs.exclude(level="").exclude(level__isnull=True).order_by()
        .values("level", "subject").annotate(n=Count("pk", distinct=True))
    )
    merged: dict[tuple[str, str], int] = {}
    for r in rows:
        key = (str(r["level"]).lower(), str(r["subject"] or ""))
        merged[key] = merged.get(key, 0) + r["n"]
    order = sorted(merged, key=lambda k: (_LEVEL_ORDER.get(k[0], 99), k[1]))
    return [
        (f"{level}:{subject}", f"{_LEVELS.get(level, level.title())} {_SUBJECTS.get(subject, subject.title())}".strip(),
         merged[(level, subject)])
        for level, subject in order
    ]


def _course_q(value):
    level, _, subject = (value or "").partition(":")
    return Q(level__iexact=level, subject=subject) if level and subject else None


def _room_choices(qs):
    return [(v, f"Room {label}", n) for v, label, n in _present(qs, "room_number")]


def _show_filter(today):
    """The chips after Math / English: groups whose course ends within the week, groups with someone on trial.
    "all" counts the list with every OTHER filter applied; asking for it filters nothing."""
    cache: dict[str, list[int]] = {}

    def ending_ids() -> list[int]:
        if "ids" not in cache:
            rooms = list(Classroom.objects.filter(is_active=True, start_date__isnull=False).only("pk", "start_date"))
            cache["ids"] = [
                pk for pk, n in lessons_for(rooms, today).items() if 0 <= n["total"] - n["done"] <= ENDS_WITHIN
            ]
        return cache["ids"]

    def to_q(value):
        if value == "ends":
            return Q(pk__in=ending_ids())
        if value == "trial":
            seats = ClassroomMembership.objects.filter(
                role=_SEAT.ROLE_STUDENT, status=_SEAT.STATUS_ACTIVE, seat_status=_SEAT.SEAT_TRIAL
            )
            return Q(pk__in=seats.values("classroom_id"))
        return None

    def choices(qs):
        return [
            ("all", "All", qs.count()),
            ("ends", "Ends this week", qs.filter(to_q("ends")).count()),
            ("trial", "Has trial students", qs.filter(to_q("trial")).count()),
        ]

    return ("Show", choices, to_q)


def list_filters(today=None) -> dict:
    """The changelist's facets plus the board's: course (level + subject), room and the chips."""
    return {
        **CLASS_FILTERS,
        "course": ("Course", _course_choices, _course_q),
        "room": ("Room", _room_choices, lambda v: Q(room_number=v) if v else None),
        "show": _show_filter(today or timezone.localdate()),
    }


def price_filter(qs, params):
    """``?price=500000`` — the price typed, whole so'm (lc-up's "Narx bo'yicha"). Anything not a number is ignored."""
    price = to_int("".join(ch for ch in str(params.get("price") or "") if ch.isdigit()) or None)
    return qs.filter(monthly_price=price) if price is not None else qs


def list_row(room, managed: set[int], lessons: dict[int, dict]) -> dict:
    teacher = room.teacher if room.teacher_id else None
    return {
        **class_row(room, managed),
        "teacher_first_name": teacher.first_name or "" if teacher else "",
        "teacher_last_name": teacher.last_name or "" if teacher else "",
        "lesson_hours": room.lesson_hours,
        "monthly_price": room.monthly_price,
        "start_date": iso(room.start_date),
        "trial": getattr(room, "trial", 0) or 0,
        "lessons": lessons.get(room.pk),
    }
