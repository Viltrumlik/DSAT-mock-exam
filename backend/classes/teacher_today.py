"""The teacher Dashboard's "today", as one payload.

Backs ``GET /api/classes/teacher/today/`` (see the 2026-09-20 teacher-foundation design,
§4.1–4.3 and §5). Everything the endpoint knows lives here, so the view stays thin and the
payload is testable without HTTP: ``build_teacher_today(user)`` returns the dict.

Three blocks:

* ``lessons`` — one row per class of the caller's that meets **today**, in time order, with
  the homework due at that lesson and the names of the students who have not turned it in.
* ``waiting_to_check`` — per class, how many submissions are turned in and not yet reviewed.
* ``upcoming_midterms`` — scheduled midterms for those classes inside the next 14 days.

plus ``next_lesson_date``, which names the teacher's next lesson day so the client can render
§4.1's empty state ("no lesson today, your next one is …") without a second request.

Read-only: nothing here writes, and no ``get_or_create`` is reachable from it.

**Scope.** Staff only, and only over classes the caller holds a non-removed
``ClassroomMembership`` in — the fail-closed rule ``classroom_capabilities`` already applies
per classroom, evaluated here from the membership rows we already hold so it costs no extra
query. A global admin therefore sees the classes they are a member of, not all twenty-eight,
and a staff user who is a member of nothing gets three empty lists.

**Query count: 7 per call, flat in the number of classes.** One for the caller's
memberships, one for the active students of the classes meeting today, one for today's
homework, two for who turned it in (submissions + assessment attempts), one for the grading
queue, one for the midterm schedules. Blocks with no input short-circuit and cost nothing.

**Timezone.** The platform runs ``Asia/Tashkent``; "today" is ``timezone.localdate()`` and
the day window is that local date's midnight-to-midnight.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta
from types import SimpleNamespace

from django.db.models import Count, Exists, Max, OuterRef
from django.utils import timezone

from .capabilities import is_global_admin
from .lesson_schedule import lesson_weekdays, parse_lesson_time
from .models import Assignment, ClassroomMembership, Submission
from .models_schedule import MidtermSchedule

#: How far ahead §4.3 looks for a scheduled midterm. Inclusive at both ends: a midterm
#: starting exactly fourteen days from now is still "within the next 14 days".
MIDTERM_WINDOW_DAYS = 14

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


def _student_name(user) -> str:
    """A display name for a student. Never an email — §5 forbids it in this payload.

    ``username`` is a separate field here (``USERNAME_FIELD`` is ``email``), but 37 of the
    live students carry an email-shaped one, so it is used only when it is not an address.
    Ten students have neither a first nor a last name today; they read as "Student" rather
    than leaking a login into a list a whole class's teacher can see.
    """
    name = f"{(user.first_name or '').strip()} {(user.last_name or '').strip()}".strip()
    if name:
        return name
    username = (user.username or "").strip()
    return username if username and "@" not in username else "Student"


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
    """
    weekdays = lesson_weekdays(classroom)
    if not weekdays or today.weekday() not in weekdays:
        return False
    return not (classroom.start_date and classroom.start_date > today)


def _lesson_time_label(classroom) -> str | None:
    """``"18:00"`` for a readable ``lesson_time``, ``None`` when it cannot be parsed.

    ``None`` is not "no lesson": the class is still listed (the client renders "Time not
    set"), it is simply sorted after the timed ones. Parsing is
    ``lesson_schedule.parse_lesson_time`` — the single source of truth for "18:00",
    "08:00-10:00", "4:00 PM" and the blank one live classroom carries.
    """
    parsed = parse_lesson_time(classroom.lesson_time)
    return parsed.strftime("%H:%M") if parsed else None


