"""Who may be in a class Telegram group, and what the bot does about it.

The rule the school asked for, in one paragraph: a student joins the class group from the
classroom page, not from a link somebody forwarded them. They connect their Telegram to
their account once; after that the site mints them a single-use invite; when they walk
through it the bot checks the Telegram account that arrived is the one the invite was cut
for. If their account is later frozen they are taken out of the group — but they stay in the
class here, because being frozen is a pause, not an expulsion. When they are unfrozen
nothing happens automatically: they come back to the classroom page and press the button
again, and get a fresh link.

Two rules govern everything below, and both exist to make the automation safe to leave
running:

1. **The bot never removes anyone it cannot account for.** A Telegram account that matches
   no student here — a teacher's second account, a parent, the owner of the centre — is
   recorded and reported, never kicked. The one exception is someone who walked in on a
   ticket cut for a different person, which is the specific abuse this design exists to stop.
2. **The bot never removes a chat administrator.** Whatever the site believes, an admin of
   the group is somebody the school put there on purpose.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from notifications import constants as note_const
from notifications.services import notify

from . import telegram_group_api as api
from .models import Classroom, ClassroomMembership
from .models_telegram import ClassroomTelegramEvent, ClassroomTelegramMember

logger = logging.getLogger("classes.telegram_group")

User = get_user_model()

#: How long a minted link stays usable. Short by design — the link IS the credential, and a
#: credential that lives for a day is one a student can forward and forget. Thirty minutes is
#: long enough to open Telegram and press Join, short enough that a screenshot in a group
#: chat is worthless by the time anyone acts on it.
def invite_ttl_minutes() -> int:
    try:
        return max(5, int(getattr(settings, "CLASSROOM_TELEGRAM_INVITE_TTL_MINUTES", 30)))
    except (TypeError, ValueError):
        return 30


class TelegramGroupError(Exception):
    """Something the caller should show to a person, not log and swallow."""

    def __init__(self, code: str, message: str, *, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


# ── The rules the student is shown before they join ──────────────────────────
#
# Written out here rather than in the frontend so the site and the bot say the same thing.
# The third line is the one the school specifically asked to be stated up front: nobody
# should be surprised to find themselves outside the group.
JOIN_RULES = [
    "Connect your Telegram account to MasterSAT first — the invite is issued to that account and no other.",
    "Your invite link is personal and works once. Keep it to yourself: whoever opens it first uses it up.",
    "Join with the same Telegram account you connected. If anyone else opens your link they are taken back out, and you will need a new one.",
    "While your account is frozen you are out of the class group. You stay in the class here — your homework, points and results are exactly where you left them.",
    "As soon as your account is active again, come back to this page and press the button for a fresh link.",
    "If you move out of this class, you come out of its group too.",
]


def _friendly(res: api.TgResult) -> str:
    """Turn a Bot API failure into something a member of staff can act on."""
    desc = (res.description or "").lower()
    if res.is_forbidden or "bot is not a member" in desc or "bot was kicked" in desc:
        return "The bot is not in the class Telegram group. Add it to the group as an administrator."
    if "not enough rights" in desc or "chat_admin_required" in desc or "need administrator" in desc:
        return (
            "The bot is in the group but is not an administrator with permission to invite "
            "and remove members."
        )
    if "chat not found" in desc:
        return "That Telegram chat id does not exist, or the bot has never been added to it."
    if "user not found" in desc:
        return "Telegram does not recognise that account."
    return "Telegram could not complete the request. Try again in a moment."


# ── Configuration ────────────────────────────────────────────────────────────


def chat_id_for(classroom: Classroom) -> str:
    return str(getattr(classroom, "telegram_chat_id", "") or "").strip()


def is_managed(classroom: Classroom) -> bool:
    """True when this class's group is under the bot's control (rather than a bare link)."""
    return bool(chat_id_for(classroom)) and api.is_configured()


def bot_user_id() -> Optional[int]:
    """The bot's own Telegram id — the digits before the colon in its token.

    Read from the token rather than ``getMe`` because the sweep needs it on every pass and
    a network round trip to learn a constant is a round trip that can fail.
    """
    token = api.bot_token()
    head = token.split(":", 1)[0] if token else ""
    return int(head) if head.isdigit() else None


# ── Eligibility ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Eligibility:
    allowed: bool
    reason: str = ""
    #: What to tell the student. Empty when they are allowed.
    message: str = ""


def eligibility(user, classroom: Classroom) -> Eligibility:
    """May this account be in this class's Telegram group right now?"""
    if user is None:
        return Eligibility(False, ClassroomTelegramMember.REASON_NOT_IN_CLASS, "Unknown account.")

    role = str(getattr(user, "role", "") or "").strip().lower()
    if role == "student" and getattr(user, "is_frozen", False):
        return Eligibility(
            False,
            ClassroomTelegramMember.REASON_FROZEN,
            "While your account is frozen you cannot join the class Telegram group. You are "
            "still in the class — speak to the front desk, and once your account is active "
            "again come back here and join.",
        )

    membership = ClassroomMembership.objects.filter(classroom=classroom, user=user).first()
    if membership is None or membership.status == ClassroomMembership.STATUS_REMOVED:
        return Eligibility(
            False,
            ClassroomTelegramMember.REASON_NOT_IN_CLASS,
            "You are not a member of this class.",
        )
    return Eligibility(True)


