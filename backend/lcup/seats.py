"""A seat's details in our own tables, copied from lc-up until the centre leaves it (owner, 2026-11-04).

lc-up keeps a group's price and each member's status and dates; ``classes`` had no place for them. Once the
fields below are full and read here, leaving lc-up only changes who writes them: the admin screens instead of
this copy. ``differences`` is the daily check that the copy has not drifted from lc-up.

These go through ``.update()``, unlike the roster's own changes (``roster``): nobody joined or left, so there is
nothing for the membership audit or the Telegram group to hear about.
"""

from __future__ import annotations

from django.utils import timezone

from classes.models import Classroom, ClassroomMembership as M

from .models import GroupLinkStatus, LcupGroupLink

_KNOWN = {M.SEAT_ACTIVE, M.SEAT_TRIAL, M.SEAT_FROZEN}


def _links():
    return LcupGroupLink.objects.filter(
        status=GroupLinkStatus.CONFIRMED, classroom__isnull=False, deleted_in_lcup_at__isnull=True
    ).select_related("classroom")


def _cost(link) -> int | None:
    try:
        cost = int(float((link.snapshot or {}).get("cost") or 0))
    except (TypeError, ValueError):
        return None
    return cost if cost > 0 else None


def fill_from_lcup() -> int:
    """Copy each paired group's price and its members' details. How many rows changed. A class lc-up no longer
    runs is managed by hand again, so a status copied into it earlier goes back to plain active."""
    written = 0
    links = list(_links())
    for link in links:
        room, cost = link.classroom, _cost(link)
        if cost and room.monthly_price != cost:
            Classroom.objects.filter(pk=room.pk).update(monthly_price=cost)
            written += 1
        rows = {row.user_id: row for row in M.objects.filter(classroom=room, role=M.ROLE_STUDENT)}
        for member in link.memberships.filter(student__user__isnull=False).select_related("student"):
            row = rows.get(member.student.user_id)
            if row is None:
                continue
            status = member.lcup_status if member.lcup_status in _KNOWN else row.seat_status
            left_on = timezone.localdate(member.left_at) if member.left_at else None
            if (row.seat_status, row.seat_start_date, row.seat_left_on) != (status, member.start_date, left_on):
                M.objects.filter(pk=row.pk).update(seat_status=status, seat_start_date=member.start_date, seat_left_on=left_on)
                written += 1
    stale = M.objects.filter(role=M.ROLE_STUDENT).exclude(classroom_id__in=[link.classroom_id for link in links])
    written += stale.exclude(seat_status=M.SEAT_ACTIVE).update(seat_status=M.SEAT_ACTIVE)
    return written


def differences() -> list[str]:
    """Where a live seat here says something other than lc-up, in words for the Ledger tab."""
    lines = []
    for link in _links():
        room = link.classroom
        rows = {
            row.user_id: row
            for row in M.objects.filter(classroom=room, role=M.ROLE_STUDENT, status=M.STATUS_ACTIVE)
        }
        members = link.memberships.filter(left_at__isnull=True, student__user__isnull=False).select_related("student")
        for member in members:
            row = rows.get(member.student.user_id)
            if row is None or member.lcup_status not in _KNOWN:
                continue
            name = member.student.name.strip()
            if row.seat_status != member.lcup_status:
                lines.append(f"{room.name}: {name} is {member.lcup_status} in lc-up, {row.seat_status} here")
            elif row.seat_start_date != member.start_date:
                lines.append(f"{room.name}: {name} starts {member.start_date} in lc-up, {row.seat_start_date} here")
    return lines
