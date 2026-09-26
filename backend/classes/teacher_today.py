"""The teacher Dashboard's "today", as one payload.

Backs ``GET /api/classes/teacher/today/`` (see the 2026-09-20 teacher-foundation design,
§4.1–4.3 and §5, as widened by the owner's 2026-09-21 note). Everything the endpoint knows
lives here, so the view stays thin and the payload is testable without HTTP:
``build_teacher_today(user)`` returns the dict.

Four blocks:

* ``classes`` — one row per class the caller teaches, **whether or not it meets today**,
  carrying that class's schedule (room, days, time), the datetime of its next lesson, and a
  ``state`` saying where that lesson stands right now. A class meeting today also carries the
  homework due at that lesson and the names of the students who have not turned it in.
* ``grading_queue`` — manual grading waiting on the teacher, three levels deep:
  class → assignment → the students whose work is waiting.
* ``stats`` — three aggregates the Dashboard draws as charts: a week of attendance per class,
  thirty days of homework completion per class, and a fourteen-day attendance trend.
* ``upcoming_midterms`` — scheduled midterms for those classes inside the next 14 days.

plus ``date``, ``now``, and ``next_lesson_date``, which names the teacher's next lesson day so
the client can render §4.1's empty state ("no lesson today, your next one is …") without a
second request.

Read-only: nothing here writes, and no ``get_or_create`` is reachable from it.

**Scope.** Staff only, and only over classes the caller holds a non-removed
``ClassroomMembership`` in — the fail-closed rule ``classroom_capabilities`` already applies
per classroom, evaluated here from the membership rows we already hold so it costs no extra
query. A global admin therefore sees the classes they are a member of, not all twenty-eight,
and a staff user who is a member of nothing gets empty lists rather than a 403.

**Query count: at most 12 per call, flat in the number of classes.** One for the caller's
memberships, one for the active students of every class of theirs, one for today's homework,
two for who turned it in (submissions + assessment attempts), one for the grading queue, one
for the attendance week, three for the thirty-day homework rate (assignments + the same two
turned-in reads), one for the attendance trend, one for the midterm schedules. Every block
aggregates over the whole class list in one read; none of them loops a query per class.
Blocks with no input short-circuit and cost nothing, so a quiet day costs fewer than 12.

**Timezone.** The platform runs ``Asia/Tashkent``; "today" is ``timezone.localdate()`` and
the day window is that local date's midnight-to-midnight. Every timestamp this payload emits
is rendered in that zone (``+05:00``), so the client never has to convert a lesson time.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta
from types import SimpleNamespace

from django.db.models import Count, Exists, OuterRef
from django.utils import timezone

from .capabilities import is_global_admin
from .lesson_schedule import lesson_weekdays, next_lesson_start_after, parse_lesson_time
from .models import Assignment, ClassroomMembership, Submission
from .models_attendance import AttendanceRecord
from .models_schedule import MidtermSchedule

#: How far ahead §4.3 looks for a scheduled midterm. Inclusive at both ends: a midterm
#: starting exactly fourteen days from now is still "within the next 14 days".
MIDTERM_WINDOW_DAYS = 14

#: Lesson length when ``Classroom.lesson_hours`` does not give one.
#:
#: The column is ``PositiveIntegerField(default=2)``, so a row written through the ORM always
#: carries a number — but 0 is storable and older rows predate the field, and a zero-length
#: lesson would be "over" the instant it began. **When ``lesson_hours`` is not set, a lesson
#: is assumed to run two hours**, which is the school's own default and the length both
#: classrooms with an explicit range in ``lesson_time`` are written down as.
DEFAULT_LESSON_HOURS = 2

#: Caps on what the grading queue *lists*, never on what it *counts*. One live class carries
#: 134 waiting submissions; sending every one of them would make the Dashboard's first paint
#: a data dump. Both ``waiting`` figures stay the true, uncapped total, so the teacher always
#: reads the real size of the job and the client can say "showing 12 of 47".
GRADING_QUEUE_MAX_ASSIGNMENTS = 8
GRADING_QUEUE_MAX_STUDENTS = 12

#: Windows for the three ``stats`` blocks, all counted in whole local days ending today.
ATTENDANCE_WEEK_DAYS = 7
ATTENDANCE_TREND_DAYS = 14
HOMEWORK_STATS_DAYS = 30

# The product never calls a student absent — "missed" is the word every teacher-facing
# surface uses — so AttendanceRecord.STATUS_ABSENT is reported under the key ``missed``.
# EXCUSED is carried in the weekly block and deliberately absent from the trend, which the
# owner asked for as three lines.
ATTENDANCE_STATUS_KEYS = {
    AttendanceRecord.STATUS_PRESENT: "present",
    AttendanceRecord.STATUS_LATE: "late",
    AttendanceRecord.STATUS_ABSENT: "missed",
    AttendanceRecord.STATUS_EXCUSED: "excused",
}

# Weekday labels for ``lesson_days_label``. The DAYS are read from
# ``lesson_schedule.lesson_weekdays`` so ODD/EVEN can never drift from the schedule module;
# only the English abbreviations live here. ``calendar.day_abbr`` is deliberately not used —
# it follows the process locale, and this label is part of an API contract.
WEEKDAY_ABBR = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

# Sort floor for a missing ``submitted_at``. Only ever compared against itself: every sort key
# below puts "has no timestamp" in its own leading bucket, so this naive datetime never meets
# an aware one.
_NO_TIMESTAMP = datetime.min

# Turned in means what classes/views.py's ``interventions`` action already means by it, so
# the Dashboard and the students-needing-attention block cannot disagree. Quoting it
# (views.py:1707-1709):
#
#   "RETURNED ("returned for revision") counts as turned in: the student submitted and the
#    teacher sent it back, which the gradebook reports as NEEDS_REVISION, not MISSING."
#
# and, for assessment homework (views.py:1429-1433): "a submitted or graded attempt on any of
# the homework's assessments. Assessment homework is turned in as an attempt, and a homework
# carrying several assessments never gets a submission from them."
TURNED_IN_SUBMISSION_STATUSES = (
    Submission.STATUS_SUBMITTED,
    Submission.STATUS_REVIEWED,
    Submission.STATUS_RETURNED,
)

#: ``state`` values, in the order the owner asked to read them:
#:
#:   "the group whose lesson is coming stands first, before and during the lesson, and once
#:    it is over the next one takes its place"
#:
#: so a lesson in progress outranks one that has not started, which outranks one already
#: taught, which outranks a class with no readable schedule at all.
STATE_NOW = "now"
STATE_UPCOMING = "upcoming"
STATE_DONE = "done"
STATE_OFF = "off"
STATE_ORDER = {STATE_NOW: 0, STATE_UPCOMING: 1, STATE_DONE: 2, STATE_OFF: 3}


def _local_iso(value) -> str | None:
    """An aware datetime as ISO-8601 in school time (``…+05:00``), or ``None``.

    Values read back from the database are UTC-aware; a lesson time built from a classroom's
    schedule is already local. Both are rendered the same way here so the client never has to
    ask which timestamp came from where.
    """
    return timezone.localtime(value).isoformat() if value else None


def _display_name(first, last, username) -> str:
    """A display name from the three raw fields. Never an email — §5 forbids it here.

    ``username`` is a separate field (``USERNAME_FIELD`` is ``email``), but 37 of the live
    students carry an email-shaped one, so it is used only when it is not an address. Ten
    students have neither a first nor a last name today; they read as "Student" rather than
    leaking a login into a list a whole class's teacher can see.
    """
    name = f"{(first or '').strip()} {(last or '').strip()}".strip()
    if name:
        return name
    username = (username or "").strip()
    return username if username and "@" not in username else "Student"


def _student_name(user) -> str:
    """:func:`_display_name` for a loaded user object."""
    return _display_name(user.first_name, user.last_name, user.username)


def _staff_classrooms(user) -> list:
    """Classes the caller may see here: non-removed membership + staff there.

    Mirrors ``classroom_capabilities(user, classroom).is_staff`` exactly — global admins are
    staff wherever they are a member, everyone else is staff through
    ``ClassroomMembership.STAFF_ROLES`` — but reads it off the membership rows we have
    rather than re-querying per classroom.

    Deactivated classes are left out: ``is_active=False`` is the classroom's retirement, and
    the calendar (``ClassroomViewSet.my_schedule``) already refuses to draw lessons for one.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return []
    global_admin = is_global_admin(user)
    rows = (
        ClassroomMembership.objects.filter(
            user=user,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
            classroom__is_active=True,
        )
        .select_related("classroom")
        .order_by("classroom__name", "classroom_id")
    )
    out, seen = [], set()
    for m in rows:
        if m.classroom_id in seen:
            continue
        if not (global_admin or m.role in ClassroomMembership.STAFF_ROLES):
            continue
        seen.add(m.classroom_id)
        out.append(m.classroom)
    return out