def may_enforce_against(user, chat_status: str) -> bool:
    """Both safety rules from the module docstring, in one place.

    Anything that removes somebody goes through here first. A ``False`` is not an error —
    it is the integration declining to touch a person it has no business touching.
    """
    if chat_status in api.CHAT_ADMIN_STATUSES:
        return False
    if user is None:
        return False
    return str(getattr(user, "role", "") or "").strip().lower() == "student"


# ── Audit trail ──────────────────────────────────────────────────────────────


def _display_name(user) -> str:
    if user is None:
        return ""
    full = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
    return (full or getattr(user, "username", "") or getattr(user, "email", "") or f"#{user.pk}")[:200]


def log_event(
    *,
    classroom: Optional[Classroom],
    action: str,
    user=None,
    telegram_user_id: Optional[int] = None,
    reason: str = "",
    detail: str = "",
) -> None:
    try:
        ClassroomTelegramEvent.objects.create(
            classroom=classroom,
            classroom_name=(getattr(classroom, "name", "") or "")[:200],
            user=user,
            user_name=_display_name(user),
            telegram_user_id=telegram_user_id,
            action=action,
            reason=reason,
            detail=detail[:500],
        )
    except Exception:
        # The trail is worth having, but never at the cost of the action it describes.
        logger.exception("telegram_group event log failed action=%s", action)


# ── Rows ─────────────────────────────────────────────────────────────────────


def _row_for_user(classroom: Classroom, user) -> ClassroomTelegramMember:
    row, _ = ClassroomTelegramMember.objects.get_or_create(classroom=classroom, user=user)
    return row


def _clear_ticket(row: ClassroomTelegramMember, *, revoke: bool = True) -> None:
    """Burn the outstanding invite, at Telegram's end as well as ours.

    Called after a join (the ticket is spent), after a rejection (it was spent by the wrong
    person) and on freeze (a link minted a minute before the freeze must not still open the
    door). ``member_limit=1`` already retires a used link; the explicit revoke is what closes
    the window on an UNUSED one.
    """
    if revoke and row.invite_link and row.classroom_id:
        chat = chat_id_for(row.classroom)
        if chat:
            api.revoke_invite_link(chat, row.invite_link)
    row.invite_link = ""
    row.invite_expires_at = None


# ── Issuing a link ───────────────────────────────────────────────────────────


