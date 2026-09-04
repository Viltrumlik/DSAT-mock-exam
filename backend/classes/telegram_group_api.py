"""A thin, never-raising wrapper over the Telegram Bot API methods this feature needs.

Deliberately separate from ``question_reports.telegram``, which is a *fire-and-forget*
notifier: it swallows every failure and returns ``None``, because a report that fails to
reach a staff chat is a nuisance and nothing more. This module cannot afford that. "Could
not mint a link" and "the student is not in the group" and "the bot was demoted an hour ago"
are three different answers that need three different responses from the caller, and a bare
``None`` collapses them into one.

So every call returns a :class:`TgResult` carrying Telegram's own ``error_code`` and
``description``. Nothing here raises — a Bot API outage must not 500 a classroom page — but
nothing here hides *why* either.
"""

from __future__ import annotations

import html
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from django.conf import settings

logger = logging.getLogger("classes.telegram_group")

API_TIMEOUT_SECONDS = 10

#: Telegram truncates an invite-link name past this, so build within it rather than let the
#: label silently lose its tail.
INVITE_NAME_MAX = 32

#: ``getChatMember`` statuses that mean "this person is inside the group right now".
IN_CHAT_STATUSES = frozenset({"creator", "administrator", "member", "restricted"})
#: ...and the two that mean they are not.
OUT_OF_CHAT_STATUSES = frozenset({"left", "kicked"})
#: Anyone holding the chat itself. The enforcement paths refuse to touch these accounts:
#: a bot that can remove the teacher, the owner of the centre, or another admin from the
#: class group is a far worse bug than a stale member row.
CHAT_ADMIN_STATUSES = frozenset({"creator", "administrator"})


@dataclass(frozen=True)
class TgResult:
    ok: bool
    result: Any = None
    error_code: Optional[int] = None
    description: str = ""

    def __bool__(self) -> bool:  # `if api.get_chat(...)` reads naturally
        return self.ok

    @property
    def is_forbidden(self) -> bool:
        """403 — almost always "bot is not a member/admin of that chat any more"."""
        return self.error_code == 403


@dataclass
class InviteLink:
    url: str
    expires_at: Optional[datetime] = None
    name: str = ""
    raw: dict = field(default_factory=dict)


def bot_token() -> str:
    """The bot that administers the class groups.

    Defaults to ``TELEGRAM_BOT_TOKEN`` — the same bot the student's account is already
    linked through — so the common deployment needs no new secret at all. The override
    exists because a bot can hold exactly ONE webhook: a school that already points the
    login bot's webhook somewhere else needs a second bot here, and that is a config
    decision, not a code change.
    """
    override = str(getattr(settings, "CLASSROOM_TELEGRAM_BOT_TOKEN", "") or "").strip()
    return override or str(getattr(settings, "TELEGRAM_BOT_TOKEN", "") or "").strip()


def is_configured() -> bool:
    return bool(bot_token())


def _call(method: str, params: dict, *, token: str = "") -> TgResult:
    tok = token or bot_token()
    if not tok:
        return TgResult(False, description="Telegram bot token is not configured.")

    url = f"https://api.telegram.org/bot{tok}/{method}"
    data = urllib.parse.urlencode(
        {k: v for k, v in params.items() if v is not None}
    ).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Every *interesting* Telegram failure arrives here, not as a network error: a 400
        # for a bad chat id, a 403 for a demoted bot. The description is in the body, so
        # reading it is the difference between a diagnosis and "something went wrong".
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            return TgResult(False, error_code=exc.code, description=f"HTTP {exc.code}")
        return TgResult(
            False,
            error_code=int(body.get("error_code") or exc.code),
            description=str(body.get("description") or "")[:400],
        )
    except Exception as exc:  # timeouts, DNS, TLS
        logger.warning("telegram %s failed: %s", method, exc)
        return TgResult(False, description=f"{type(exc).__name__}: {exc}"[:400])

    if not isinstance(body, dict) or not body.get("ok"):
        desc = str((body or {}).get("description") or "")[:400]
        return TgResult(False, error_code=(body or {}).get("error_code"), description=desc)
    return TgResult(True, result=body.get("result"))


