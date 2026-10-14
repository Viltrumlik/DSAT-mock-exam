"""Our registers and lc-up's attendance, one group and one day at a time (lc-up Part 2).

The owner's rules (2026-10-14), and the two modes they make:

* **History** — "lc-upda ochilgan guruhni o'sha guruh ochilgandan boshlab shu kungacha hamma
  davomati biznikiga o'tishi kerak, u yerda 100% aniqlikdagi davomat bor". On a day lc-up recorded,
  the register becomes lc-up's exactly: its marks are copied, and a mark of ours lc-up does not
  have for that day is removed. A day lc-up never recorded is left as it is — and never sent, so no
  old lesson is billed.
* **Gap-fill** — after the cutover: "lc-up ustun, biz faqat bo'shliqni to'ldiramiz". lc-up's mark
  wins wherever it has one; a mark only we have is sent to lc-up once (``push_day``). If lc-up later
  deletes what we sent, ours goes too — lc-up is still the one that wins.

XP follows ("XP ham lc-up'ga moslashsin"), simply because every write here is an ordinary save or
delete of an ``AttendanceRecord`` and the reward hooks do the rest. That is also why records are
deleted one at a time: a queryset ``.delete()`` skips the refund.

A mark is only worth what the seat behind it allows: the register shows, and ``rewards`` pays, a
student only from the day their seat says they joined. lc-up's word on when they were there wins
here too, so a mirrored mark moves the seat's join date back to that day — or creates the seat, as
REMOVED, for someone who has since left the group.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time

from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession

from .models import LcupAttendancePush, LcupStudentLink

R = AttendanceRecord
M = ClassroomMembership


def ours_status(row: dict) -> tuple[str, int | None]:
    """An lc-up attendance row as ``(our status, lc-up reason id)``."""
    if row.get("present"):
        return (R.STATUS_LATE if row.get("late") else R.STATUS_PRESENT), None
    reason = row.get("reason")
    if isinstance(reason, dict) and reason.get("id") is not None:
        return R.STATUS_EXCUSED, int(reason["id"])
    return R.STATUS_ABSENT, None


def lcup_record(record, lcup_student_id: int) -> dict:
    """One of our marks as an lc-up ``records[]`` item. EXCUSED is an ``absent`` with its reason."""
    if record.status == R.STATUS_PRESENT:
        return {"student_id": lcup_student_id, "status": "present"}
    if record.status == R.STATUS_LATE:
        return {"student_id": lcup_student_id, "status": "late"}
    out = {"student_id": lcup_student_id, "status": "absent"}
    if record.status == R.STATUS_EXCUSED and record.lcup_reason_id:
        out["reason_id"] = record.lcup_reason_id
    return out


@dataclass
class DayPlan:
    link: object
    day: date
    #: lc-up has at least one live mark for this group and day.
    recorded: bool = False
    #: user id → (status, reason id): lc-up's marks ours does not already equal.
    mirror: dict = field(default_factory=dict)
    #: user ids whose mark of ours goes.
    delete: set = field(default_factory=set)
    #: user id → lc-up ``records[]`` item: what only we have, to send (gap-fill only).
    push: dict = field(default_factory=dict)


def _as_marked(record) -> tuple[str, int | None]:
    return record.status, (record.lcup_reason_id if record.status == R.STATUS_EXCUSED else None)


def plan_day(link, day: date, rows: list[dict], *, gap_fill: bool) -> DayPlan:
    """What it takes for ``link``'s class register on ``day`` to agree with lc-up. ``rows`` are
    lc-up's rows for this group and day, deleted ones included. Reads only; ``apply_day`` writes."""
    plan = DayPlan(link=link, day=day)
    live = [r for r in rows if not r.get("deleted_at")]
    plan.recorded = bool(live)
    lcup_ids = {r.get("student_id") for r in rows}
    user_of = dict(
        LcupStudentLink.objects.filter(lcup_student_id__in=lcup_ids, user__isnull=False).values_list(
            "lcup_student_id", "user_id"
        )
    )
    session = AttendanceSession.objects.filter(classroom=link.classroom, date=day).first()
    ours = {r.student_id: r for r in session.records.all()} if session else {}

    in_lcup = set()
    for r in live:
        uid = user_of.get(r.get("student_id"))
        if uid is None:
            continue  # a student with no account here (left before we knew them) — nothing to hold it
        in_lcup.add(uid)
        want = ours_status(r)
        have = ours.get(uid)
        if have is None or _as_marked(have) != want:
            plan.mirror[uid] = want

    ours_only = set(ours) - in_lcup
    if not gap_fill:
        if plan.recorded:
            plan.delete = ours_only
        return plan

    sent = LcupAttendancePush.objects.filter(group=link, date=day, state=LcupAttendancePush.STATE_SENT).first()
    pushed = {r.get("user_id") for r in (sent.records if sent else [])}
    deleted_in_lcup = {
        user_of[r.get("student_id")] for r in rows if r.get("deleted_at") and r.get("student_id") in user_of
    } - in_lcup
    lcup_id_of = dict(LcupStudentLink.objects.filter(user_id__in=ours_only).values_list("user_id", "lcup_student_id"))
    for uid in ours_only:
        if uid in pushed:
            if uid in deleted_in_lcup:
                plan.delete.add(uid)  # lc-up removed what we sent: lc-up wins
            continue  # sent once already — never again
        lcup_id = lcup_id_of.get(uid)
        if lcup_id is None:
            continue  # not lc-up's student; the roster takes them out of the class
        plan.push[uid] = lcup_record(ours[uid], lcup_id)
    return plan