def issue_invite(*, user, classroom: Classroom) -> dict:
    """Mint this student's single-use way into the class group.

    Raises :class:`TelegramGroupError` with a message meant for the student's screen.
    """
    if not api.is_configured():
        raise TelegramGroupError(
            "not_configured", "Telegram is not set up on this server.", status=503
        )
    chat = chat_id_for(classroom)
    if not chat:
        raise TelegramGroupError(
            "no_group",
            "This class has no Telegram group set up yet. Ask your teacher.",
            status=409,
        )

    telegram_id = getattr(user, "telegram_id", None)
    if not telegram_id:
        raise TelegramGroupError(
            "telegram_not_linked",
            "Connect your Telegram account first — the invite is issued to that account.",
            status=409,
        )

    verdict = eligibility(user, classroom)
    if not verdict.allowed:
        raise TelegramGroupError("not_eligible", verdict.message, status=403)

    row = _row_for_user(classroom, user)

    # Already inside? Then there is nothing to mint, and minting anyway would leave a live
    # spare ticket lying around for them to give away.
    probe = api.get_chat_member(chat, int(telegram_id))
    if probe.ok and str((probe.result or {}).get("status") or "") in api.IN_CHAT_STATUSES:
        _clear_ticket(row)
        row.telegram_user_id = int(telegram_id)
        row.status = ClassroomTelegramMember.STATUS_JOINED
        row.joined_at = row.joined_at or timezone.now()
        row.last_checked_at = timezone.now()
        row.save()
        return {"already_member": True, "invite_link": "", "expires_at": None}
    if probe.is_forbidden:
        raise TelegramGroupError("telegram_error", _friendly(probe), status=409)

    _clear_ticket(row)

    expires_at = timezone.now() + timedelta(minutes=invite_ttl_minutes())
    created = api.create_one_time_invite_link(
        chat,
        name=f"c{classroom.pk}-u{user.pk}",
        expire_unix=int(expires_at.timestamp()),
        member_limit=1,
    )
    if not created.ok:
        logger.warning(
            "telegram_group invite failed class=%s user=%s: %s",
            classroom.pk, user.pk, created.description,
        )
        log_event(
            classroom=classroom,
            action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR,
            user=user,
            detail=created.description,
        )
        raise TelegramGroupError("telegram_error", _friendly(created), status=502)

    link = str((created.result or {}).get("invite_link") or "")
    if not link:
        raise TelegramGroupError("telegram_error", _friendly(created), status=502)

    row.invite_link = link
    row.invite_expires_at = expires_at
    row.invite_issued_at = timezone.now()
    row.invite_issued_count = (row.invite_issued_count or 0) + 1
    # PENDING, not JOINED: a ticket is a promise, and the row must not claim they are in the
    # group until Telegram says they walked through.
    if row.status != ClassroomTelegramMember.STATUS_JOINED:
        row.status = ClassroomTelegramMember.STATUS_PENDING
    row.removed_reason = ""
    row.save()

    log_event(
        classroom=classroom,
        action=ClassroomTelegramEvent.ACTION_LINK_ISSUED,
        user=user,
        telegram_user_id=int(telegram_id),
        detail=f"expires {expires_at.isoformat()}",
    )

    # A courtesy copy, if this student has ever opened a chat with the bot. The site is
    # showing them the same link on screen, so a failure here costs nothing.
    api.send_message(
        int(telegram_id),
        f"Your one-time invite to <b>{classroom.name}</b>:\n{link}\n\n"
        f"It works once, for this account only, and expires in {invite_ttl_minutes()} minutes.",
    )

    return {"already_member": False, "invite_link": link, "expires_at": expires_at}


# ── What the classroom page shows ────────────────────────────────────────────


def student_state(*, user, classroom: Classroom) -> dict:
    row = (
        ClassroomTelegramMember.objects.filter(classroom=classroom, user=user).first()
        if user is not None
        else None
    )
    verdict = eligibility(user, classroom)
    live_ticket = bool(
        row
        and row.invite_link
        and row.invite_expires_at
        and row.invite_expires_at > timezone.now()
    )
    return {
        "managed": is_managed(classroom),
        "group_url": (getattr(classroom, "telegram_group_url", "") or "").strip(),
        "telegram_linked": bool(getattr(user, "telegram_id", None)),
        "status": row.status if row else "NONE",
        "removed_reason": (row.removed_reason if row else "") or "",
        "eligible": verdict.allowed,
        "reason": verdict.reason,
        "message": verdict.message,
        "invite_link": row.invite_link if live_ticket else "",
        "invite_expires_at": row.invite_expires_at if live_ticket else None,
        "rules": JOIN_RULES,
        "invite_ttl_minutes": invite_ttl_minutes(),
    }


# ── Removing somebody ────────────────────────────────────────────────────────


