"""One sync run: read lc-up, update the links, apply rosters.

Stages run in order and each in its own savepoint, so one failing stage — lc-up down for one
endpoint, a bad row — is recorded on the run and the others still happen. A login refusal is the
exception: nothing can work without it, so it stops the run.

**Nothing is removed on incomplete data.** A group whose member list failed to load, or came back
empty while we know it has members, is left exactly as it was; removals are capped per class
(``roster``) and per run (``MAX_REMOVALS_PER_RUN``). What is held is reported as an alert.

**Nothing is created before the initial review.** Accounts and classes for unpaired groups wait
until the admin has linked the people and classes that already exist — otherwise the first sync
would create a second account for every student whose phone we did not have, and a second class
for every class whose name did not match.

``dry_run`` does everything inside a transaction that is rolled back, then records the run.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from access import constants as acc_const
from classes.models import Branch, Classroom, ClassroomMembership

from . import audience, finance
from .accounts import create_account_for, create_teacher_account_for
from .attendance import apply_day, plan_day, push_day, push_held_reason
from .classrooms import branch_for, create_classroom_for, teachers_for
from .client import LcupAuthError
from .conf import attendance_pull_enabled, attendance_push_enabled, attendance_push_from
from .follow import archive_class, follow_details, follow_teachers, reopen_class
from .matching import SUPPORTER_REASON, match_student, match_supporter, match_teacher, subject_from, suggest_classroom
from .models import (
    GroupLinkStatus,
    LcupAbsenceReason,
    LcupAttendancePush,
    LcupFilialLink,
    LcupGroupLink,
    LcupMembership,
    LcupState,
    LcupStudentLink,
    LcupSyncRun,
    LcupTeacherLink,
    LinkStatus,
)
from .phones import normalize_phone
from .roster import MAX_REMOVALS_PER_RUN, apply_plan, plan_group

log = logging.getLogger("lcup")

API = "/api/external/v1"

#: Links a run leaves alone: a person decided them, or the account was ours to make.
_SETTLED = (LinkStatus.CONFIRMED, LinkStatus.IGNORED, LinkStatus.CREATED)


class _Run:
    def __init__(self, now, *, dry_run: bool = False):
        self.now = now
        #: A dry run is rolled back afterwards — but a POST to lc-up cannot be, so nothing that
        #: sends may run when this is set (see ``_attendance``).
        self.dry_run = dry_run
        self.counts: defaultdict[str, int] = defaultdict(int)
        self.errors: list[dict] = []
        self.alerts: list[str] = []
        self.skipped_groups: set[int] = set()
        self.review_done = bool(LcupState.get().initial_review_done_at)

    def error(self, stage: str, exc: Exception) -> None:
        log.warning("lc-up sync: %s failed: %s", stage, type(exc).__name__)
        self.errors.append({"stage": stage, "error": f"{type(exc).__name__}: {exc}"[:500]})


def _stage(run: _Run, name: str, fn) -> None:
    try:
        with transaction.atomic():
            fn()
    except LcupAuthError:
        raise
    except Exception as exc:  # one stage failing must not stop the others
        run.error(name, exc)


def _aware(value):
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        return None
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def _apply_match(link, result, run: _Run, kind: str) -> None:
    link.user_id = result.user_id
    link.status = result.status
    link.match_reason = result.reason
    link.candidates = result.candidates
    link.save(update_fields=["user", "status", "match_reason", "candidates"])
    if result.status == LinkStatus.AUTO:
        run.counts[f"{kind}_auto_linked"] += 1
    elif result.status == LinkStatus.NEEDS_REVIEW:
        run.counts[f"{kind}_needs_review"] += 1
    elif result.status == LinkStatus.UNMATCHED:
        run.counts[f"{kind}_unmatched"] += 1


# ── stages ────────────────────────────────────────────────────────────────


def _filials(client, run: _Run) -> None:
    rows = client.get(f"{API}/filials").get("data") or []
    for row in rows:
        link, _ = LcupFilialLink.objects.update_or_create(
            lcup_filial_id=row["id"], defaults={"name": (row.get("name") or "")[:200], "last_seen_at": run.now}
        )
        if link.branch_id is None:
            same_name = list(Branch.objects.filter(name__iexact=(row.get("name") or "").strip())[:2])
            if len(same_name) == 1:
                link.branch = same_name[0]
                link.save(update_fields=["branch"])
    run.counts["filials"] = len(rows)


def _teachers(client, run: _Run) -> None:
    rows = client.fetch_all(f"{API}/teachers", {"include_deleted": "true"})
    for row in rows:
        link, _ = LcupTeacherLink.objects.update_or_create(
            lcup_teacher_id=row["id"],
            defaults={
                "name": (row.get("name") or "")[:200],
                "phone": normalize_phone(row.get("phone")) or "",
                "deleted_in_lcup": bool(row.get("deleted_at")),
                "last_seen_at": run.now,
            },
        )
        if _is_supporter(row):
            _settle_supporter(link)
            run.counts["teachers_support"] += 1
            continue
        if link.status == LinkStatus.IGNORED and link.match_reason == SUPPORTER_REASON and "is_supporter" in row:
            # lc-up says outright they are an ordinary teacher again: match them afresh. A row that
            # carries no flag at all (the External API leaves it out) is no news: the admin's
            # "support teacher" stands.
            link.status, link.match_reason, link.user = LinkStatus.UNMATCHED, "", None
        if link.status in _SETTLED or (link.status == LinkStatus.AUTO and link.user_id):
            continue
        _apply_match(link, match_teacher(link), run, "teachers")
    run.counts["teachers"] = len(rows)


def _is_supporter(row) -> bool:
    return row.get("is_supporter") in (True, 1, "1", "true", "True")


def _settle_supporter(link) -> None:
    """A support teacher is no lc-up group teacher: settle the link as ignored, on our support
    teacher account when one is found (or already linked), never on a teacher's."""
    user = link.user if link.user is not None and link.user.role == acc_const.ROLE_SUPPORT_TEACHER else match_supporter(link)
    if link.status == LinkStatus.IGNORED and link.match_reason == SUPPORTER_REASON and link.user_id == getattr(user, "pk", None):
        return
    link.user = user
    link.status = LinkStatus.IGNORED
    link.match_reason = SUPPORTER_REASON
    link.candidates = []
    link.save(update_fields=["user", "status", "match_reason", "candidates"])