def _local_midnight(day: date):
    return timezone.make_aware(datetime.combine(day, time.min))


def _seat_from(classroom, user_id: int, day: date) -> None:
    """Make sure ``user_id`` has a student seat in ``classroom`` dated no later than ``day``."""
    seat = M.objects.filter(classroom=classroom, user_id=user_id).first()
    if seat is None:
        seat = M.objects.create(classroom=classroom, user_id=user_id, role=M.ROLE_STUDENT, status=M.STATUS_REMOVED)
        M.objects.filter(pk=seat.pk).update(joined_at=_local_midnight(day))
        return
    if seat.role == M.ROLE_STUDENT and timezone.localdate(seat.joined_at) > day:
        # ``update`` — the join date is not a roster change, and no hook watches it.
        M.objects.filter(pk=seat.pk).update(joined_at=_local_midnight(day))


def apply_day(plan: DayPlan) -> Counter:
    """Write ``plan`` to the register (not the push — see ``push_day``). Counts what it did."""
    counts = Counter()
    room = plan.link.classroom
    session = AttendanceSession.objects.filter(classroom=room, date=plan.day).first()
    if session is None:
        if not (plan.mirror or plan.push):
            return counts
        session = AttendanceSession.objects.create(classroom=room, date=plan.day, created_by=None)
        counts["att_registers_created"] += 1

    for uid, (status, reason_id) in plan.mirror.items():
        _seat_from(room, uid, plan.day)
        _, created = R.objects.update_or_create(
            session=session, student_id=uid, defaults={"status": status, "lcup_reason_id": reason_id, "marked_by": None}
        )
        counts["att_marks_added" if created else "att_marks_changed"] += 1
    # One at a time: the reward hook refunds on each delete, and a queryset delete would skip it.
    for record in R.objects.filter(session=session, student_id__in=plan.delete):
        record.delete()
        counts["att_marks_deleted"] += 1

    if (plan.recorded or plan.push) and session.status != AttendanceSession.STATUS_FINALIZED:
        session.status = AttendanceSession.STATUS_FINALIZED
        session.save(update_fields=["status", "updated_at"])
    return counts