def _notify_removed(user, classroom: Classroom, reason: str) -> None:
    if user is None:
        return
    if reason == ClassroomTelegramMember.REASON_FROZEN:
        body = (
            "While your account is frozen you are out of the class Telegram group. You are "
            "still in the class here — your homework, points and results are exactly where "
            "you left them. As soon as your account is active again, open the class and "
            "press Join Telegram group for a new link."
        )
    elif reason == ClassroomTelegramMember.REASON_NOT_IN_CLASS:
        body = "You have moved out of this class, so you have come out of its Telegram group too."
    elif reason == ClassroomTelegramMember.REASON_IDENTITY_MISMATCH:
        body = (
            "Someone else opened your one-time invite link, so it was used up and they were "
            "removed from the group. Open the class and press Join Telegram group for a new "
            "link — and keep this one to yourself."
        )
    else:
        body = "You were removed from the class Telegram group."

    notify(
        user,
        event=note_const.EVENT_TELEGRAM_GROUP,
        title=f"{classroom.name}: Telegram group",
        body=body,
        link_url=f"/classes/{classroom.pk}",
        dedupe_key=f"tg-group:{classroom.pk}:{user.pk}:{reason}",
    )
    telegram_id = getattr(user, "telegram_id", None)
    if telegram_id:
        api.send_message(int(telegram_id), f"<b>{classroom.name}</b>\n{body}")


def remove_member(
    row: ClassroomTelegramMember,
    *,
    reason: str,
    notify_student: bool = True,
    chat_status: Optional[str] = None,
) -> bool:
    """Take one person out of one class group. Returns True if Telegram was asked to act.

    Passing ``chat_status`` skips the ``getChatMember`` probe when the caller has just made
    one — the sweep has, and doubling every check would double the API traffic of the run.
    """
    classroom = row.classroom
    chat = chat_id_for(classroom)
    if not chat:
        return False

    telegram_id = row.telegram_user_id or getattr(row.user, "telegram_id", None)
    if not telegram_id:
        # Nothing to remove: we have never seen this person inside the group. Still worth
        # burning any live ticket, which is the half of the job that does apply.
        _clear_ticket(row)
        row.status = ClassroomTelegramMember.STATUS_REMOVED
        row.removed_reason = reason
        row.removed_at = timezone.now()
        row.save()
        return False

    if chat_status is None:
        probe = api.get_chat_member(chat, int(telegram_id))
        chat_status = str((probe.result or {}).get("status") or "") if probe.ok else ""

    if chat_status in api.OUT_OF_CHAT_STATUSES:
        # Already gone — record the truth, do not call Telegram.
        _clear_ticket(row)
        row.status = ClassroomTelegramMember.STATUS_REMOVED
        row.removed_reason = reason
        row.removed_at = timezone.now()
        row.last_checked_at = timezone.now()
        row.save()
        return False

    if not may_enforce_against(row.user, chat_status):
        log_event(
            classroom=classroom,
            action=ClassroomTelegramEvent.ACTION_RECONCILED,
            user=row.user,
            telegram_user_id=int(telegram_id),
            reason=reason,
            detail=f"left in place ({chat_status or 'unknown'}): not a student, or a chat admin",
        )
        row.last_checked_at = timezone.now()
        row.save(update_fields=["last_checked_at", "updated_at"])
        return False

    kicked = api.kick_chat_member(chat, int(telegram_id))
    _clear_ticket(row)
    row.status = ClassroomTelegramMember.STATUS_REMOVED
    row.removed_reason = reason
    row.removed_at = timezone.now()
    row.last_checked_at = timezone.now()
    row.save()

    log_event(
        classroom=classroom,
        action=ClassroomTelegramEvent.ACTION_REMOVED,
        user=row.user,
        telegram_user_id=int(telegram_id),
        reason=reason,
        detail="" if kicked.ok else kicked.description,
    )
    if not kicked.ok:
        logger.warning(
            "telegram_group kick failed class=%s tg=%s: %s",
            classroom.pk, telegram_id, kicked.description,
        )
        return False

    if notify_student:
        _notify_removed(row.user, classroom, reason)
    return True


def enforce_for_user(user, *, reason: str) -> dict:
    """Take one account out of every class group it should no longer be in.

    This is what a freeze calls. It also revokes outstanding tickets: a link minted a minute
    before the freeze would otherwise still open the door, and closing the front door while
    leaving a key under the mat is not closing the door.
    """
    removed = 0
    revoked = 0
    rows = (
        ClassroomTelegramMember.objects.filter(user=user)
        .exclude(status=ClassroomTelegramMember.STATUS_REMOVED)
        .select_related("classroom", "user")
    )
    for row in rows:
        if not chat_id_for(row.classroom):
            continue
        if row.invite_link:
            revoked += 1
        if remove_member(row, reason=reason):
            removed += 1
    return {"removed": removed, "tickets_revoked": revoked}


