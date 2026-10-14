"""A paired class follows its lc-up group (owner, 2026-10-13: groups fully automatic).

lc-up is the master for its groups, so the class follows it: its details, who teaches it, and —
when the group is deleted — the class itself, which is archived (``is_active=False``, the soft
archive a teacher already has; nothing is deleted) and reopened if lc-up restores the group.

**Details are lc-up's, always** (owner, 2026-10-14): name, subject and level (from the course), days,
time, lesson length and filial are made lc-up's on every run, even where the class differed before.

**Teachers are lc-up's, always** (owner, 2026-10-14: "teacherlarni ham to'liq sync qiling", and
asked, admins too). Everyone lc-up lists who is linked to an account of ours teaches the class, and
every other teacher or admin seat is taken out — on the first run that was 45 seats of 11 people,
the centre's own admin account among them. A TA — support teachers are ours, not lc-up's — is never
touched. Nobody is taken out while lc-up lists no teacher at all (not believed, the way an empty
member list is not) or none of its teachers has an account of ours yet.
"""

from __future__ import annotations

from django.db import transaction

from access import constants as acc_const
from access.models import UserAccess
from classes.models import Classroom, ClassroomMembership

from .classrooms import (
    _lesson_hours,
    branch_for,
    classroom_name,
    room_number_from,
    start_date_from,
    teachers_for,
)
from .matching import days_from, level_from, subject_from
from .models import LcupTeacherLink, LinkStatus

M = ClassroomMembership
_MANAGERS = (M.ROLE_ADMIN, M.ROLE_OWNER, M.ROLE_TEACHER)
_LABELS = {
    "name": "name",
    "subject": "subject",
    "lesson_days": "days",
    "lesson_time": "time",
    "lesson_hours": "lesson length",
    "branch": "filial",
    "room_number": "room",
    "start_date": "start date",
    "level": "level",
}


def _days(snapshot: dict):
    try:
        return sorted(int(d) for d in snapshot.get("days") or [])
    except (TypeError, ValueError):
        return None


def _times(snapshot: dict) -> tuple[str, str]:
    return str(snapshot.get("start_time") or "")[:5], str(snapshot.get("finish_time") or "")[:5]


def _teacher_ids(snapshot: dict) -> set[int]:
    return {t.get("id") for t in snapshot.get("teachers") or [] if t.get("id") is not None}


def follow_details(room: Classroom, previous: dict, current: dict, alerts: list) -> list[str]:
    """Make the class's details lc-up's — every run, whatever they were before (owner, 2026-10-14:
    "guruh ma'lumotlari doimiy sync bo'lishi kerak … hatto courselar ham"). The fields changed.

    Only what lc-up states and we can hold is taken: days that are neither Mon/Wed/Fri nor
    Tue/Thu/Sat, a filial no branch is mapped to, or a level the subject has not (English has no
    Foundation) leave that field as it is.
    """
    want = {}
    name = classroom_name(current.get("name"))
    if name:
        want["name"] = name
    subject = subject_from(current)  # the course decides, the group name is the fallback
    if subject:
        want["subject"] = subject
    days = days_from(current)
    if days:
        want["lesson_days"] = days
    elif previous and _days(current) != _days(previous):
        # Said when lc-up changes them, not every 15 minutes.
        alerts.append(f"lc-up lesson days of {room.name} are neither Mon/Wed/Fri nor Tue/Thu/Sat; the class keeps its days")
    start, finish = _times(current)
    if start:
        want["lesson_time"] = start
    if start and finish:
        want["lesson_hours"] = _lesson_hours(current)
    branch = branch_for(current)
    if branch is not None:
        want["branch"] = branch
    room_number = room_number_from(current)
    if room_number:
        want["room_number"] = room_number
    start_date = start_date_from(current)
    if start_date:
        want["start_date"] = start_date
    level = level_from(current)
    if level and level in Classroom.LEVELS_BY_SUBJECT.get(want.get("subject", room.subject), ()):
        want["level"] = level

    changed = [field for field, value in want.items() if getattr(room, field) != value]
    if not changed:
        return []
    for field in changed:
        setattr(room, field, want[field])
    room.save(update_fields=[*changed, "updated_at"])
    if "subject" in changed:
        # The class's content is now the other subject's: everyone in it gets the class-scoped
        # access for it, as on joining. The old grant stays — it opens only this class's own work.
        for user_id in M.objects.filter(classroom=room).exclude(status=M.STATUS_REMOVED).values_list("user_id", flat=True):
            _grant_class_access(room, user_id)
    alerts.append(f"class {room.name} updated from lc-up: {', '.join(_LABELS[f] for f in changed)}")
    return changed


