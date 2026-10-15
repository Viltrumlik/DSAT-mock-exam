"""/ops Classrooms as a Django-admin changelist and change form (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from collections import defaultdict

from django.db.models import Count, F, Q
from django.utils import timezone

from users.changelist import to_int
from users.people_detail import display_name, iso, section_of

from .models import Assignment, Classroom, ClassroomMembership

STUDENT, TA, ACTIVE = (
    ClassroomMembership.ROLE_STUDENT, ClassroomMembership.ROLE_TA, ClassroomMembership.STATUS_ACTIVE,
)
SESSIONS_LIMIT = 20
HOMEWORK_LIMIT = 20
HISTORY_LIMIT = 200

#: A class's students: active STUDENT seats. TAs, teachers and removed seats are not students.
STUDENT_SEATS = Count(
    "memberships",
    filter=Q(memberships__role=ClassroomMembership.ROLE_STUDENT, memberships__status=ClassroomMembership.STATUS_ACTIVE),
    distinct=True,
)
#: Paired with lc-up: a confirmed link whose group lc-up has not deleted (lcup.guards.is_lcup_managed,
#: without its LCUP_ENABLED switch). A class with no link at all is unpaired.
PAIRED = Q(lcup_group_link__status="confirmed", lcup_group_link__deleted_in_lcup_at__isnull=True)

_SUBJECTS = dict(Classroom.SUBJECT_CHOICES)
_LEVELS = dict(Classroom.LEVEL_CHOICES)
_DAYS = dict(Classroom.DAYS_CHOICES)


def _present(qs, field, labels=None, blank=None):
    """The values ``field`` holds in ``qs``, each with its count; a blank one becomes ``blank`` or is left out."""
    rows = qs.order_by().values(field).annotate(n=Count("pk", distinct=True))
    out = []
    for r in rows:
        v = r[field]
        if v in (None, ""):
            if blank:
                out.append((blank[0], blank[1], r["n"]))
            continue
        out.append((str(v), str((labels or {}).get(v, v)), r["n"]))
    return sorted(out, key=lambda c: c[1].casefold())


def _teacher_choices(qs):
    rows = (
        qs.exclude(teacher__isnull=True).order_by()
        .values("teacher_id", "teacher__first_name", "teacher__last_name", "teacher__username")
        .annotate(n=Count("pk", distinct=True))
    )
    out = [
        (str(r["teacher_id"]),
         f"{r['teacher__first_name'] or ''} {r['teacher__last_name'] or ''}".strip() or r["teacher__username"], r["n"])
        for r in rows
    ]
    return sorted(out, key=lambda c: c[1].casefold())


def _branch_choices(qs):
    rows = (
        qs.exclude(branch__isnull=True).order_by().values("branch_id", "branch__name")
        .annotate(n=Count("pk", distinct=True))
    )
    return sorted(((str(r["branch_id"]), r["branch__name"], r["n"]) for r in rows), key=lambda c: c[1].casefold())


CLASS_FILTERS = {
    "subject": ("Subject", lambda qs: _present(qs, "subject", _SUBJECTS), lambda v: Q(subject=v)),
    "level": ("Level", lambda qs: _present(qs, "level", _LEVELS, blank=("untagged", "No level")),
              lambda v: (Q(level="") | Q(level__isnull=True)) if v == "untagged" else Q(level=v)),
    "teacher": ("Teacher", _teacher_choices, lambda v: Q(teacher_id=to_int(v)) if to_int(v) else None),
    "branch": ("Branch", _branch_choices, lambda v: Q(branch_id=to_int(v)) if to_int(v) else None),
    "days": ("Days", lambda qs: _present(qs, "lesson_days", _DAYS), lambda v: Q(lesson_days=v)),
    "lcup": ("lc-up",
             lambda qs: [("paired", "Paired", qs.filter(PAIRED).count()),
                         ("unpaired", "Not paired", qs.exclude(PAIRED).count())],
             lambda v: {"paired": PAIRED, "unpaired": ~PAIRED}.get(v)),
    "status": ("Status",
               lambda qs: [("active", "Active", qs.filter(is_active=True).count()),
                           ("archived", "Archived", qs.filter(is_active=False).count())],
               lambda v: {"active": Q(is_active=True), "archived": Q(is_active=False)}.get(v)),
}

CLASS_ORDERING = {
    "name": (F("name").asc(),), "-name": (F("name").desc(),),
    "students": (F("students").asc(),), "-students": (F("students").desc(),),
    "created": (F("created_at").asc(),), "-created": (F("created_at").desc(),),
}
CLASS_SEARCH = ["name", "room_number", "teacher__first_name", "teacher__last_name", "teacher__username"]


def class_row(room, managed: set[int]) -> dict:
    return {
        "id": room.pk, "name": room.name, "subject": room.subject, "level": room.level or "",
        "teacher": {"id": room.teacher_id, "name": display_name(room.teacher)} if room.teacher_id else None,
        "students": getattr(room, "students", 0) or 0, "lesson_days": room.lesson_days or "",
        "lesson_time": room.lesson_time or "", "room_number": room.room_number or "",
        "branch": room.branch.name if room.branch_id else "", "lcup": room.pk in managed,
        "is_active": room.is_active, "created_at": iso(room.created_at),
    }


# ── change form ───────────────────────────────────────────────────────────


def _person(u):
    return {"id": u.pk, "name": display_name(u)} if u is not None else None


def _student_seats(room):
    return ClassroomMembership.objects.filter(classroom=room, role=STUDENT, status=ACTIVE).select_related("user")


def _lcup_block(room):
    from lcup.guards import LCUP_OWNED_CLASS_FIELDS, is_lcup_managed
    from lcup.models import LcupGroupLink

    link = LcupGroupLink.objects.filter(classroom=room).first()
    if link is None:
        return None
    managed = is_lcup_managed(room)
    return {
        "managed": managed,
        "group_name": link.name,
        "status": link.status,
        "locked_fields": list(LCUP_OWNED_CLASS_FIELDS) if managed else [],
    }


def classroom_core(room) -> dict:
    """What the class's change form opens with: its fields, its staff, its size and its lc-up pairing."""
    tas = (
        ClassroomMembership.objects.filter(classroom=room, role=TA, status__in=ClassroomMembership.NON_REMOVED_STATUSES)
        .select_related("user")
    )
    return {
        "id": room.pk,
        "name": room.name,
        "subject": room.subject,
        "level": room.level or "",
        "description": room.description or "",
        "lesson_days": room.lesson_days or "",
        "lesson_time": room.lesson_time or "",
        "lesson_hours": room.lesson_hours,
        "start_date": iso(room.start_date),
        "room_number": room.room_number or "",
        "branch": {"id": room.branch_id, "name": room.branch.name} if room.branch_id else None,
        "telegram_chat_id": room.telegram_chat_id or "",
        "telegram_group_url": room.telegram_group_url or "",
        "max_students": room.max_students,
        "schedule_summary": room.schedule_summary or "",
        "is_active": room.is_active,
        "join_code": room.join_code,
        "created_at": iso(room.created_at),
        "teacher": _person(room.teacher) if room.teacher_id else None,
        "tas": sorted((_person(m.user) for m in tas), key=lambda p: p["name"].casefold()),
        "students": _student_seats(room).count(),
        "lcup": _lcup_block(room),
        "glance": _glance(room),
    }