def _teacher_accounts(row, run: _Run) -> None:
    """An account for each teacher of this live group whom nothing matched (owner, 2026-10-13).
    The group gives the account its subject; a deleted lc-up teacher — lc-up leaves them on their
    old groups — and anyone already linked, ignored or in review is left alone."""
    subject = {Classroom.SUBJECT_MATH: acc_const.DOMAIN_MATH, Classroom.SUBJECT_ENGLISH: acc_const.DOMAIN_ENGLISH}.get(
        subject_from(row)
    )
    lcup_ids = [t.get("id") for t in row.get("teachers") or [] if t.get("id") is not None]
    if subject is None or not lcup_ids:
        return
    pending = LcupTeacherLink.objects.filter(
        lcup_teacher_id__in=lcup_ids, status=LinkStatus.UNMATCHED, user__isnull=True, deleted_in_lcup=False
    )
    for link in pending:
        if create_teacher_account_for(link, subject=subject, now=run.now):
            run.counts["teacher_accounts_created"] += 1
            run.alerts.append(f"teacher account created for {link.name.strip()}")
        else:
            run.counts["teachers_needs_review"] += 1


def _groups(client, run: _Run) -> None:
    rows = client.fetch_all(f"{API}/groups", {"include_deleted": "true"})
    taken = set(LcupGroupLink.objects.filter(classroom__isnull=False).values_list("classroom_id", flat=True))

    for row in rows:
        link, _ = LcupGroupLink.objects.get_or_create(lcup_group_id=row["id"], defaults={"name": (row.get("name") or "")[:200]})
        # What lc-up said last run: the paired class follows what changed since (follow.py).
        previous = link.snapshot or {}
        was_deleted = link.deleted_in_lcup_at is not None
        paired = bool(link.classroom_id) and link.status == GroupLinkStatus.CONFIRMED
        link.name = (row.get("name") or "")[:200]
        link.snapshot = row
        link.last_seen_at = run.now
        if row.get("deleted_at"):
            if not was_deleted:
                link.deleted_in_lcup_at = run.now
                # Only a paired group's deletion means anything here; lc-up keeps years of old ones.
                if paired and archive_class(link, run.now, run.alerts):
                    run.counts["classes_archived"] += 1
            link.save()
            continue
        link.deleted_in_lcup_at = None
        if was_deleted and paired and reopen_class(link, run.alerts):
            run.counts["classes_restored"] += 1
        link.save()
        if run.review_done and link.status != GroupLinkStatus.IGNORED:
            # Before teachers_for(row): a new group with a new teacher gets its class this run.
            _teacher_accounts(row, run)
        if paired:
            run.counts["classes_updated"] += int(bool(follow_details(link.classroom, previous, row, run.alerts)))
            for key, n in follow_teachers(link, previous, row, run.alerts).items():
                run.counts[key] += n
            continue
        if link.classroom_id or link.status not in (GroupLinkStatus.SUGGESTED, GroupLinkStatus.NEEDS_TEACHER):
            continue

        teachers = teachers_for(row)
        branch = branch_for(row)
        suggestion = suggest_classroom(
            row,
            teacher_user_ids={t.pk for t in teachers},
            branch_id=branch.pk if branch else None,
            taken_classroom_ids=taken,
        )
        link.suggestion_id = suggestion.classroom_id
        link.suggestion_score = suggestion.score
        link.suggestion_reasons = suggestion.reasons
        if suggestion.classroom_id:
            link.status = GroupLinkStatus.SUGGESTED
        elif not teachers:
            link.status = GroupLinkStatus.NEEDS_TEACHER
        elif not run.review_done:
            link.status = GroupLinkStatus.SUGGESTED
            link.suggestion_reasons = ["no matching class; one is created after the initial review"]
        else:
            try:
                room = create_classroom_for(link, teacher_users=teachers, branch=branch)
            except ValueError as exc:
                link.status = GroupLinkStatus.SUGGESTED
                link.suggestion_reasons = [str(exc)]
                run.alerts.append(f"cannot create a class for lc-up group {link.name}: {exc}")
            else:
                taken.add(room.pk)
                run.counts["classes_created"] += 1
                run.alerts.append(f"class created for lc-up group {link.name}")
                continue  # create_classroom_for saved the link
        link.save(update_fields=["suggestion", "suggestion_score", "suggestion_reasons", "status"])
    run.counts["groups"] = len(rows)
    # What a dry run can only report through its counts: where every live group stands.
    live = LcupGroupLink.objects.filter(
        lcup_group_id__in=[row["id"] for row in rows if not row.get("deleted_at")], deleted_in_lcup_at__isnull=True
    )
    run.counts["groups_live"] = live.count()
    for status, n in Counter(live.values_list("status", flat=True)).items():
        run.counts[f"groups_{status}"] = n
    run.counts["groups_new_class_after_review"] = live.filter(
        status=GroupLinkStatus.SUGGESTED, suggestion__isnull=True, classroom__isnull=True
    ).count()


