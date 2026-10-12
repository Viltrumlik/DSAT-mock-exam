"""A class of ours for an lc-up group that has none.

Built the way ``ClassroomViewSet.create`` builds one (classes/views.py): the owning teacher gets an
``ADMIN`` membership and a classroom-scoped ``UserAccess`` for the class's subject, so the class
works for them exactly as if they had created it. A second lc-up teacher becomes a ``TEACHER``.

The lesson length comes from lc-up's start/finish times and is rounded *up* to whole hours:
``attendance_window`` closes the register two hours after the lesson's end, and a lesson recorded
as shorter than it is would close the register while the class is still in the room.
"""

from __future__ import annotations

import math
from datetime import datetime

from django.db import transaction

from access import constants as acc_const
from access.models import UserAccess
from classes.models import Classroom, ClassroomMembership

from .matching import days_from, level_from, subject_from
from .models import GroupLinkStatus

DEFAULT_LESSON_HOURS = 2


def _lesson_hours(snapshot: dict) -> int:
    try:
        start = datetime.strptime(str(snapshot.get("start_time") or "")[:5], "%H:%M")
        finish = datetime.strptime(str(snapshot.get("finish_time") or "")[:5], "%H:%M")
    except ValueError:
        return DEFAULT_LESSON_HOURS
    seconds = (finish - start).total_seconds()
    return max(1, math.ceil(seconds / 3600)) if seconds > 0 else DEFAULT_LESSON_HOURS


def create_classroom_for(link, *, teacher_users: list, branch) -> Classroom:
    if not teacher_users:
        raise ValueError("an lc-up group needs a linked teacher before a class can be created for it")
    snapshot = link.snapshot or {}
    subject = subject_from(snapshot)
    days = days_from(snapshot)
    if subject is None:
        raise ValueError("cannot tell Math from English in this lc-up course")
    if days is None:
        raise ValueError("lc-up lesson days are neither Mon/Wed/Fri nor Tue/Thu/Sat")

    owner = teacher_users[0]
    domain = acc_const.DOMAIN_MATH if subject == Classroom.SUBJECT_MATH else acc_const.DOMAIN_ENGLISH
    with transaction.atomic():
        room = Classroom.objects.create(
            name=(link.name or snapshot.get("name") or "lc-up group")[:120],
            subject=subject,
            level=level_from(snapshot),
            lesson_days=days,
            lesson_time=str(snapshot.get("start_time") or "")[:5],
            lesson_hours=_lesson_hours(snapshot),
            branch=branch,
            created_by=owner,
            teacher=owner,
        )
        for index, teacher in enumerate(teacher_users):
            role = ClassroomMembership.ROLE_ADMIN if index == 0 else ClassroomMembership.ROLE_TEACHER
            ClassroomMembership.objects.get_or_create(classroom=room, user=teacher, defaults={"role": role})
            UserAccess.objects.get_or_create(user=teacher, subject=domain, classroom=room, defaults={"granted_by": None})
        link.classroom = room
        link.status = GroupLinkStatus.CONFIRMED
        link.save(update_fields=["classroom", "status"])
    return room