# ── Reads ────────────────────────────────────────────────────────────────────


def get_me(*, token: str = "") -> TgResult:
    return _call("getMe", {}, token=token)


def get_chat(chat_id: str) -> TgResult:
    return _call("getChat", {"chat_id": chat_id})


def get_chat_member(chat_id: str, telegram_user_id: int) -> TgResult:
    return _call("getChatMember", {"chat_id": chat_id, "user_id": telegram_user_id})


def get_chat_member_count(chat_id: str) -> TgResult:
    return _call("getChatMemberCount", {"chat_id": chat_id})


# ── Invite links ─────────────────────────────────────────────────────────────


def create_one_time_invite_link(
    chat_id: str, *, name: str, expire_unix: int, member_limit: int = 1
) -> TgResult:
    """Mint a link that admits exactly ``member_limit`` people and then dies.

    ``member_limit=1`` is what makes the link a ticket: the first person through burns it.
    That is not the identity check — a forwarded link still opens for the wrong person, and
    catching that is the join handler's job — but it does mean a leaked link lets in one
    stranger rather than a stream of them, and the student has to come back to the site for
    a fresh one.
    """
    return _call(
        "createChatInviteLink",
        {
            "chat_id": chat_id,
            "name": name[:INVITE_NAME_MAX],
            "expire_date": expire_unix,
            "member_limit": member_limit,
        },
    )


def revoke_invite_link(chat_id: str, invite_link: str) -> TgResult:
    return _call("revokeChatInviteLink", {"chat_id": chat_id, "invite_link": invite_link})


# ── Membership control ───────────────────────────────────────────────────────


def kick_chat_member(chat_id: str, telegram_user_id: int) -> TgResult:
    """Remove someone *without* banning them.

    The Bot API has no "kick": ``banChatMember`` is the only way out, and a ban is
    permanent — a banned account cannot rejoin even with a fresh, valid link. Since the
    entire design is "get unfrozen, press the button again", a permanent ban would quietly
    make that second half impossible. So ban, then immediately lift it: the person is out of
    the group and free to walk back in the moment the site says they may.
    """
    banned = _call(
        "banChatMember",
        {"chat_id": chat_id, "user_id": telegram_user_id, "revoke_messages": "false"},
    )
    if not banned.ok:
        return banned
    unban = _call(
        "unbanChatMember",
        {"chat_id": chat_id, "user_id": telegram_user_id, "only_if_banned": "true"},
    )
    if not unban.ok:
        # They ARE out, which is what the caller asked for — but they are out with a ban on
        # them, and the rejoin path is now broken for that person until someone lifts it.
        logger.error(
            "telegram kick left a standing ban chat=%s user=%s: %s",
            chat_id, telegram_user_id, unban.description,
        )
    return banned


def esc(value) -> str:
    """Escape a value for interpolation into an HTML-parse-mode message.

    Every message this integration sends goes out with ``parse_mode=HTML``, and Telegram
    REJECTS the whole message — 400, "can't parse entities" — if the markup does not parse.
    So a classroom called "Junior <G15> & Math", or a student whose Telegram first name
    contains an ampersand, silently stops receiving every DM the feature sends. Silently,
    because nothing checks the result of a courtesy message.

    Anything dynamic that lands in a message body goes through here.
    """
    return html.escape(str(value or ""), quote=False)


def send_message(chat_id: str | int, text: str) -> TgResult:
    """Best effort by nature: a bot may only message someone who has messaged it first.

    Most students never will have, so a failure here is the normal case rather than an
    incident. Every message this integration sends is a courtesy copy of something the site
    already says on screen — never the only telling.
    """
    return _call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        },
    )