def _glance(room) -> dict:
    """
    The figures the change form's header shows on its Overview: attendance over every marked
    lesson and the last lesson's day, homework handed in over everything published to the students
    sitting now, and how many of them owe lc-up — each the same reading as its tab.
    """
    from lcup.models import LcupStudentLink

    from .analytics import _completion_map
    from .attendance import compute_attendance_score
    from .models_attendance import AttendanceRecord, AttendanceSession

    every = list(AttendanceRecord.objects.filter(session__classroom=room).values_list("status", flat=True))
    last = AttendanceSession.objects.filter(classroom=room).order_by("-date").values_list("date", flat=True).first()
    ids = list(_student_seats(room).values_list("user_id", flat=True))
    work = [a for a in _homework_work(room) if a.status == Assignment.STATUS_PUBLISHED]
    published = {a.pk for a in work}
    done = _completion_map(room, ids, work) if ids and work else {}
    return {
        "attendance_rate": compute_attendance_score(every) if every else None,
        "last_lesson": iso(last),
        "homework": {
            "assignments": len(published),
            "handed_in": sum(len(done.get(u, set()) & published) for u in ids),
            "expected": len(ids) * len(published),
        },
        "owing": LcupStudentLink.objects.filter(user_id__in=ids, balance__lt=0).count() if ids else 0,
    }


def _homework_work(room):
    """Graded homework-type work (no classwork, no drafts) — the same reading as the person page's homework."""
    from .analytics import _academic_assignments

    return [a for a in _academic_assignments(room) if a.category != Assignment.CATEGORY_CLASSWORK]