def _meets_today(classroom, today) -> bool:
    """Whether ``classroom`` has a lesson on ``today``.

    Days come from ``lesson_schedule.lesson_weekdays`` (ODD = Mon/Wed/Fri, EVEN =
    Tue/Thu/Sat, Sunday belongs to neither) — never re-derived here. A class whose
    ``start_date`` is still in the future has not begun, so it does not meet today; that is
    the rule ``next_lesson_start_after`` and the calendar both already apply.

    Note this asks nothing about ``lesson_time``: a class with an unreadable time still meets
    today, and its homework is still due at that lesson. It simply cannot be placed on a
    clock, which is what ``state == "off"`` says.
    """
    weekdays = lesson_weekdays(classroom)
    if not weekdays or today.weekday() not in weekdays:
        return False
    return not (classroom.start_date and classroom.start_date > today)


def _lesson_time_label(classroom) -> str | None:
    """``"18:00"`` for a readable ``lesson_time``, ``None`` when it cannot be parsed.

    ``None`` is not "no lesson": the class is still listed (the client renders "Time not
    set"). Parsing is ``lesson_schedule.parse_lesson_time`` — the single source of truth for
    "18:00", "08:00-10:00", "4:00 PM" and the blank one live classroom carries.
    """
    parsed = parse_lesson_time(classroom.lesson_time)
    return parsed.strftime("%H:%M") if parsed else None