# ── Inbound updates ──────────────────────────────────────────────────────────


def classrooms_for_chat(chat_id: str) -> list[Classroom]:
    """Every class that meets in this Telegram group.

    Plural, because ``telegram_chat_id`` is not unique and was never meant to be: a teacher
    who takes two classes may well run one group for both. Treating a chat as one classroom
    would then check the arriving student against the wrong roster and remove somebody who
    belongs there — the one outcome this whole design is supposed to prevent.
    """
    if not chat_id:
        return []
    return list(Classroom.objects.filter(telegram_chat_id=str(chat_id)).order_by("pk"))


def classroom_for_chat(chat_id: str) -> Optional[Classroom]:
    """The first class meeting in this group. For callers that only need a label."""
    found = classrooms_for_chat(chat_id)
    return found[0] if found else None


def _upsert_observed(
    classroom: Classroom, tg_user: dict, *, user=None
) -> ClassroomTelegramMember:
    """Find (or start) the row for a Telegram account seen in a class group.

    Matching is by ``telegram_user_id`` first because that is what the group actually
    reports. Falling back to the site user keeps the PENDING row a student already has from
    turning into a second, duplicate row the moment they arrive.
    """
    tg_id = int(tg_user.get("id") or 0)
    row = ClassroomTelegramMember.objects.filter(
        classroom=classroom, telegram_user_id=tg_id
    ).first()
    if row is None and user is not None:
        row = ClassroomTelegramMember.objects.filter(classroom=classroom, user=user).first()
    if row is None:
        row = ClassroomTelegramMember(classroom=classroom, user=user)
    if user is not None and row.user_id is None:
        row.user = user
    row.telegram_user_id = tg_id
    row.telegram_username = str(tg_user.get("username") or "")[:64]
    row.telegram_display_name = (
        f"{tg_user.get('first_name') or ''} {tg_user.get('last_name') or ''}".strip()[:200]
    )
    return row


def handle_chat_member_update(update: dict) -> str:
    """Process one ``chat_member`` update. Returns a short outcome tag (for tests and logs)."""
    chat = update.get("chat") if isinstance(update.get("chat"), dict) else {}
    classrooms = classrooms_for_chat(str(chat.get("id") or ""))
    if not classrooms:
        return "unknown_chat"

    new = update.get("new_chat_member") if isinstance(update.get("new_chat_member"), dict) else {}
    old = update.get("old_chat_member") if isinstance(update.get("old_chat_member"), dict) else {}
    tg_user = new.get("user") if isinstance(new.get("user"), dict) else {}
    if not tg_user or tg_user.get("is_bot"):
        return "ignored"

    tg_id = int(tg_user.get("id") or 0)
    if not tg_id:
        return "ignored"

    new_status = str(new.get("status") or "")
    old_status = str(old.get("status") or "")
    was_in = old_status in api.IN_CHAT_STATUSES
    is_in = new_status in api.IN_CHAT_STATUSES

    site_user = User.objects.filter(telegram_id=tg_id).first()

    if was_in and not is_in:
        return _handle_departure(classrooms, tg_user)
    if not was_in and is_in:
        return _handle_arrival(classrooms, tg_user, site_user, update, new_status)
    return "no_change"


def _handle_departure(classrooms: list[Classroom], tg_user: dict) -> str:
    """One person walked out of the group, so they are out of every class that meets there."""
    rows = list(
        ClassroomTelegramMember.objects.filter(
            classroom__in=classrooms, telegram_user_id=int(tg_user.get("id") or 0)
        ).select_related("classroom", "user")
    )
    if not rows:
        return "unknown_member"

    outcome = "unknown_member"
    for row in rows:
        # A removal WE just performed also arrives here as a departure. Overwriting it with
        # "left of their own accord" would erase the only record of why they are outside,
        # which is precisely the question the student will ask.
        recently_removed = (
            row.status == ClassroomTelegramMember.STATUS_REMOVED
            and row.removed_at is not None
            and (timezone.now() - row.removed_at) < timedelta(minutes=10)
        )
        if recently_removed:
            outcome = "already_removed" if outcome == "unknown_member" else outcome
            continue

        row.status = ClassroomTelegramMember.STATUS_LEFT
        row.left_at = timezone.now()
        _clear_ticket(row, revoke=False)
        row.save()
        log_event(
            classroom=row.classroom,
            action=ClassroomTelegramEvent.ACTION_LEFT,
            user=row.user,
            telegram_user_id=row.telegram_user_id,
        )
        outcome = "left"
    return outcome