def _money(value) -> Decimal | None:
    """lc-up's balance as a Decimal; None when it is missing or not a number (unknown ≠ 0)."""
    if value is None or str(value).strip() == "":
        return None
    try:
        amount = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    return amount if amount.is_finite() else None


def _students(client, run: _Run) -> None:
    rows = client.fetch_all(f"{API}/students")
    seen = []
    for row in rows:
        LcupStudentLink.objects.update_or_create(
            lcup_student_id=row["id"],
            defaults={
                "name": (row.get("name") or "")[:200],
                "phone": normalize_phone(row.get("phone")) or "",
                "lcup_filial_id": row.get("filial_id"),
                "deleted_in_lcup": False,
                "last_seen_at": run.now,
                "balance": _money(row.get("balance")),
                "balance_seen_at": run.now,
            },
        )
        seen.append(row["id"])
    # The list is complete (fetch_all raises otherwise): anyone missing is archived in lc-up.
    LcupStudentLink.objects.exclude(lcup_student_id__in=seen).update(deleted_in_lcup=True)
    run.counts["students"] = len(rows)


def _members_of(client, link, run: _Run, students: dict) -> None:
    rows = client.get(f"{API}/groups/{link.lcup_group_id}/students", {"include_left": "true"}).get("data") or []
    if not rows and LcupMembership.objects.filter(group=link, left_at__isnull=True).exists():
        run.skipped_groups.add(link.pk)
        run.alerts.append(f"lc-up returned no members for {link.name}; kept as it was")
        return
    seen = set()
    for row in rows:
        lcup_id = row.get("student_id")
        if lcup_id is None:
            continue
        student = students.get(lcup_id)
        if student is None:
            student = LcupStudentLink.objects.create(
                lcup_student_id=lcup_id,
                name=(row.get("name") or "")[:200],
                phone=normalize_phone(row.get("phone")) or "",
                last_seen_at=run.now,
            )
            students[lcup_id] = student
        LcupMembership.objects.update_or_create(
            group=link,
            student=student,
            defaults={
                "lcup_status": (row.get("status") or "")[:10],
                "start_date": parse_date(str(row["start_date"])) if row.get("start_date") else None,
                "joined_at": _aware(row.get("joined_at")),
                "left_at": _aware(row.get("left_at")),
            },
        )
        seen.add(student.pk)
    # Someone lc-up no longer lists at all (not even as having left) has left.
    LcupMembership.objects.filter(group=link, left_at__isnull=True).exclude(student_id__in=seen).update(left_at=run.now)