def roster_part(room, request=None) -> dict:
    from lcup.models import LcupStudentLink
    from users.photos import profile_image_url

    from .analytics import _completion_map
    from .attendance import compute_attendance_score
    from .models_attendance import AttendanceRecord

    seats = sorted(_student_seats(room), key=lambda s: display_name(s.user).casefold())
    ids = [s.user_id for s in seats]
    statuses = defaultdict(list)
    for student_id, status in AttendanceRecord.objects.filter(
        session__classroom=room, student_id__in=ids
    ).values_list("student_id", "status"):
        statuses[student_id].append(status)
    balances = dict(LcupStudentLink.objects.filter(user_id__in=ids).values_list("user_id", "balance"))
    work = _homework_work(room)
    published = {a.pk for a in work if a.status == Assignment.STATUS_PUBLISHED}
    done = _completion_map(room, ids, work) if ids and work else {}

    def homework_rate(user_id):
        if not published:
            return None
        return round(100.0 * len(done.get(user_id, set()) & published) / len(published), 1)

    def owes(user_id):
        balance = balances.get(user_id)
        return int(-balance) if balance is not None and balance < 0 else None

    return {
        "students": [
            {
                "id": s.user_id,
                "name": display_name(s.user),
                "username": s.user.username,
                # The photo beside the name, as on every people list (owner, 2026-10-15).
                "avatar_url": profile_image_url(s.user, request),
                "section": section_of(s.user),
                "joined_at": iso(s.joined_at),
                "owes": owes(s.user_id),
                "attendance_rate": compute_attendance_score(statuses[s.user_id]) if statuses[s.user_id] else None,
                "homework_rate": homework_rate(s.user_id),
            }
            for s in seats
        ]
    }


def class_attendance_part(room, request=None) -> dict:
    from lcup.models import LcupAttendancePush

    from .attendance import compute_attendance_score
    from .models_attendance import AttendanceRecord, AttendanceSession

    sessions = list(AttendanceSession.objects.filter(classroom=room).order_by("-date", "-pk")[:SESSIONS_LIMIT])
    counts = defaultdict(dict)
    for r in (
        AttendanceRecord.objects.filter(session_id__in=[s.pk for s in sessions]).order_by()
        .values("session_id", "status").annotate(n=Count("pk"))
    ):
        counts[r["session_id"]][r["status"]] = r["n"]
    pushes = dict(
        LcupAttendancePush.objects.filter(group__classroom=room, date__in=[s.date for s in sessions])
        .values_list("date", "state")
    )
    every = list(AttendanceRecord.objects.filter(session__classroom=room).values_list("status", flat=True))
    return {
        "sessions": [
            {
                "date": iso(s.date),
                "present": counts[s.pk].get(AttendanceRecord.STATUS_PRESENT, 0),
                "late": counts[s.pk].get(AttendanceRecord.STATUS_LATE, 0),
                "absent": counts[s.pk].get(AttendanceRecord.STATUS_ABSENT, 0),
                "excused": counts[s.pk].get(AttendanceRecord.STATUS_EXCUSED, 0),
                "lcup_push": pushes.get(s.date),
            }
            for s in sessions
        ],
        "rate": compute_attendance_score(every) if every else None,
    }


def homework_part(room, request=None) -> dict:
    from .analytics import _completion_map

    work = [a for a in _homework_work(room) if a.status == Assignment.STATUS_PUBLISHED]
    work.sort(key=lambda a: a.created_at, reverse=True)
    work.sort(key=lambda a: (a.due_at is not None, a.due_at), reverse=True)  # by due date, undated last
    work = work[:HOMEWORK_LIMIT]
    ids = list(_student_seats(room).values_list("user_id", flat=True))
    done = _completion_map(room, ids, work) if ids and work else {}
    turned_in = defaultdict(int)
    for completed in done.values():
        for assignment_id in completed:
            turned_in[assignment_id] += 1
    return {
        "assignments": [
            {"id": a.pk, "title": a.title, "due_at": iso(a.due_at), "turned_in": turned_in[a.pk], "students": len(ids)}
            for a in work
        ]
    }


#: The class side of a membership event — the person page's ``MEMBERSHIP_ACTIONS`` read "Added to <class>".
CLASS_MEMBERSHIP_ACTIONS = {
    "ADDED": "Added", "REMOVED": "Removed", "REINSTATED": "Back", "ROLE_CHANGED": "Role changed",
    "STATUS_CHANGED": "Status changed", "DELETED": "Seat deleted",
}
_ROLE_WORDS = {"ADMIN": "owner", "OWNER": "owner", "TEACHER": "teacher", "TA": "support teacher"}


def class_history_part(room, request=None) -> dict:
    from .models_membership_audit import ClassroomMembershipEvent

    events = list(
        ClassroomMembershipEvent.objects.filter(classroom=room).order_by("-created_at", "-pk")[: HISTORY_LIMIT + 1]
    )
    items = []
    for ev in events[:HISTORY_LIMIT]:
        title = CLASS_MEMBERSHIP_ACTIONS.get(ev.action, ev.action.replace("_", " ").capitalize())
        if ev.student_name:
            title += f" — {ev.student_name}"
        role = _ROLE_WORDS.get(ev.new_role)  # a staff seat says so; a student's is the default
        if role:
            title += f" ({role})"
        items.append({"at": iso(timezone.localtime(ev.created_at)), "title": title, "by": ev.actor_name or ""})
    return {"items": items, "truncated": len(events) > HISTORY_LIMIT}


CLASS_PARTS = {
    "roster": roster_part,
    "attendance": class_attendance_part,
    "homework": homework_part,
    "history": class_history_part,
}