def _next_lesson_date(classrooms, today) -> str | None:
    """The next date, after ``today``, on which ANY of these classes meets. ISO, or ``None``.

    §4.1 promises a teacher with no lesson today a quiet line naming their next lesson day,
    and the client cannot name it from ``lessons`` when that list is empty — so it is
    answered here, on every response, and read whenever ``lessons`` is empty.

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


def _waiting_to_check(classrooms) -> list[dict]:
    """§4.2 — submissions turned in and not yet reviewed, per class, newest first.

    SUBMITTED only, which is the gradebook's ``GB_SUBMITTED``: "manual work awaiting
    grading". REVIEWED is done and RETURNED has already been looked at and sent back, so
    neither is waiting. Auto-graded work never enters this queue for the same reason — it is
    written straight to REVIEWED with a score (views_gradebook's status taxonomy).

    Only active students count: a removed student's unreviewed work is not a job on anyone's
    desk, the same rule interventions applies to every figure it reports.

    Classes with nothing waiting are omitted rather than sent as a zero.
    """
    by_id = {c.id: c for c in classrooms}
    if not by_id:
        return []
    active_student = ClassroomMembership.objects.filter(
        classroom_id=OuterRef("assignment__classroom_id"),
        user_id=OuterRef("student_id"),
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    )
    rows = (
        Submission.objects.filter(
            assignment__classroom_id__in=list(by_id),
            assignment__status=Assignment.STATUS_PUBLISHED,
            status=Submission.STATUS_SUBMITTED,
        )
        .exclude(assignment__category=Assignment.CATEGORY_CLASSWORK)
        .filter(Exists(active_student))
        .values("assignment__classroom_id")
        .annotate(count=Count("id"), newest=Max("updated_at"))
    )
    out = []
    for r in rows:
        classroom = by_id.get(r["assignment__classroom_id"])
        if classroom is None or not r["count"]:
            continue
        out.append({
            "classroom_id": classroom.id,
            "name": classroom.name,
            "count": r["count"],
            "_newest": r["newest"],
        })
    out.sort(key=lambda r: (r["_newest"] is None, r["_newest"]), reverse=True)
    return [{k: v for k, v in r.items() if k != "_newest"} for r in out]


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
            "starts_at": schedule.starts_at.isoformat(),
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
        "next_lesson_date": _next_lesson_date(classrooms, today),
        "lessons": [],
        "waiting_to_check": [],
        "upcoming_midterms": [],
    }
    if not classrooms:
        return payload

    # ── 4.1 Today's lessons ──────────────────────────────────────────────────
    todays = [c for c in classrooms if _meets_today(c, today)]
    todays_ids = [c.id for c in todays]

    students_by_class: dict[int, list] = defaultdict(list)
    if todays_ids:  # query 2 — count AND names in one read
        memberships = (
            ClassroomMembership.objects.filter(
                classroom_id__in=todays_ids,
                role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
            )
            .select_related("user")
            .order_by("user__last_name", "user__first_name", "user_id")
        )
        for m in memberships:
            students_by_class[m.classroom_id].append(m.user)

    homework_by_class = _todays_homework(todays_ids, day_start, day_end)  # query 3
    all_student_ids = [u.id for users in students_by_class.values() for u in users]
    turned_in = _turned_in_by_assignment(  # queries 4 + 5
        [a.id for a in homework_by_class.values()], all_student_ids
    )

    lessons = []
    for classroom in todays:
        students = students_by_class.get(classroom.id, [])
        homework = homework_by_class.get(classroom.id)
        row = {
            "classroom_id": classroom.id,
            "name": classroom.name,
            "subject": classroom.subject,
            "lesson_time": _lesson_time_label(classroom),
            "student_count": len(students),
            "homework": None,
        }
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
        lessons.append(row)

    # In time order; a class whose time cannot be read is listed AFTER the timed ones
    # rather than dropped (§7).
    lessons.sort(key=lambda r: (r["lesson_time"] is None, r["lesson_time"] or "", r["name"]))
    payload["lessons"] = lessons

    payload["waiting_to_check"] = _waiting_to_check(classrooms)  # query 6
    payload["upcoming_midterms"] = _upcoming_midterms(classrooms, now)  # query 7
    return payload