def _handle_arrival(
    classrooms: list[Classroom], tg_user: dict, site_user, update: dict, new_status: str
) -> str:
    tg_id = int(tg_user.get("id") or 0)
    invite = update.get("invite_link") if isinstance(update.get("invite_link"), dict) else {}
    link_url = str(invite.get("invite_link") or "")

    # Looked up by the link alone, across every class: Telegram's invite URLs are unique, and
    # scoping the lookup to one of several classes sharing the group would lose the ticket
    # and treat a legitimate arrival as a stranger.
    ticket = (
        ClassroomTelegramMember.objects.filter(invite_link=link_url)
        .select_related("user", "classroom")
        .first()
        if link_url
        else None
    )

    # ── Someone used a ticket cut for somebody else ──────────────────────────
    if ticket is not None and ticket.user_id is not None:
        classroom = ticket.classroom
        expected_tg = getattr(ticket.user, "telegram_id", None)
        if expected_tg is None or int(expected_tg) != tg_id:
            _reject_join(classroom, tg_user, ticket, new_status)
            return "rejected_identity_mismatch"

        row = _upsert_observed(classroom, tg_user, user=ticket.user)
        row.status = ClassroomTelegramMember.STATUS_JOINED
        row.joined_at = timezone.now()
        row.removed_reason = ""
        row.removed_at = None
        row.left_at = None
        row.last_checked_at = timezone.now()
        # Spent, not revoked: `member_limit=1` has already retired it at Telegram's end.
        _clear_ticket(row, revoke=False)
        row.save()
        log_event(
            classroom=classroom,
            action=ClassroomTelegramEvent.ACTION_JOINED,
            user=ticket.user,
            telegram_user_id=tg_id,
            detail="via one-time link",
        )
        return "joined"

    # ── No ticket: the static link, or somebody added by hand ────────────────
    #
    # Pick the class they actually belong to, not simply the first that meets here — with a
    # shared group those are different questions and only the second one has a wrong answer.
    home = next(
        (c for c in classrooms if site_user is not None and eligibility(site_user, c).allowed),
        None,
    )
    if home is not None:
        row = _upsert_observed(home, tg_user, user=site_user)
        row.status = ClassroomTelegramMember.STATUS_JOINED
        row.joined_at = timezone.now()
        row.removed_reason = ""
        row.removed_at = None
        row.last_checked_at = timezone.now()
        # They came in some other way, so any link the site had cut for them is still live.
        # It is a working credential for a group they are now inside — retire it.
        _clear_ticket(row)
        row.save()
        log_event(
            classroom=home,
            action=ClassroomTelegramEvent.ACTION_JOINED,
            user=site_user,
            telegram_user_id=tg_id,
            detail="adopted: joined without a site-issued link",
        )
        return "adopted"

    classroom = classrooms[0]
    row = _upsert_observed(classroom, tg_user, user=site_user)
    verdict = eligibility(site_user, classroom) if site_user else Eligibility(False, "", "")

    if may_enforce_against(site_user, new_status):
        row.save()
        remove_member(row, reason=verdict.reason or ClassroomTelegramMember.REASON_NOT_IN_CLASS,
                      chat_status=new_status)
        return "removed_ineligible"

    # Rule 1: an account we cannot account for is recorded, not kicked. A KNOWN account we
    # are simply not allowed to touch — a teacher, an admin, the chat's owner — is a
    # different fact and gets a different name, so the report of "strangers in the group"
    # stays a report of actual strangers.
    row.status = ClassroomTelegramMember.STATUS_JOINED
    row.joined_at = timezone.now()
    row.last_checked_at = timezone.now()
    row.save()
    if site_user is not None:
        log_event(
            classroom=classroom,
            action=ClassroomTelegramEvent.ACTION_RECONCILED,
            user=site_user,
            telegram_user_id=tg_id,
            detail=f"joined and left in place ({new_status}): not a student, or a chat admin",
        )
        return "left_in_place"

    log_event(
        classroom=classroom,
        action=ClassroomTelegramEvent.ACTION_UNMANAGED_JOIN,
        telegram_user_id=tg_id,
        detail=f"@{row.telegram_username or '?'} joined; no matching student account",
    )
    return "unmanaged"


