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

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from classes.models import ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession

from .attendance_guard import FROZEN
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
    #: user ids lc-up lists that day — each needs a seat dated no later than the lesson.
    listed: set = field(default_factory=set)
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
        plan.listed.add(uid)
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
    # lc-up takes no mark for a member it holds frozen — it answers ``not_in_group`` — so none is
    # sent. The register offers none for them either (``attendance_guard.frozen_in_lcup``); this
    # is for a mark made before lc-up froze them.
    frozen = set(
        link.memberships.filter(left_at__isnull=True, lcup_status=FROZEN, student__user__isnull=False).values_list(
            "student__user_id", flat=True
        )
    )
    for uid in ours_only:
        if uid in frozen:
            continue
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

    # Every student lc-up lists, not only those whose mark changes: a mark that already agreed may
    # still be refused its XP by a join date that came later than the lesson.
    for uid in plan.listed:
        _seat_from(room, uid, plan.day)
    for uid, (status, reason_id) in plan.mirror.items():
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


# ── the push ──────────────────────────────────────────────────────────────

#: A transient failure (lc-up busy or down) is tried again on later runs, this many times in all.
MAX_PUSH_ATTEMPTS = 5


def push_held_reason(link) -> str | None:
    """Why ``link``'s registers are not sent at all, or None. lc-up bills every student it lists;
    one we have no account for cannot be in what we send, so their fee would quietly be missed."""
    if link.memberships.filter(left_at__isnull=True, student__user__isnull=True).exists():
        return f"attendance push held for {link.name}: an lc-up student of this group has no account here"
    return None


def push_day(client, plan: DayPlan, *, now):
    """Send ``plan.push`` to lc-up — once for this group and day — and record it. None when there
    is nothing to send, the switch is off, the day is before the cutover, the group is held, or the
    register was already sent (or refused, or tried ``MAX_PUSH_ATTEMPTS`` times)."""
    from .client import LcupError, LcupWindowClosed
    from .conf import attendance_push_enabled, attendance_push_from

    if not plan.push or not attendance_push_enabled():
        return None
    start = attendance_push_from()
    if start is None or plan.day < start or push_held_reason(plan.link):
        return None
    push, _ = LcupAttendancePush.objects.get_or_create(group=plan.link, date=plan.day)
    if push.state in (LcupAttendancePush.STATE_SENT, LcupAttendancePush.STATE_REFUSED) or push.attempts >= MAX_PUSH_ATTEMPTS:
        return None

    records = [{"user_id": uid, **item} for uid, item in sorted(plan.push.items())]
    push.records = records
    push.attempts += 1
    try:
        answer = client.post_attendance(
            plan.link.lcup_group_id, plan.day, [{k: v for k, v in r.items() if k != "user_id"} for r in records]
        )
    except LcupWindowClosed as exc:
        push.state, push.error = LcupAttendancePush.STATE_REFUSED, str(exc)[:300]
    except LcupError as exc:
        push.state, push.error = LcupAttendancePush.STATE_FAILED, f"{type(exc).__name__}: {exc}"[:300]
    else:
        user_of = {r["student_id"]: r["user_id"] for r in records}
        push.state, push.error, push.sent_at = LcupAttendancePush.STATE_SENT, "", now
        push.summary = answer.get("summary") or {}
        push.failures = [
            {
                "user_id": user_of.get(res.get("student_id")),
                "student_id": res.get("student_id"),
                "code": str((res.get("error") or {}).get("code") or ""),
                "message": str((res.get("error") or {}).get("message") or "")[:200],
            }
            for res in answer.get("results") or []
            if res.get("result") == "failed"
        ]
    push.save()
    return push


# ── the one-time history import ───────────────────────────────────────────

#: lc-up takes at most 92 days per attendance request.
HISTORY_WINDOW_DAYS = 90


