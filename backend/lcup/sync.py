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

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from access import constants as acc_const
from classes.models import Branch, ClassroomMembership

from .accounts import create_account_for
from .classrooms import branch_for, create_classroom_for, teachers_for
from .client import LcupAuthError
from .matching import SUPPORTER_REASON, match_student, match_supporter, match_teacher, suggest_classroom
from .models import (
    GroupLinkStatus,
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
    def __init__(self, now):
        self.now = now
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
        if link.status == LinkStatus.IGNORED and link.match_reason == SUPPORTER_REASON:
            # lc-up made them an ordinary teacher again: match them afresh.
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


def _groups(client, run: _Run) -> None:
    rows = client.fetch_all(f"{API}/groups", {"include_deleted": "true"})
    taken = set(LcupGroupLink.objects.filter(classroom__isnull=False).values_list("classroom_id", flat=True))

    for row in rows:
        link, _ = LcupGroupLink.objects.get_or_create(lcup_group_id=row["id"], defaults={"name": (row.get("name") or "")[:200]})
        link.name = (row.get("name") or "")[:200]
        link.snapshot = row
        link.last_seen_at = run.now
        if row.get("deleted_at"):
            if link.deleted_in_lcup_at is None:
                link.deleted_in_lcup_at = run.now
                # Only a paired group's deletion means anything here; lc-up keeps years of old ones.
                if link.classroom_id:
                    run.alerts.append(
                        f"lc-up group deleted: {link.name}; its class {link.classroom.name} no longer follows lc-up"
                    )
            link.save()
            continue
        link.deleted_in_lcup_at = None
        link.save()
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
    for link in LcupStudentLink.objects.filter(pk__in=live_student_ids(), status=LinkStatus.UNMATCHED, user__isnull=True):
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
    _memberships(client, run)
    _stage(run, "match_students", lambda: _match_students(run))
    _stage(run, "accounts", lambda: _accounts(run))
    _stage(run, "rosters", lambda: _rosters(run))


def run_sync(client, *, dry_run: bool = False, now=None) -> LcupSyncRun:
    started = timezone.now()
    run = _Run(now or started)
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