def _reject_join(
    classroom: Classroom, tg_user: dict, ticket: ClassroomTelegramMember, new_status: str
) -> None:
    tg_id = int(tg_user.get("id") or 0)
    chat = chat_id_for(classroom)

    # Still never a chat admin — but everybody else goes, known account or not. A link
    # belonging to someone else is the one case where "we cannot identify you" is itself
    # the reason to act.
    if chat and new_status not in api.CHAT_ADMIN_STATUSES:
        api.kick_chat_member(chat, tg_id)

    log_event(
        classroom=classroom,
        action=ClassroomTelegramEvent.ACTION_JOIN_REJECTED,
        user=ticket.user,
        telegram_user_id=tg_id,
        reason=ClassroomTelegramMember.REASON_IDENTITY_MISMATCH,
        detail=f"link issued to user {ticket.user_id} was opened by telegram {tg_id}",
    )

    # The ticket is spent whatever happened, so its owner needs a new one.
    _clear_ticket(ticket, revoke=False)
    if ticket.status == ClassroomTelegramMember.STATUS_PENDING:
        ticket.status = ClassroomTelegramMember.STATUS_REMOVED
        ticket.removed_reason = ClassroomTelegramMember.REASON_IDENTITY_MISMATCH
        ticket.removed_at = timezone.now()
    ticket.save()
    _notify_removed(ticket.user, classroom, ClassroomTelegramMember.REASON_IDENTITY_MISMATCH)


# ── The sweep ────────────────────────────────────────────────────────────────
#
# The Bot API has no "list the members of this group" — only the admins and a head count.
# So the site can never enumerate a class group from cold: it knows the people it has seen
# arrive. That is why every arrival is written down, including the ones that match nobody
# here. Over a term the table converges on the real roster, and until then the sweep is
# honest about what it can and cannot see rather than pretending the group is empty.

#: Between member probes. Telegram's limit is around thirty calls a second across the whole
#: bot; a sweep that ignores it gets the bot 429'd for everything else it does, including
#: minting a link for a student waiting on the page.
PROBE_INTERVAL_SECONDS = 0.05


@dataclass
class GroupHealth:
    ok: bool
    chat_id: str = ""
    title: str = ""
    member_count: Optional[int] = None
    bot_status: str = ""
    can_invite: bool = False
    can_restrict: bool = False
    problem: str = ""


def group_health(classroom: Classroom) -> GroupHealth:
    """Is this class's group actually usable — bot present, admin, and able to do the job?

    Both permissions are load-bearing and they fail differently: without ``can_invite_users``
    no student can ever join, and without ``can_restrict_members`` everyone joins and nobody
    can be taken out — which is the worse failure, because it looks like it is working.
    """
    chat = chat_id_for(classroom)
    if not chat:
        return GroupHealth(False, problem="No Telegram chat id is set for this class.")
    if not api.is_configured():
        return GroupHealth(False, chat_id=chat, problem="No Telegram bot token on this server.")

    bot_id = bot_user_id()
    if not bot_id:
        return GroupHealth(False, chat_id=chat, problem="The bot token is malformed.")

    me = api.get_chat_member(chat, bot_id)
    if not me.ok:
        return GroupHealth(False, chat_id=chat, problem=_friendly(me))

    info = me.result or {}
    status = str(info.get("status") or "")
    can_invite = bool(info.get("can_invite_users"))
    can_restrict = bool(info.get("can_restrict_members"))
    # The creator holds every right implicitly and reports none of them.
    if status == "creator":
        can_invite = can_restrict = True

    health = GroupHealth(
        ok=False,
        chat_id=chat,
        bot_status=status,
        can_invite=can_invite,
        can_restrict=can_restrict,
    )
    chat_info = api.get_chat(chat)
    if chat_info.ok:
        health.title = str((chat_info.result or {}).get("title") or "")
    count = api.get_chat_member_count(chat)
    if count.ok and isinstance(count.result, int):
        health.member_count = count.result

    if status not in api.CHAT_ADMIN_STATUSES:
        health.problem = "The bot is in the group but is not an administrator."
    elif not can_invite:
        health.problem = "The bot cannot invite members. Give it the 'Invite users' right."
    elif not can_restrict:
        health.problem = "The bot cannot remove members. Give it the 'Ban users' right."
    else:
        health.ok = True
    return health


