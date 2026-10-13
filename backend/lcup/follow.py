"""A paired class follows its lc-up group (owner, 2026-10-13: groups fully automatic).

lc-up is the master for its groups, so what lc-up CHANGES reaches the class: the name, days, time,
level and filial, who teaches it, and — when the group is deleted — the class itself, which is
archived (``is_active=False``, the soft archive a teacher already has; nothing is deleted) and
reopened if lc-up restores the group.

**Changes, never the state.** Details and teacher removals compare lc-up's previous snapshot of the
group with this one. A class that already differed from lc-up when the admin paired it stays as it
is until lc-up itself changes something — on prod that difference was real (2026-10-13: three class
names, and nine teachers of ours sitting in classes whose lc-up groups do not list them).

Teachers are reconciled on one side only: everyone lc-up lists who is linked to an account of ours
teaches the class. Removal needs lc-up to have taken them off, and never touches a TA — support
teachers are ours, not lc-up's — nor a teacher lc-up never had there. A group that suddenly lists no
teacher at all is not believed, the way an empty member list is not (``sync``).
"""

from __future__ import annotations

from django.db import transaction

from access import constants as acc_const
from access.models import UserAccess
from classes.models import Classroom, ClassroomMembership

from .classrooms import _lesson_hours, branch_for, teachers_for
from .matching import days_from, level_from, subject_from
from .models import LcupTeacherLink, LinkStatus

M = ClassroomMembership
_MANAGERS = (M.ROLE_ADMIN, M.ROLE_OWNER, M.ROLE_TEACHER)
_LABELS = {
    "name": "name",
    "lesson_days": "days",
    "lesson_time": "time",
    "lesson_hours": "lesson length",
    "branch": "filial",
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
    """Apply what lc-up changed in the group's details to ``room``; the fields changed."""
    if not previous:
        return []
    updates = {}
    name = str(current.get("name") or "").strip()
    if name and name != str(previous.get("name") or "").strip():
        updates["name"] = name[:120]
    if _days(current) != _days(previous):
        days = days_from(current)
        if days is None:
            alerts.append(
                f"lc-up lesson days of {room.name} are neither Mon/Wed/Fri nor Tue/Thu/Sat; the class keeps its days"
            )
        else:
            updates["lesson_days"] = days
    start, _ = _times(current)
    if start and start != _times(previous)[0]:
        updates["lesson_time"] = start
    if _times(current) != _times(previous):
        updates["lesson_hours"] = _lesson_hours(current)
    if current.get("filial_id") != previous.get("filial_id"):
        branch = branch_for(current)
        if branch is not None:
            updates["branch"] = branch
    level = level_from(current)
    # English has no Foundation: a level the class's subject has not is not taken.
    if level and level != level_from(previous) and level in Classroom.LEVELS_BY_SUBJECT.get(room.subject, ()):
        updates["level"] = level
    subject = subject_from(current)
    if subject and subject != subject_from(previous) and subject != room.subject:
        # A class's subject decides its content and its teachers' access: a person moves it.
        alerts.append(f"lc-up moved {room.name} to another subject; the class keeps its subject")

    changed = [field for field, value in updates.items() if getattr(room, field) != value]
    if changed:
        for field in changed:
            setattr(room, field, updates[field])
        room.save(update_fields=[*changed, "updated_at"])
        alerts.append(f"class {room.name} updated from lc-up: {', '.join(_LABELS[f] for f in changed)}")
    return changed


def _grant_class_access(room: Classroom, user_id: int) -> None:
    domain = acc_const.DOMAIN_MATH if room.subject == Classroom.SUBJECT_MATH else acc_const.DOMAIN_ENGLISH
    UserAccess.objects.get_or_create(user_id=user_id, subject=domain, classroom=room, defaults={"granted_by": None})


def follow_teachers(link, previous: dict, current: dict, alerts: list) -> dict:
    """Make the class's teachers lc-up's: add who lc-up lists, remove who lc-up took off."""
    counts = {"teachers_added": 0, "teachers_removed": 0}
    room = link.classroom
    was, now = _teacher_ids(previous), _teacher_ids(current)
    if was and not now:
        alerts.append(f"lc-up lists no teacher for {link.name}; the teachers of {room.name} are kept")
        return counts

    desired = teachers_for(current)
    lcup_id_of = dict(LcupTeacherLink.objects.filter(user__in=desired).values_list("user_id", "lcup_teacher_id"))
    with transaction.atomic():
        teaching = []
        for user in desired:
            row = M.objects.filter(classroom=room, user=user).first()
            if row is None:
                M.objects.create(classroom=room, user=user, role=M.ROLE_TEACHER, status=M.STATUS_ACTIVE)
            elif row.role == M.ROLE_STUDENT:
                if lcup_id_of.get(user.pk) not in was:  # said when lc-up lists them, not every run
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

        gone = set(
            LcupTeacherLink.objects.filter(lcup_teacher_id__in=was - now, user__isnull=False)
            .exclude(status=LinkStatus.IGNORED)
            .values_list("user_id", flat=True)
        ) - {u.pk for u in desired}
        # save(), never update(): leaving a class has side effects (its Telegram group, the audit row).
        for row in M.objects.filter(classroom=room, user_id__in=gone, role__in=_MANAGERS, status=M.STATUS_ACTIVE):
            row.status = M.STATUS_REMOVED
            row.save(update_fields=["status"])
            counts["teachers_removed"] += 1

        if room.teacher_id is None or room.teacher_id in gone:
            # lc-up's first teacher owns the class, as when the sync creates one (classrooms.py).
            owner = teaching[0] if teaching else None
            if owner is not None:
                row = M.objects.get(classroom=room, user=owner)
                if row.role == M.ROLE_TEACHER:
                    row.role = M.ROLE_ADMIN
                    row.save(update_fields=["role"])
            elif room.teacher_id is not None:
                alerts.append(f"{room.name} has no lc-up teacher with an account of ours; it has no owner now")
            if (owner.pk if owner else None) != room.teacher_id:
                room.teacher = owner
                room.save(update_fields=["teacher", "updated_at"])
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