def _grant_class_access(room: Classroom, user_id: int) -> None:
    domain = acc_const.DOMAIN_MATH if room.subject == Classroom.SUBJECT_MATH else acc_const.DOMAIN_ENGLISH
    UserAccess.objects.get_or_create(user_id=user_id, subject=domain, classroom=room, defaults={"granted_by": None})


def follow_teachers(link, previous: dict, current: dict, alerts: list) -> dict:
    """Make the class's teaching staff lc-up's: lc-up's teachers teach it, every other teacher and
    admin seat is taken out (owner, 2026-10-14). TAs — our support teachers — stay."""
    counts = {"teachers_added": 0, "teachers_removed": 0}
    room = link.classroom
    was, now = _teacher_ids(previous), _teacher_ids(current)
    changed = was != now  # an alert is said when lc-up changes something, not every 15 minutes
    if not now:
        if changed:
            alerts.append(f"lc-up lists no teacher for {link.name}; the teachers of {room.name} are kept")
        return counts
    desired = teachers_for(current)
    if not desired:
        # lc-up's teacher is not linked yet (in review, or no phone): taking the others out would
        # leave the class with nobody to teach it.
        if changed:
            alerts.append(f"lc-up's teachers of {link.name} have no account of ours yet; the teachers of {room.name} are kept")
        return counts

    with transaction.atomic():
        teaching = []
        for user in desired:
            row = M.objects.filter(classroom=room, user=user).first()
            if row is None:
                M.objects.create(classroom=room, user=user, role=M.ROLE_TEACHER, status=M.STATUS_ACTIVE)
            elif row.role == M.ROLE_STUDENT:
                if changed:
                    alerts.append(f"lc-up lists a student of {room.name} as its teacher; not made a teacher")
                continue
            elif row.role == M.ROLE_TA or row.status == M.STATUS_REMOVED:
                row.role = M.ROLE_TEACHER if row.role == M.ROLE_TA else row.role
                row.status = M.STATUS_ACTIVE
                row.save(update_fields=["role", "status"])
            else:
                teaching.append(user)
                continue
            _grant_class_access(room, user.pk)
            counts["teachers_added"] += 1
            teaching.append(user)
        if not teaching:
            return counts

        keep = {u.pk for u in teaching}
        # save(), never update(): leaving a class has side effects (its Telegram group, the audit row).
        for row in (
            M.objects.filter(classroom=room, role__in=_MANAGERS)
            .exclude(status=M.STATUS_REMOVED)
            .exclude(user_id__in=keep)
        ):
            row.status = M.STATUS_REMOVED
            row.save(update_fields=["status"])
            counts["teachers_removed"] += 1

        # lc-up's first teacher owns the class, on an ADMIN seat, as when the sync creates one.
        if room.teacher_id not in keep:
            room.teacher = teaching[0]
            room.save(update_fields=["teacher", "updated_at"])
        owner_row = M.objects.get(classroom=room, user_id=room.teacher_id)
        if owner_row.role == M.ROLE_TEACHER:
            owner_row.role = M.ROLE_ADMIN
            owner_row.save(update_fields=["role"])
    return counts


def archive_class(link, now, alerts: list) -> bool:
    """lc-up deleted the group: archive its class (soft — the class keeps everything)."""
    room = link.classroom
    if not room.is_active:
        alerts.append(f"lc-up group deleted: {link.name}; its class {room.name} was archived already")
        return False
    room.is_active = False
    room.save(update_fields=["is_active", "updated_at"])
    link.class_archived_at = now
    alerts.append(f"lc-up group deleted: {link.name}; its class {room.name} was archived")
    return True


def reopen_class(link, alerts: list) -> bool:
    """lc-up restored the group: reopen the class — only if it was this sync that archived it."""
    room = link.classroom
    if link.class_archived_at is None:
        alerts.append(f"lc-up group restored: {link.name}; its class {room.name} was not archived by lc-up and stays as it is")
        return False
    link.class_archived_at = None
    if room.is_active:
        return False
    room.is_active = True
    room.save(update_fields=["is_active", "updated_at"])
    alerts.append(f"lc-up group restored: {link.name}; its class {room.name} is open again")
    return True