def _memberships(client, run: _Run) -> None:
    students = {s.lcup_student_id: s for s in LcupStudentLink.objects.all()}
    live = LcupGroupLink.objects.exclude(status=GroupLinkStatus.IGNORED).filter(deleted_in_lcup_at__isnull=True)
    for link in live:
        try:
            with transaction.atomic():
                _members_of(client, link, run, students)
        except LcupAuthError:
            raise
        except Exception as exc:
            run.skipped_groups.add(link.pk)
            run.error(f"members:{link.lcup_group_id}", exc)


def live_student_ids() -> set[int]:
    return set(
        LcupMembership.objects.filter(left_at__isnull=True, group__deleted_in_lcup_at__isnull=True)
        .exclude(group__status=GroupLinkStatus.IGNORED)
        .values_list("student_id", flat=True)
    )


def _match_students(run: _Run) -> None:
    phones = Counter(LcupStudentLink.objects.exclude(phone="").values_list("phone", flat=True))
    shared = {phone for phone, n in phones.items() if n >= 2}
    pending = (
        LcupStudentLink.objects.filter(pk__in=live_student_ids())
        .exclude(status__in=_SETTLED)
        .exclude(status=LinkStatus.AUTO, user__isnull=False)
    )
    for link in pending:
        rooms = LcupGroupLink.objects.filter(
            memberships__student=link, status=GroupLinkStatus.CONFIRMED, classroom__isnull=False
        ).values_list("classroom_id", flat=True)
        class_user_ids = set(
            ClassroomMembership.objects.filter(classroom_id__in=list(rooms), role=ClassroomMembership.ROLE_STUDENT)
            .exclude(status=ClassroomMembership.STATUS_REMOVED)
            .values_list("user_id", flat=True)
        )
        _apply_match(link, match_student(link, shared_phones=shared, class_user_ids=class_user_ids), run, "students")