def _lesson_days_label(classroom) -> str:
    """``"Mon, Wed, Fri"`` for ODD, ``"Tue, Thu, Sat"`` for EVEN, ``""`` for neither.

    Derived from ``lesson_schedule.lesson_weekdays`` rather than written out twice, so a class
    whose ``lesson_days`` the schedule module does not recognise gets an empty label instead
    of a confident wrong one.
    """
    return ", ".join(WEEKDAY_ABBR[d] for d in sorted(lesson_weekdays(classroom)))


def _lesson_length(classroom) -> timedelta:
    """How long one lesson of this class runs.

    ``Classroom.lesson_hours`` when it is set; **two hours when it is not** (see
    :data:`DEFAULT_LESSON_HOURS`). The explicit end of a ranged ``lesson_time``
    ("16:00-18:00") is deliberately not consulted: the owner named ``lesson_hours`` as the
    length, and ``lesson_time`` is published here as the START of the lesson only.
    """
    hours = getattr(classroom, "lesson_hours", None) or DEFAULT_LESSON_HOURS
    return timedelta(hours=hours)


def _next_lesson_and_state(classroom, now, today, day_start):
    """``(next_lesson_at | None, state)`` for one class.

    ``next_lesson_at`` is today's lesson while that lesson is still ahead or in progress, and
    the next scheduled day's lesson once today's has finished — or when the class does not
    meet today at all. ``None`` when the class has no usable schedule.

    The weekday maths is not redone here: asking
    ``lesson_schedule.next_lesson_start_after`` for the first lesson start after *the instant
    before midnight* answers "today's lesson if there is one, otherwise the next" in one call,
    and keeps the ``start_date`` floor (a class that has not begun resolves to its first
    lesson, not to a lesson in its past).
    """
    first = next_lesson_start_after(classroom, after=day_start - timedelta(microseconds=1))
    if first is None:
        # No weekdays, or a lesson_time nothing can read. The class is still listed — it is
        # a real class with real students — it just cannot be put on a clock.
        return None, STATE_OFF

    if timezone.localtime(first).date() != today:
        return first, STATE_UPCOMING

    if now < first:
        return first, STATE_UPCOMING
    if now < first + _lesson_length(classroom):
        return first, STATE_NOW
    # Today's lesson is over; the next one takes its place.
    return next_lesson_start_after(classroom, after=first), STATE_DONE


