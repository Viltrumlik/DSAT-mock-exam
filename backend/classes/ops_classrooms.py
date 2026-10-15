"""/ops Classrooms as a Django-admin changelist and change form (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from django.db.models import Count, F, Q

from users.changelist import to_int
from users.people_detail import display_name, iso

from .models import Classroom, ClassroomMembership

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