def _accounts(run: _Run) -> None:
    if not run.review_done:
        return
    # Matching no longer runs after the review, so its shared-phone rule lives here too:
    # siblings on one parent's phone are never auto-created, they wait for the admin.
    phones = Counter(LcupStudentLink.objects.exclude(phone="").values_list("phone", flat=True))
    for link in LcupStudentLink.objects.filter(pk__in=live_student_ids(), status=LinkStatus.UNMATCHED, user__isnull=True):
        if phones[link.phone] >= 2:
            link.status = LinkStatus.NEEDS_REVIEW
            link.match_reason = "phone shared by several lc-up students"
            link.save(update_fields=["status", "match_reason"])
            run.counts["students_needs_review"] += 1
            continue
        if create_account_for(link, now=run.now):
            run.counts["accounts_created"] += 1


def _rosters(run: _Run) -> None:
    links = (
        LcupGroupLink.objects.filter(status=GroupLinkStatus.CONFIRMED, classroom__isnull=False, deleted_in_lcup_at__isnull=True)
        .exclude(pk__in=run.skipped_groups)
        .select_related("classroom")
    )
    plans = [(link, plan_group(link)) for link in links]
    total = sum(len(plan.to_remove) for _, plan in plans if not plan.blocked_removals)
    allow = total <= MAX_REMOVALS_PER_RUN
    if not allow:
        run.alerts.append(f"removals held: {total} > {MAX_REMOVALS_PER_RUN} in one run")
        run.counts["removals_held"] += total
    for link, plan in plans:
        if plan.blocked_removals:
            run.alerts.append(f"removals held for {link.classroom.name}: {len(plan.to_remove)} at once")
            run.counts["removals_held"] += len(plan.to_remove)
        for key, value in apply_plan(link, plan, allow_removals=allow).items():
            run.counts[key] += value


def _run_stages(client, run: _Run) -> None:
    _stage(run, "filials", lambda: _filials(client, run))
    _stage(run, "teachers", lambda: _teachers(client, run))
    _stage(run, "groups", lambda: _groups(client, run))
    _stage(run, "students", lambda: _students(client, run))
    _stage(run, "payments", lambda: finance.sync_payments(client, run))
    _memberships(client, run)
    if not run.review_done:
        # Afterwards a new lc-up student always gets a new account, even if an old one of
        # theirs exists (owner, 2026-10-13); matching would hand them the old one.
        _stage(run, "match_students", lambda: _match_students(run))
    _stage(run, "accounts", lambda: _accounts(run))
    _stage(run, "rosters", lambda: _rosters(run))
    # After rosters: the seat rule reads this run's seats — the roster adding a returning student
    # makes them a student again, and one it took out of their last class becomes public.
    _stage(run, "audience", lambda: audience.apply(run))
    # After the balances (students) and the roles (audience): an unpaid month freezes, a paid one lifts.
    _stage(run, "debt_freeze", lambda: finance.apply_freeze(run))
    _stage(run, "reasons", lambda: _reasons(client, run))
    # After rosters, so a mark lands on the class as lc-up now has it. One atomic block per
    # register inside, and the push after its block commits — not one stage-wide savepoint.
    _attendance(client, run)


# ── attendance (lc-up Part 2) ─────────────────────────────────────────────

#: How many days back a run looks: a correction made in lc-up the next morning still arrives.
ATTENDANCE_LOOKBACK_DAYS = 3


def _reasons(client, run: _Run) -> None:
    rows = client.get(f"{API}/attendance/reasons").get("data") or []
    for r in rows:
        if r.get("id") is None:
            continue
        LcupAbsenceReason.objects.update_or_create(
            lcup_reason_id=r["id"],
            defaults={
                "title": str(r.get("title") or "").strip()[:120],
                "color": str(r.get("color") or "")[:20],
                "last_seen_at": run.now,
            },
        )
    run.counts["absence_reasons"] = len(rows)