def _next_lesson_date(classrooms, today) -> str | None:
    """The next date, after ``today``, on which ANY of these classes meets. ISO, or ``None``.

    §4.1 promises a teacher with no lesson today a quiet line naming their next lesson day,
    and the client cannot always name it from ``classes`` — so it is answered here, on every
    response.

    Strictly after today: this names the NEXT lesson day, so a teacher asked on a Monday
    whose ODD classes are meeting in a few hours is told about Wednesday. Days come from
    ``lesson_schedule.lesson_weekdays``, so Sunday belongs to neither group and a classroom
    with an unknown ``lesson_days`` contributes nothing.

    Bounded at 7 days: every valid group meets at least three times a week, so a class with
    any schedule at all always lands inside the week. ``None`` means the caller teaches
    nothing, or nothing they teach has a usable lesson day. No queries — the classrooms are
    already in hand.
    """
    for offset in range(1, 8):
        day = today + timedelta(days=offset)
        for classroom in classrooms:
            weekdays = lesson_weekdays(classroom)
            if not weekdays or day.weekday() not in weekdays:
                continue
            if classroom.start_date and classroom.start_date > day:
                continue  # the class has not begun yet — same rule as _meets_today
            return day.isoformat()
    return None


def _todays_homework(classroom_ids, day_start, day_end) -> dict[int, Assignment]:
    """The published homework due at today's lesson, per classroom.

    Homework has no manual deadline: ``Assignment.due_at`` is derived server-side as the
    start of the classroom's next lesson (``lesson_schedule.homework_due_at``), so "due at
    today's lesson" is "due somewhere inside today's local day" — one class meets at most
    once a day. A NULL ``due_at`` means the deadline could not be computed and the homework
    is open, never overdue, so it is never claimed by a lesson.

    Classwork is excluded (``AssignmentQuerySet.homework()``): there is nothing to turn in.
    DRAFT and ARCHIVED are excluded for the reason class analytics excludes them — students
    are never asked to turn them in.

    A teacher who published two pieces of work due at the same lesson gets the most recently
    created one here; §5 carries one ``homework`` object per lesson, and the rest stay on the
    class's own homework list.
    """
    if not classroom_ids:
        return {}
    out: dict[int, Assignment] = {}
    rows = (
        Assignment.objects.homework()
        .filter(
            classroom_id__in=classroom_ids,
            status=Assignment.STATUS_PUBLISHED,
            due_at__gte=day_start,
            due_at__lt=day_end,
        )
        .only("id", "title", "classroom_id", "due_at", "created_at")
        .order_by("due_at", "created_at", "id")
    )
    for a in rows:
        out[a.classroom_id] = a  # last wins → the newest homework due at that lesson
    return out


def _turned_in_by_assignment(assignment_ids, student_ids) -> dict[int, set[int]]:
    """``{assignment_id: {student_id, …}}`` for everyone who turned the work in.

    Two sources, unioned into a set because homework with a single assessment usually has
    both records: the ``Submission`` the student sent (RETURNED included — see
    ``TURNED_IN_SUBMISSION_STATUSES``), and a submitted or graded ``AssessmentAttempt`` on
    any assessment the homework carries.
    """
    turned_in: dict[int, set[int]] = defaultdict(set)
    if not assignment_ids or not student_ids:
        return turned_in

    submissions = Submission.objects.filter(
        assignment_id__in=assignment_ids,
        student_id__in=student_ids,
        status__in=TURNED_IN_SUBMISSION_STATUSES,
    ).values_list("assignment_id", "student_id")
    for assignment_id, student_id in submissions:
        turned_in[assignment_id].add(student_id)

    from assessments.models import AssessmentAttempt

    attempts = AssessmentAttempt.objects.filter(
        homework__assignment_id__in=assignment_ids,
        student_id__in=student_ids,
        status__in=(AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED),
    ).values_list("homework__assignment_id", "student_id")
    for assignment_id, student_id in attempts:
        turned_in[assignment_id].add(student_id)

    return turned_in