def _course_start(link):
    raw = str((link.snapshot or {}).get("course_start_date") or "")[:10]
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _attendance_xp() -> int:
    from django.db.models import Sum

    from rewards.models import PointAward

    return PointAward.objects.filter(source_type="attendance_record").aggregate(t=Sum("xp"))["t"] or 0


def import_history(client, *, until: date, dry_run: bool = False, groups=None) -> dict:
    """Make every paired group's registers lc-up's, from the earliest course start to ``until``
    (history mode — nothing is ever sent). XP follows through the ordinary hooks, and every record
    in the window is re-settled afterwards, so a mark the old join date refused is paid now. Strike
    resets are ledgered but not announced (``strikes.deferred``), and no reward notice goes out either
    (``core.quiet``). ``dry_run`` does it all inside a
    transaction that is rolled back — the report is how the owner sees the numbers first.

    ``groups`` narrows it to those group links, read from lc-up one group at a time — how a
    student's marks follow them to the account they confirmed (``phone_confirm.follow_link``)."""
    from django.db import transaction

    from classes.models_attendance import AttendanceRecord
    from core.quiet import quiet_delivery
    from rewards import strikes
    from rewards.hooks import sync_attendance_record

    from .client import ATTENDANCE_PATH
    from .models import GroupLinkStatus, LcupGroupLink

    links = LcupGroupLink.objects.filter(
        status=GroupLinkStatus.CONFIRMED, classroom__isnull=False, deleted_in_lcup_at__isnull=True
    )
    if groups is not None:
        links = links.filter(pk__in=[g.pk for g in groups])
    links = list(links.select_related("classroom").order_by("pk"))
    starts = [d for d in (_course_start(link) for link in links) if d]
    first = min(starts) if starts else until - timedelta(days=HISTORY_WINDOW_DAYS - 1)
    # All groups in one read, or — narrowed — each group on its own (lc-up filters by ``group_id``).
    scopes = [{}] if groups is None else [{"group_id": link.lcup_group_id} for link in links]
    rows = []
    for scope in scopes:
        lo = first
        while lo <= until:
            hi = min(lo + timedelta(days=HISTORY_WINDOW_DAYS - 1), until)
            params = {**scope, "from": lo.isoformat(), "to": hi.isoformat(), "include_deleted": "true"}
            rows += client.fetch_all(ATTENDANCE_PATH, params)
            lo = hi + timedelta(days=1)
    by_group_day = defaultdict(list)
    for r in rows:
        by_group_day[(r.get("group_id"), str(r.get("date") or "")[:10])].append(r)

    counts, touched = Counter(), set()
    # Quiet: months of old lessons copied in one go must not ring each student's bell once per
    # lesson ("you earned 5 points" for July). The ledger is written all the same.
    with quiet_delivery(), transaction.atomic():
        xp_before = _attendance_xp()
        with strikes.deferred() as pending:
            for link in links:
                days = sorted(d for (g, d) in by_group_day if g == link.lcup_group_id)
                for day_text in days:
                    day = date.fromisoformat(day_text)
                    if day < first or day > until:
                        continue
                    plan = plan_day(link, day, by_group_day[(link.lcup_group_id, day_text)], gap_fill=False)
                    counts.update(apply_day(plan))
                    pending.update(plan.delete)  # a delete fires no strike hook
                    touched |= set(plan.mirror) | plan.delete
            for record in AttendanceRecord.objects.filter(
                session__classroom__in=[link.classroom for link in links], session__date__range=(first, until)
            ).select_related("session", "student"):
                sync_attendance_record(record)
        report = {
            "dry_run": dry_run,
            "groups": len(links),
            "from": first.isoformat(),
            "until": until.isoformat(),
            "lcup_rows": len(rows),
            "counts": dict(counts),
            "students_touched": len(touched),
            "xp_before": xp_before,
            "xp_after": _attendance_xp(),
        }
        if dry_run:
            transaction.set_rollback(True)
    return report