def _attendance(client, run: _Run) -> None:
    """Closed registers of the last few days agree with lc-up; after the cutover, what lc-up lacks
    is sent once (``lcup.attendance``). A register still open is the teacher's and is not read."""
    from classes import attendance_window

    if not attendance_pull_enabled():
        return
    today = timezone.localdate(run.now)
    days = [today - timedelta(days=n) for n in range(ATTENDANCE_LOOKBACK_DAYS, -1, -1)]
    try:
        rows = client.fetch_all(
            f"{API}/attendance", {"from": days[0].isoformat(), "to": today.isoformat(), "include_deleted": "true"}
        )
    except LcupAuthError:
        raise
    except Exception as exc:
        run.error("attendance", exc)
        return
    by_group_day = defaultdict(list)
    for r in rows:
        by_group_day[(r.get("group_id"), str(r.get("date") or "")[:10])].append(r)

    push_on, push_from = attendance_push_enabled(), attendance_push_from()
    links = (
        LcupGroupLink.objects.filter(status=GroupLinkStatus.CONFIRMED, classroom__isnull=False, deleted_in_lcup_at__isnull=True)
        .exclude(pk__in=run.skipped_groups)
        .select_related("classroom")
    )
    for link in links:
        held = push_held_reason(link)
        for day in days:
            if attendance_window.marking_state(link.classroom, day, now=run.now) != attendance_window.STATE_LOCKED:
                continue
            gap_fill = bool(push_on and push_from and day >= push_from)
            try:
                with transaction.atomic():
                    plan = plan_day(link, day, by_group_day.get((link.lcup_group_id, day.isoformat()), []), gap_fill=gap_fill)
                    for key, value in apply_day(plan).items():
                        run.counts[key] += value
            except LcupAuthError:
                raise
            except Exception as exc:
                run.error(f"attendance:{link.lcup_group_id}:{day}", exc)
                continue
            if not plan.push:
                continue
            if held:
                run.alerts.append(held)
                continue
            if run.dry_run:
                run.counts["att_would_push"] += len(plan.push)
                continue
            _report_push(run, link, day, push_day(client, plan, now=run.now))


def _report_push(run: _Run, link, day, push) -> None:
    if push is None:
        return
    where = f"{link.name} {day.isoformat()}"
    if push.state == LcupAttendancePush.STATE_SENT:
        run.counts["att_pushed"] += len(push.records) - len(push.failures)
        if push.failures:
            codes = ", ".join(sorted({f["code"] or "unknown" for f in push.failures}))
            run.alerts.append(f"lc-up did not take {len(push.failures)} attendance mark(s) for {where}: {codes}")
    elif push.state == LcupAttendancePush.STATE_REFUSED:
        run.alerts.append(f"lc-up refused attendance for {where}: its attendance window is closed")
    else:
        run.alerts.append(f"attendance push for {where} failed (attempt {push.attempts}): {push.error}")


def run_sync(client, *, dry_run: bool = False, now=None) -> LcupSyncRun:
    started = timezone.now()
    run = _Run(now or started, dry_run=dry_run)
    try:
        if dry_run:
            with transaction.atomic():
                _run_stages(client, run)
                transaction.set_rollback(True)
        else:
            _run_stages(client, run)
    except LcupAuthError as exc:
        # Nothing can work without the login; the run still says so in /ops/lcup.
        log.error("lc-up refused the integration login; the sync stopped")
        run.error("login", exc)
    return LcupSyncRun.objects.create(
        started_at=started,
        finished_at=timezone.now(),
        dry_run=dry_run,
        ok=not run.errors,
        counts=dict(run.counts),
        errors=run.errors,
        alerts=run.alerts,
    )