def _active_student_subquery(classroom_path: str):
    """``Exists`` clause: this row's student is an active student of this row's classroom.

    Correlated rather than a flat ``student_id__in`` list, for two reasons: a student active
    in one of the caller's classes may have been removed from another, and a teacher of
    twenty-eight classes would otherwise ship five hundred ids into every query.
    """
    return Exists(
        ClassroomMembership.objects.filter(
            classroom_id=OuterRef(classroom_path),
            user_id=OuterRef("student_id"),
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
    )


def _grading_queue(classrooms) -> list[dict]:
    """§4.2 — the manual grading waiting on this teacher, class → assignment → students.

    SUBMITTED only, which is the gradebook's ``GB_SUBMITTED``: "manual work awaiting
    grading". REVIEWED is done and RETURNED has already been looked at and sent back, so
    neither is waiting. Auto-graded work never enters this queue for the same reason — it is
    written straight to REVIEWED with a score (views_gradebook's status taxonomy). Classwork
    is excluded because there is nothing to hand in, and DRAFT/ARCHIVED homework was never
    asked for.

    Only active students count: a removed student's unreviewed work is not a job on anyone's
    desk, the same rule interventions applies to every figure it reports.

    Ordering answers "what should I open first" at each level: the classes with most waiting
    first, then inside a class the assignment whose oldest piece of work has waited longest,
    then inside that the students in the order they handed in. Both lists are capped (see
    :data:`GRADING_QUEUE_MAX_ASSIGNMENTS`) while both ``waiting`` counts stay true totals.

    Classes with nothing waiting are omitted rather than sent as a zero. One query.
    """
    by_id = {c.id: c for c in classrooms}
    if not by_id:
        return []

    rows = (
        Submission.objects.filter(
            assignment__classroom_id__in=list(by_id),
            assignment__status=Assignment.STATUS_PUBLISHED,
            status=Submission.STATUS_SUBMITTED,
        )
        .exclude(assignment__category=Assignment.CATEGORY_CLASSWORK)
        .filter(_active_student_subquery("assignment__classroom_id"))
        .values_list(
            "assignment__classroom_id",
            "assignment_id",
            "assignment__title",
            "student_id",
            "student__first_name",
            "student__last_name",
            "student__username",
            # Every SUBMITTED row is written through Submission.mark_submitted(), which sets
            # this — but the column is nullable, and a row that lost its timestamp must still
            # be shown. It sorts last and is sent as null rather than being dropped.
            "submitted_at",
        )
        .order_by()
    )

    per_class: dict[int, dict[int, dict]] = defaultdict(dict)
    for cid, aid, title, sid, first, last, username, submitted_at in rows:
        assignment = per_class[cid].get(aid)
        if assignment is None:
            assignment = {"assignment_id": aid, "title": title, "students": []}
            per_class[cid][aid] = assignment
        assignment["students"].append(
            {"id": sid, "name": _display_name(first, last, username), "_at": submitted_at}
        )

    out = []
    for cid, assignments in per_class.items():
        classroom = by_id.get(cid)
        if classroom is None:
            continue
        rendered = []
        for assignment in assignments.values():
            students = sorted(
                assignment["students"],
                key=lambda s: (s["_at"] is None, s["_at"] or _NO_TIMESTAMP, s["id"]),
            )
            oldest = students[0]["_at"] if students else None
            rendered.append({
                "assignment_id": assignment["assignment_id"],
                "title": assignment["title"],
                "waiting": len(students),  # the true total, before the cap below
                "students": [
                    {"id": s["id"], "name": s["name"], "submitted_at": _local_iso(s["_at"])}
                    for s in students[:GRADING_QUEUE_MAX_STUDENTS]
                ],
                "_oldest": oldest,
            })
        if not rendered:
            continue
        rendered.sort(
            key=lambda a: (
                a["_oldest"] is None,
                a["_oldest"] or _NO_TIMESTAMP,
                a["title"],
                a["assignment_id"],
            )
        )
        out.append({
            "classroom_id": classroom.id,
            "name": classroom.name,
            "waiting": sum(a["waiting"] for a in rendered),  # every assignment, not the 8
            "assignments": [
                {k: v for k, v in a.items() if k != "_oldest"}
                for a in rendered[:GRADING_QUEUE_MAX_ASSIGNMENTS]
            ],
        })
    out.sort(key=lambda r: (-r["waiting"], r["name"]))
    return out


def _attendance_week(classrooms, today) -> list[dict]:
    """Attendance counts per class over the last seven local days, today included.

    Counts every ``AttendanceRecord`` in the window, not only records belonging to students
    who are still on the roster: last week's register is a record of what happened, and
    removing a student on Friday must not rewrite Monday's numbers. ABSENT is reported as
    ``missed``.

    Classes with no register in the window are omitted rather than sent as four zeros — a
    class that did not meet is not a class with perfect attendance. One query.
    """
    by_id = {c.id: c for c in classrooms}
    if not by_id:
        return []
    rows = (
        AttendanceRecord.objects.filter(
            session__classroom_id__in=list(by_id),
            session__date__gte=today - timedelta(days=ATTENDANCE_WEEK_DAYS - 1),
            session__date__lte=today,
        )
        .values("session__classroom_id", "status")
        .annotate(n=Count("id"))
    )
    counts: dict[int, dict[str, int]] = defaultdict(
        lambda: {"present": 0, "late": 0, "missed": 0, "excused": 0}
    )
    for r in rows:
        key = ATTENDANCE_STATUS_KEYS.get(r["status"])
        if key is None:
            continue  # an unknown status is not silently folded into one of the four
        counts[r["session__classroom_id"]][key] += r["n"]

    out = []
    for cid, bucket in counts.items():
        classroom = by_id.get(cid)
        if classroom is None:
            continue
        out.append({"classroom_id": classroom.id, "name": classroom.name, **bucket})
    out.sort(key=lambda r: (r["name"], r["classroom_id"]))
    return out


def _attendance_trend(classrooms, today) -> list[dict]:
    """One row per day, across all the caller's classes, for the last fourteen days.

    Only days that have a register at all: a Sunday, a holiday and a day nobody marked are
    all "no data", and drawing them as three zeros would show a collapse that did not happen.
    Oldest first, so the client can plot it straight. EXCUSED is counted by no line here — the
    owner asked for three — but a day holding only excused records still appears, because the
    class did meet. One query.
    """
    by_id = {c.id: c for c in classrooms}
    if not by_id:
        return []
    rows = (
        AttendanceRecord.objects.filter(
            session__classroom_id__in=list(by_id),
            session__date__gte=today - timedelta(days=ATTENDANCE_TREND_DAYS - 1),
            session__date__lte=today,
        )
        .values("session__date", "status")
        .annotate(n=Count("id"))
    )
    by_day: dict[object, dict[str, int]] = {}
    for r in rows:
        bucket = by_day.setdefault(
            r["session__date"], {"present": 0, "late": 0, "missed": 0}
        )
        key = ATTENDANCE_STATUS_KEYS.get(r["status"])
        if key in bucket:
            bucket[key] += r["n"]
    return [{"date": day.isoformat(), **by_day[day]} for day in sorted(by_day)]


def _homework_30d(classrooms, students_by_class, now) -> list[dict]:
    """Homework completion per class over the last thirty days.

    ``expected`` is the number of (active student × assignment) pairs the class was asked
    for; ``turned_in`` is how many of those pairs were actually handed in, counted exactly as
    the lesson block counts it (a Submission in ``TURNED_IN_SUBMISSION_STATUSES`` **or** a
    submitted/graded AssessmentAttempt, unioned so homework carrying both records is one
    pair, never two).

    The window ends at ``now``, not at the end of today: homework due at tonight's lesson has
    not come due yet, and counting it would report every class as behind every evening.

    Classes with nothing due in the window are omitted — an ``expected`` of zero is not a
    completion rate of zero. Three queries, all class-wide.
    """
    by_id = {c.id: c for c in classrooms}
    if not by_id:
        return []
    assignment_rows = (
        Assignment.objects.homework()
        .filter(
            classroom_id__in=list(by_id),
            status=Assignment.STATUS_PUBLISHED,
            due_at__gte=now - timedelta(days=HOMEWORK_STATS_DAYS),
            due_at__lte=now,
        )
        .values_list("id", "classroom_id")
    )
    classroom_of = dict(assignment_rows)  # assignment_id → classroom_id
    if not classroom_of:
        return []
    assignment_ids = list(classroom_of)

    pairs: set[tuple[int, int]] = set()
    pairs.update(
        Submission.objects.filter(
            assignment_id__in=assignment_ids,
            status__in=TURNED_IN_SUBMISSION_STATUSES,
        )
        .filter(_active_student_subquery("assignment__classroom_id"))
        .values_list("assignment_id", "student_id")
    )

    from assessments.models import AssessmentAttempt

    pairs.update(
        AssessmentAttempt.objects.filter(
            homework__assignment_id__in=assignment_ids,
            status__in=(AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED),
        )
        .filter(_active_student_subquery("homework__assignment__classroom_id"))
        .values_list("homework__assignment_id", "student_id")
    )

    assignments_per_class: dict[int, int] = defaultdict(int)
    for classroom_id in classroom_of.values():
        assignments_per_class[classroom_id] += 1
    turned_in_per_class: dict[int, int] = defaultdict(int)
    for assignment_id, _student_id in pairs:
        turned_in_per_class[classroom_of[assignment_id]] += 1

    out = []
    for classroom_id, assignment_count in assignments_per_class.items():
        classroom = by_id.get(classroom_id)
        if classroom is None:
            continue
        expected = assignment_count * len(students_by_class.get(classroom_id, []))
        if not expected:
            continue  # a class with no students was asked for nothing
        out.append({
            "classroom_id": classroom.id,
            "name": classroom.name,
            "expected": expected,
            "turned_in": turned_in_per_class.get(classroom_id, 0),
        })
    out.sort(key=lambda r: (r["name"], r["classroom_id"]))
    return out


def _midterm_brief(schedule) -> tuple[int | None, str, int | None]:
    """``(midterm_id, title, pass_mark)`` for a schedule, whichever identity it carries.

    The pass mark is resolved exactly as ``midterms.admin_report._midterm_brief`` resolves
    it — ``effective_pass_mark if is_graded else None`` — so the number the teacher reads
    here is the number the report and the certificate use. A pre-midterm is scored but never
    judged, so it sends ``null`` rather than a guess.

    A schedule still carrying only the legacy ``exams.MockExam`` identity (the cutover is not
    finished) is described from its ``midterm_*`` fields, and its pass mark goes through the
    same ``outcomes.effective_pass_mark`` via a shim, so the 50%-of-questions default is the
    one default in the codebase rather than a second copy of it. ``midterm_id`` is then the
    MockExam's id, which is what the legacy panel route addresses it by.
    """
    from midterms.outcomes import effective_pass_mark

    midterm = schedule.midterm
    if midterm is not None:
        return (
            midterm.id,
            midterm.title or f"Midterm #{midterm.pk}",
            midterm.effective_pass_mark if midterm.is_graded else None,
        )

    exam = schedule.mock_exam
    if exam is None:
        return None, "", None
    is_graded = str(getattr(exam, "midterm_type", "") or "").upper() != "PRE_MIDTERM"
    shim = SimpleNamespace(
        pass_mark=getattr(exam, "midterm_pass_mark", None),
        scoring_scale=getattr(exam, "midterm_scoring_scale", "") or "",
    )
    return (
        exam.id,
        exam.title or f"Midterm #{exam.pk}",
        effective_pass_mark(shim) if is_graded else None,
    )


def _upcoming_midterms(classrooms, now) -> list[dict]:
    """§4.3 — scheduled midterms for these classes inside the next 14 days, soonest first.

    ``MidtermSchedule.starts_at`` is the date. A row with no ``starts_at`` is not upcoming —
    per ``models_schedule``'s docstring it is an exam open to the whole class right now — so
    it is left out, and the database filter drops it for free.
    """
    by_id = {c.id: c for c in classrooms}
    if not by_id:
        return []
    rows = (
        MidtermSchedule.objects.filter(
            classroom_id__in=list(by_id),
            starts_at__gte=now,
            starts_at__lte=now + timedelta(days=MIDTERM_WINDOW_DAYS),
        )
        .select_related("midterm", "mock_exam")
        .order_by("starts_at", "id")
    )
    out = []
    for schedule in rows:
        classroom = by_id.get(schedule.classroom_id)
        if classroom is None:
            continue
        midterm_id, title, pass_mark = _midterm_brief(schedule)
        if midterm_id is None:
            continue  # a schedule describing no exam at all
        out.append({
            "midterm_id": midterm_id,
            "title": title,
            "classroom_id": classroom.id,
            "name": classroom.name,
            # School time, like every other timestamp this payload emits. It used to go out in
            # UTC here alone: the same instant, but it reads as a different hour to anyone
            # comparing it against the lesson times beside it.
            "starts_at": _local_iso(schedule.starts_at),
            "pass_mark": pass_mark,
        })
    return out


def build_teacher_today(user, now=None) -> dict:
    """The whole ``GET /api/classes/teacher/today/`` payload for ``user``.

    Callable and assertable without HTTP. ``now`` is for tests; it defaults to
    ``timezone.now()`` and "today" is always the caller's local (Asia/Tashkent) date.
    """
    now = now or timezone.now()
    tz = timezone.get_current_timezone()
    today = timezone.localdate(now)
    day_start = timezone.make_aware(datetime.combine(today, time.min), tz)
    day_end = day_start + timedelta(days=1)

    classrooms = _staff_classrooms(user)  # query 1
    payload = {
        "date": today.isoformat(),
        "now": _local_iso(now),
        "next_lesson_date": _next_lesson_date(classrooms, today),
        "classes": [],
        "grading_queue": [],
        "stats": {"attendance_week": [], "homework_30d": [], "attendance_trend": []},
        "upcoming_midterms": [],
    }
    if not classrooms:
        return payload

    # ── the roster, once, for every class ────────────────────────────────────
    # query 2 — student_count, the missing-homework names, and the denominator of the
    # thirty-day homework rate all come out of this one read.
    students_by_class: dict[int, list] = defaultdict(list)
    memberships = (
        ClassroomMembership.objects.filter(
            classroom_id__in=[c.id for c in classrooms],
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        .select_related("user")
        .order_by("user__last_name", "user__first_name", "user_id")
    )
    for m in memberships:
        students_by_class[m.classroom_id].append(m.user)

    # ── 4.1 Every class, with its schedule and where its lesson stands ───────
    todays_ids = [c.id for c in classrooms if _meets_today(c, today)]
    homework_by_class = _todays_homework(todays_ids, day_start, day_end)  # query 3
    todays_student_ids = [u.id for cid in todays_ids for u in students_by_class.get(cid, [])]
    turned_in = _turned_in_by_assignment(  # queries 4 + 5
        [a.id for a in homework_by_class.values()], todays_student_ids
    )

    rows = []
    for classroom in classrooms:
        students = students_by_class.get(classroom.id, [])
        next_lesson_at, state = _next_lesson_and_state(classroom, now, today, day_start)
        row = {
            "classroom_id": classroom.id,
            "name": classroom.name,
            "subject": classroom.subject,
            "room": classroom.room_number or "",
            "lesson_days": classroom.lesson_days or "",
            "lesson_days_label": _lesson_days_label(classroom),
            "lesson_time": _lesson_time_label(classroom),
            "student_count": len(students),
            "next_lesson_at": _local_iso(next_lesson_at),
            "state": state,
            "homework": None,
        }
        homework = homework_by_class.get(classroom.id)
        if homework is not None:
            done = turned_in.get(homework.id, set())
            missing = [u for u in students if u.id not in done]
            row["homework"] = {
                "assignment_id": homework.id,
                "title": homework.title,
                "turned_in": len(students) - len(missing),
                "missing": len(missing),
                # The whole list, not a sample: classes here run to about twenty students.
                "missing_students": [
                    {"id": u.id, "name": _student_name(u)} for u in missing
                ],
            }
        rows.append((state, next_lesson_at, row))

    # The owner's order: in progress, then coming (soonest first), then taught, then a class
    # with no clock at all. Only ``upcoming`` is sorted by its datetime — the rest tie and
    # fall through to the name, which is why the sort key's second slot is a constant for
    # them (types never meet: the rank differs first).
    rows.sort(
        key=lambda r: (
            STATE_ORDER[r[0]],
            r[1] if r[0] == STATE_UPCOMING else 0,
            r[2]["name"],
            r[2]["classroom_id"],
        )
    )
    payload["classes"] = [row for _state, _at, row in rows]

    payload["grading_queue"] = _grading_queue(classrooms)  # query 6
    payload["stats"] = {
        "attendance_week": _attendance_week(classrooms, today),  # query 7
        "homework_30d": _homework_30d(classrooms, students_by_class, now),  # queries 8–10
        "attendance_trend": _attendance_trend(classrooms, today),  # query 11
    }
    payload["upcoming_midterms"] = _upcoming_midterms(classrooms, now)  # query 12
    return payload
