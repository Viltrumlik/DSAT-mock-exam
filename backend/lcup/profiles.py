"""lc-up's name and phone on the learner accounts linked to it (owner, 2026-10-28: "studentlarni
ma'lumotlari lc-upda o'zgarsa bizdayam o'zgarishi kerak" — and, asked how far, "To'liq lc-up bo'yicha").

A linked learner's first name, last name and phone are lc-up's. Every sync sets them to what lc-up
holds now, and neither the learner nor an admin edits them here (``locked_fields``) — an edit would
be undone 15 minutes later. On 2026-10-28, 108 of 239 linked names and 121 phones differed.

* **The name** is split the way accounts are made (``split_lcup_name``: lc-up has no fixed order).
  A part lc-up leaves too short for a complete profile (one word, an initial) is left as ours and
  stays editable: locking it would trap the learner behind the profile-completion gate.
* **The phone** is lc-up's normalised form ("998901234567"). Ours is unique, so a phone another
  account already holds is left alone and listed (``phone_conflicts``) for an admin — usually
  siblings on one parent's number, or a second account of the same learner.
* **The login follows the phone** on an account whose username IS its phone (every account lc-up
  made): a learner types their phone to sign in, and it is the new one now. Its open first-sign-in
  claim (phone + last four digits) moves with it.

Each change is one ``lcup_profile_sync`` event on the account, old and new values, for its History.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from django.db import transaction

from access import constants as acc_const
from users.models import User
from users.profile_completeness import MIN_IDENTITY_LEN
from users.security_audit import log_security_event

from .conf import profile_sync_enabled
from .matching import phone_owners
from .models import AccountClaim, LcupStudentLink, LinkStatus
from .phones import normalize_phone, split_lcup_name

#: The links whose account is lc-up's student: matched, confirmed by a person, or made by the sync.
LINKED = (LinkStatus.AUTO, LinkStatus.CONFIRMED, LinkStatus.CREATED)
#: What lc-up decides on such an account.
FIELDS = ("first_name", "last_name", "phone_number")
EVENT = "lcup_profile_sync"


def _usable(value: str) -> bool:
    return len((value or "").strip()) >= MIN_IDENTITY_LEN


def mirrored_links():
    return (
        LcupStudentLink.objects.filter(
            status__in=LINKED, user__isnull=False, deleted_in_lcup=False, user__role__in=acc_const.LEARNER_ROLES
        )
        .select_related("user")
        .order_by("pk")
    )


@dataclass
class Change:
    link: LcupStudentLink
    #: field → (ours now, lc-up's): what this run sets.
    fields: dict = field(default_factory=dict)
    #: Other accounts that already hold lc-up's phone, so it is not set.
    phone_taken_by: list = field(default_factory=list)


def plan(link) -> Change:
    """What it takes for ``link``'s account to carry lc-up's name and phone. Reads only."""
    user, change = link.user, Change(link=link)
    first, last = split_lcup_name(link.name)
    for name, theirs in (("first_name", first), ("last_name", last)):
        if _usable(theirs) and (getattr(user, name) or "") != theirs:
            change.fields[name] = (getattr(user, name) or "", theirs)
    phone, ours = link.phone, normalize_phone(user.phone_number)
    if phone and ours != phone:
        change.phone_taken_by = [u.pk for u in phone_owners(User.objects.exclude(pk=user.pk), phone)]
        if not change.phone_taken_by:
            change.fields["phone_number"] = (user.phone_number or "", phone)
            # The login a learner types is their phone; on an account named after it, it follows.
            if ours and user.username == ours and not User.objects.filter(username=phone).exclude(pk=user.pk).exists():
                change.fields["username"] = (user.username, phone)
    return change


def _apply(change: Change) -> None:
    user = change.link.user
    for name, (_, theirs) in change.fields.items():
        setattr(user, name, theirs)
    with transaction.atomic():
        user.save(update_fields=list(change.fields))
        if "phone_number" in change.fields:
            # An unused first-sign-in code is the phone's last four digits: it follows the phone.
            AccountClaim.objects.filter(user=user, password_set_at__isnull=True).update(phone=change.fields["phone_number"][1])
        log_security_event(
            user_id=user.pk,
            event_type=EVENT,
            detail={"lcup_student_id": change.link.lcup_student_id, "changes": {k: list(v) for k, v in change.fields.items()}},
        )


def apply(run) -> None:
    """The sync stage: every linked learner gets lc-up's name and phone. Off until the switch is on."""
    if not profile_sync_enabled():
        return
    for link in mirrored_links():
        change = plan(link)
        if change.phone_taken_by:
            run.counts["profile_phone_taken"] += 1
        if not change.fields:
            continue
        _apply(change)
        run.counts["profile_updated"] += 1
        for name in change.fields:
            run.counts[f"profile_{name}"] += 1


def phone_conflicts() -> list[dict]:
    """Linked learners whose lc-up phone another account already holds — for an admin to settle."""
    out = []
    for link in mirrored_links().exclude(phone=""):
        if normalize_phone(link.user.phone_number) == link.phone:
            continue
        taken = phone_owners(User.objects.exclude(pk=link.user_id), link.phone)
        if taken:
            out.append(
                {
                    "user_id": link.user_id,
                    "name": f"{link.user.first_name} {link.user.last_name}".strip() or link.user.username,
                    "role": link.user.role,
                    "lcup_name": link.name.strip(),
                    "held_by": [
                        {"id": u.pk, "name": f"{u.first_name} {u.last_name}".strip() or u.username, "role": u.role}
                        for u in taken
                    ],
                }
            )
    return out


def locked_fields(user) -> list[str]:
    """The profile fields lc-up decides for ``user`` — shown, never edited here. A part lc-up leaves
    too short stays ours to fill in, and a phone is lc-up's only once it is the one lc-up has (a
    phone another account holds stays editable here)."""
    if user is None or not getattr(user, "pk", None) or not profile_sync_enabled():
        return []
    if user.role not in acc_const.LEARNER_ROLES:
        return []
    link = LcupStudentLink.objects.filter(user=user, status__in=LINKED, deleted_in_lcup=False).first()
    if link is None:
        return []
    first, last = split_lcup_name(link.name)
    out = [name for name, theirs in (("first_name", first), ("last_name", last)) if _usable(theirs)]
    if link.phone and normalize_phone(user.phone_number) == link.phone:
        out.append("phone_number")
    return out
