"""A student with several same-name accounts picks the one lc-up is linked to, by typing their phone.

The owner (2026-10-14): "duplicate ism familiyali o'quvchilarga forma jo'nating ular qaysi accountidan
kirib o'shandan o'zlarini nomerlarini yozsa shu account ularning main accounti bo'ladi qolgan
o'quvchiga tegmay qo'yavering."

* **Who is asked** — active students whose first and last name, as a set of words, belong to two or
  more such accounts, exactly one of which holds a live lc-up link with a phone. Nobody else: a
  group with no link, or with two (namesakes who are both centre students), is the admin's.
  ``create_prompts`` writes one ``LcupPhonePrompt`` per account, after the owner saw the report.
* **The question** — a pending prompt adds ``"lcup_phone"`` to ``missing_fields``, so the blocking
  completion gate asks it, after a first password and before names.
* **The answer** — the number lc-up holds for that student, typed on any of their accounts, makes
  that account the linked one; every other prompt of the student is superseded. A wrong number
  gets the last two digits as a hint (the administrator often wrote a parent's number), and after
  ``MAX_PHONE_ATTEMPTS`` the student is sent to the administrator. A namesake says "not me".
* **What follows** — ``follow_link`` (run by ``tasks.follow_student``): the roster seats the new
  account and the old one leaves as unlinked, then lc-up's attendance is copied for the student's
  groups, so the marks and their XP move with them. The other accounts are not closed.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass

from django.db import transaction
from django.db.models import F

from access import constants as acc_const
from users.models import User

from .models import GroupLinkStatus, LcupGroupLink, LcupPhonePrompt, LcupStudentLink, LinkStatus
from .phones import name_tokens, normalize_phone

MAX_PHONE_ATTEMPTS = 10
REQUIREMENT = "lcup_phone"
CONFIRMED_REASON = "confirmed by the student's phone"

P = LcupPhonePrompt


# ── who is asked ──────────────────────────────────────────────────────────


def duplicate_groups() -> tuple[list[tuple[LcupStudentLink, list[User]]], int]:
    """Each lc-up student whose same-name accounts are to be asked, with those accounts; and how
    many same-name groups were left to the admin (two links, or a link with no phone)."""
    by_name: dict[frozenset, list[User]] = defaultdict(list)
    for user in User.objects.filter(role=acc_const.ROLE_STUDENT, is_active=True).order_by("pk"):
        key = name_tokens(f"{user.first_name} {user.last_name}")
        if len(key) >= 2:
            by_name[key].append(user)
    held = {link.user_id: link for link in LcupStudentLink.objects.filter(user__isnull=False, deleted_in_lcup=False)}
    groups, skipped = [], 0
    for users in by_name.values():
        links = [held[u.pk] for u in users if u.pk in held]
        if len(users) < 2 or not links:
            continue
        if len(links) > 1 or not normalize_phone(links[0].phone):
            skipped += 1
            continue
        groups.append((links[0], users))
    groups.sort(key=lambda g: g[0].lcup_student_id)
    return groups, skipped


def create_prompts(*, dry_run: bool = False) -> dict:
    groups, skipped = duplicate_groups()
    created = 0
    detail = []
    for link, users in groups:
        if not dry_run:
            for user in users:
                created += P.objects.get_or_create(user=user, defaults={"student": link})[1]
        detail.append({
            "lcup_student_id": link.lcup_student_id,
            "lcup_name": link.name,
            "accounts": [
                {"id": u.pk, "username": u.username, "name": f"{u.first_name} {u.last_name}".strip(), "linked": u.pk == link.user_id}
                for u in users
            ],
        })
    return {
        "dry_run": dry_run,
        "groups": len(groups),
        "accounts": sum(len(users) for _, users in groups),
        "created": created,
        "skipped": skipped,
        "detail": detail,
    }


def prompt_status() -> dict:
    return dict(Counter(P.objects.values_list("state", flat=True)))


# ── the question ──────────────────────────────────────────────────────────


def phone_requirement(user) -> list[str]:
    if user is None or not getattr(user, "pk", None) or getattr(user, "role", None) != acc_const.ROLE_STUDENT:
        return []
    return [REQUIREMENT] if P.objects.filter(user_id=user.pk, state=P.PENDING).exists() else []


# ── the answer ────────────────────────────────────────────────────────────


@dataclass
class PhoneRefused(Exception):
    status: int
    detail: str
    hint: str | None = None


NOTHING_TO_CONFIRM = "Bu akkauntda tasdiqlanadigan raqam yo'q."


def _pending(user):
    return P.objects.filter(user_id=user.pk, state=P.PENDING).select_related("student").first()


def supersede_prompts(link, *, now, keep=None) -> int:
    """The student has settled on an account: no other of their accounts is asked any more."""
    return P.objects.filter(student=link, state=P.PENDING).exclude(pk=keep).update(state=P.SUPERSEDED, resolved_at=now)


def confirm_phone(user, raw, *, now) -> bool:
    """Make ``user`` the account lc-up is linked to, if ``raw`` is the student's lc-up number.
    Returns whether the link moved; refusals raise ``PhoneRefused``."""
    prompt = _pending(user)
    if prompt is None:
        raise PhoneRefused(403, NOTHING_TO_CONFIRM)
    if prompt.failed_attempts >= MAX_PHONE_ATTEMPTS:
        raise PhoneRefused(429, "Urinishlar juda ko'p bo'ldi. Administratorga murojaat qiling.")
    phone = normalize_phone(raw)
    if phone is None:
        raise PhoneRefused(400, "Raqamni to'liq kiriting, masalan: +998 90 123 45 67.")
    lcup_phone = normalize_phone(prompt.student.phone)
    if phone != lcup_phone:
        # F(): two wrong numbers sent at once both count.
        P.objects.filter(pk=prompt.pk).update(failed_attempts=F("failed_attempts") + 1)
        hint = (lcup_phone or "")[-2:]
        raise PhoneRefused(
            400, f"Bu raqam administratordagi raqamga mos kelmadi. Administratordagi raqam ••{hint} bilan tugaydi.", hint
        )

    from . import tasks

    with transaction.atomic():
        link = LcupStudentLink.objects.select_for_update().get(pk=prompt.student_id)
        moved = link.user_id != user.pk
        if moved and LcupStudentLink.objects.filter(user_id=user.pk).exclude(pk=link.pk).exists():
            raise PhoneRefused(409, "Bu akkaunt boshqa o'quvchiga bog'langan. Administratorga murojaat qiling.")
        link.user_id = user.pk
        link.status = LinkStatus.CONFIRMED
        link.match_reason = CONFIRMED_REASON
        link.save(update_fields=["user", "status", "match_reason"])
        P.objects.filter(pk=prompt.pk).update(state=P.CONFIRMED, resolved_at=now)
        supersede_prompts(link, now=now, keep=prompt.pk)
        if moved:
            transaction.on_commit(lambda: tasks.follow_student.delay(link.pk))
    return moved


def dismiss_prompt(user, *, now) -> bool:
    """A namesake: another person with the same name. Their form goes; nothing moves."""
    return bool(P.objects.filter(user_id=user.pk, state=P.PENDING).update(state=P.NOT_ME, resolved_at=now))


# ── what follows ──────────────────────────────────────────────────────────


def follow_link(client, link, *, until) -> dict:
    """Seat ``link.user`` in the student's paired groups (the old account leaves as unlinked), then
    copy lc-up's attendance for those groups up to ``until``, so the marks and their XP follow.

    Never past the push cutover: history mode deletes a mark lc-up lacks, and from the cutover on a
    mark only we have is the push's to send, not this copy's to delete. Those days are the regular
    sync's (it reads the last few days with the link as it now is)."""
    from datetime import timedelta

    from .attendance import import_history
    from .conf import attendance_pull_enabled, attendance_push_enabled, attendance_push_from
    from .roster import apply_plan, plan_group

    groups = list(
        LcupGroupLink.objects.filter(
            status=GroupLinkStatus.CONFIRMED, classroom__isnull=False, deleted_in_lcup_at__isnull=True,
            memberships__student=link, memberships__left_at__isnull=True,
        )
        .select_related("classroom")
        .distinct()
        .order_by("pk")
    )
    counts: Counter = Counter()
    for group in groups:
        counts.update(apply_plan(group, plan_group(group), allow_removals=False))
    if groups and attendance_pull_enabled():
        cutover = attendance_push_from() if attendance_push_enabled() else None
        last = min(until, cutover - timedelta(days=1)) if cutover else until
        counts.update(import_history(client, until=last, groups=groups)["counts"])
    return dict(counts)
