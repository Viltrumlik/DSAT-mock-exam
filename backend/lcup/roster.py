"""lc-up's member list applied to the paired class.

**Writes go through ``ClassroomMembership.save()``**, never ``.update()``, so everything a
teacher's own roster change sets off happens here too: the membership audit row, the practice
library grant on joining, and — on removal — leaving the class's Telegram group. That last one is
why removals are guarded so hard.

**Who may be removed.** A linked student who has left the lc-up group, and — since the owner made
the roster a mirror of lc-up (2026-10-14) — a student with no lc-up link at all. The second is held
while lc-up has a live member here with no account of ours, who may be that same person still
waiting in the admin's review queue. Staff rows are never touched here (``follow`` owns them).

**Too many removals at once are held, not applied.** lc-up answering with half a list — a bug, a
partial outage — would otherwise empty a class and its Telegram group in one sync. Above
``max(3, 20%)`` of a class, or 15 across a run (see ``sync``), removals wait for a person.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from django.db import transaction

from access import constants as acc_const
from access.models import UserAccess
from classes.models import Classroom, ClassroomMembership

from .models import LcupStudentLink

MAX_REMOVALS_PER_RUN = 15

_STUDENT = ClassroomMembership.ROLE_STUDENT
_ACTIVE = ClassroomMembership.STATUS_ACTIVE
_REMOVED = ClassroomMembership.STATUS_REMOVED


def per_class_removal_cap(active_count: int) -> int:
    return max(3, int(active_count * 0.2))


@dataclass
class RosterPlan:
    to_add: set[int] = field(default_factory=set)
    to_reactivate: set[int] = field(default_factory=set)
    to_remove: set[int] = field(default_factory=set)
    #: Active students with no lc-up link. Not capped: the caps guard against lc-up answering with
    #: half a member list, and this reads no member list at all.
    to_remove_unlinked: set[int] = field(default_factory=set)
    blocked_removals: bool = False


def plan_group(link) -> RosterPlan:
    room = link.classroom
    if room is None:
        return RosterPlan()
    # trial and frozen are ordinary members (the owner's decision); only having left removes.
    desired = set(
        link.memberships.filter(left_at__isnull=True, student__user__isnull=False).values_list(
            "student__user_id", flat=True
        )
    )
    rows = {row.user_id: row for row in ClassroomMembership.objects.filter(classroom=room)}

    plan = RosterPlan()
    for user_id in desired:
        row = rows.get(user_id)
        if row is None:
            plan.to_add.add(user_id)
        elif row.role != _STUDENT:
            continue
        elif row.status != _ACTIVE:
            plan.to_reactivate.add(user_id)

    current = {uid for uid, row in rows.items() if row.role == _STUDENT and row.status == _ACTIVE}
    linked = set(LcupStudentLink.objects.filter(user_id__in=current).values_list("user_id", flat=True))
    plan.to_remove = (current & linked) - desired
    plan.blocked_removals = len(plan.to_remove) > per_class_removal_cap(len(current))
    # The roster mirrors lc-up (owner, 2026-10-14: "o'quvchi lc-upda bo'lmasa bizdan ham chiqib
    # ketsin"), so a student with no lc-up link at all leaves too — unless lc-up has a live member
    # here with no account of ours yet, who may be this very person waiting in the review queue.
    if not link.memberships.filter(left_at__isnull=True, student__user__isnull=True).exists():
        plan.to_remove_unlinked = current - linked
    return plan


def _grant_subject_access(room, user_id: int) -> None:
    # Parity with JoinClassView and the admin roster add: without the classroom-scoped grant a
    # student is in the class but cannot open its subject's content.
    domain = acc_const.DOMAIN_MATH if room.subject == Classroom.SUBJECT_MATH else acc_const.DOMAIN_ENGLISH
    UserAccess.objects.get_or_create(user_id=user_id, subject=domain, classroom=room, defaults={"granted_by": None})


def apply_plan(link, plan: RosterPlan, *, allow_removals: bool) -> dict:
    counts = {"added": 0, "reactivated": 0, "removed": 0, "removed_unlinked": 0}
    room = link.classroom
    if room is None:
        return counts
    with transaction.atomic():
        for user_id in sorted(plan.to_add):
            _, created = ClassroomMembership.objects.get_or_create(
                classroom=room, user_id=user_id, defaults={"role": _STUDENT, "status": _ACTIVE}
            )
            _grant_subject_access(room, user_id)
            counts["added"] += int(created)
        for row in ClassroomMembership.objects.filter(classroom=room, user_id__in=plan.to_reactivate, role=_STUDENT):
            row.status = _ACTIVE
            row.save(update_fields=["status"])
            _grant_subject_access(room, row.user_id)
            counts["reactivated"] += 1
        if allow_removals and not plan.blocked_removals:
            for row in ClassroomMembership.objects.filter(
                classroom=room, user_id__in=plan.to_remove, role=_STUDENT, status=_ACTIVE
            ):
                row.status = _REMOVED
                row.save(update_fields=["status"])
                counts["removed"] += 1
        for row in ClassroomMembership.objects.filter(
            classroom=room, user_id__in=plan.to_remove_unlinked, role=_STUDENT, status=_ACTIVE
        ):
            row.status = _REMOVED
            row.save(update_fields=["status"])
            counts["removed_unlinked"] += 1
    return counts