def audit_classroom(classroom: Classroom, *, sleep: float = PROBE_INTERVAL_SECONDS) -> dict:
    """Reconcile one class group with what the site believes, and act on the difference."""
    summary = {
        "classroom_id": classroom.pk,
        "checked": 0,
        "removed": 0,
        "reconciled": 0,
        "tickets_expired": 0,
        "problem": "",
    }
    if not chat_id_for(classroom):
        summary["problem"] = "no chat id"
        return summary

    health = group_health(classroom)
    if not health.ok:
        summary["problem"] = health.problem
        log_event(
            classroom=classroom,
            action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR,
            detail=health.problem,
        )
        # A group the bot cannot act on is not a group to make decisions about: every probe
        # would fail and the sweep would rewrite good rows with the results of a broken call.
        return summary

    now = timezone.now()

    # Tickets that were never used. Revoke them at Telegram's end too — an expired link is
    # already dead there, but a link left on the group's invite list is noise for whoever
    # administers it, and a revoke on an already-expired link is harmless.
    stale = ClassroomTelegramMember.objects.filter(
        classroom=classroom,
        status=ClassroomTelegramMember.STATUS_PENDING,
        invite_expires_at__lt=now,
    ).exclude(invite_link="")
    for row in stale:
        _clear_ticket(row)
        row.save(update_fields=["invite_link", "invite_expires_at", "updated_at"])
        summary["tickets_expired"] += 1

    rows = (
        ClassroomTelegramMember.objects.filter(
            classroom=classroom, status=ClassroomTelegramMember.STATUS_JOINED
        )
        .exclude(telegram_user_id=None)
        .select_related("user", "classroom")
    )
    for row in rows:
        if sleep:
            time.sleep(sleep)
        summary["checked"] += 1
        probe = api.get_chat_member(chat_id_for(classroom), int(row.telegram_user_id))
        if not probe.ok:
            continue
        chat_status = str((probe.result or {}).get("status") or "")

        if chat_status in api.OUT_OF_CHAT_STATUSES:
            row.status = ClassroomTelegramMember.STATUS_LEFT
            row.left_at = row.left_at or now
            row.last_checked_at = now
            row.save()
            log_event(
                classroom=classroom,
                action=ClassroomTelegramEvent.ACTION_RECONCILED,
                user=row.user,
                telegram_user_id=row.telegram_user_id,
                detail="gone from the group; marked left",
            )
            summary["reconciled"] += 1
            continue

        verdict = eligibility(row.user, classroom) if row.user_id else Eligibility(True)
        if not verdict.allowed and may_enforce_against(row.user, chat_status):
            if remove_member(row, reason=verdict.reason, chat_status=chat_status):
                summary["removed"] += 1
            continue

        row.last_checked_at = now
        row.save(update_fields=["last_checked_at", "updated_at"])

    return summary


def audit_all(*, max_classrooms: Optional[int] = None, sleep: float = PROBE_INTERVAL_SECONDS) -> dict:
    """Every active class group, one after another."""
    totals = {"classrooms": 0, "checked": 0, "removed": 0, "reconciled": 0, "problems": []}
    if not api.is_configured():
        totals["problems"].append("no bot token")
        return totals

    qs = (
        Classroom.objects.filter(is_active=True)
        .exclude(telegram_chat_id="")
        .exclude(telegram_chat_id=None)
        .order_by("pk")
    )
    if max_classrooms:
        qs = qs[:max_classrooms]

    for classroom in qs:
        try:
            result = audit_classroom(classroom, sleep=sleep)
        except Exception:
            logger.exception("telegram_group audit failed class=%s", classroom.pk)
            continue
        totals["classrooms"] += 1
        totals["checked"] += result["checked"]
        totals["removed"] += result["removed"]
        totals["reconciled"] += result["reconciled"]
        if result["problem"]:
            totals["problems"].append(f"{classroom.pk}: {result['problem']}")
    return totals
