"""The class bot's Bot API calls on the test copy (``classes.telegram_group_api._send`` while captured).

Telegram is never called. A call that would reach someone — a message, a photo, an invite link, a kick, a deleted
post — is written to the toolbox's Messages and answered as Telegram answers it, in the shape its callers read.

The reads (``READS``) reach nobody, so they get no row (the half-hourly audit asks about every member of every group).
``getChatMember`` answers what the site itself believes: the bot is the group's administrator with the rights it
needs, a member the site holds as JOINED is in the group, anyone else is not. So the audit changes nothing, a frozen
member is still removed (and the removal shows in Messages), and a student who is not in yet still gets a link.
``getMe`` gives no username, so nothing builds a deep link to a bot that is not ours."""

from __future__ import annotations

import re
import secrets
import urllib.parse

from .outbound import capture

INVITE_LINK = "https://t.me/+STAGING"
READS = frozenset({"getMe", "getChat", "getChatMember", "getChatMemberCount"})
#: A multipart text field: the part's header ends at the blank line, its value at the next boundary.
_FIELD = re.compile(rb'Content-Disposition: form-data; name="([^"]+)"\r\n\r\n(.*?)\r\n--', re.S)
_TOKEN = re.compile(r"/bot([^/]+)/")
#: Kept on the row so Messages can say who a kick or a link was for.
_META_FIELDS = ("user_id", "message_id", "name", "invite_link", "member_limit")


def fake_message_id() -> int:
    return secrets.randbelow(2**31 - 2) + 1


def fields_of(req) -> dict[str, str]:
    """The text fields of a Bot API request: form-encoded, or a multipart one's (the file itself is left out)."""
    data = req.data or b""
    if (req.get_header("Content-type") or "").startswith("multipart/form-data"):
        return {name.decode(): value.decode("utf-8", "replace") for name, value in _FIELD.findall(data)}
    return dict(urllib.parse.parse_qsl(data.decode("utf-8"), keep_blank_values=True))


def _as_int(value) -> int:
    text = str(value or "").strip()
    return int(text) if text.lstrip("-").isdigit() else 0


def _bot_id(req) -> int:
    """The bot's own id: the digits before the colon of the token in the URL."""
    match = _TOKEN.search(req.full_url or "")
    return _as_int(match.group(1).split(":", 1)[0]) if match else 0


def _member_status(chat_id: str, user_id: int) -> str:
    from classes.models_telegram import ClassroomTelegramMember

    joined = ClassroomTelegramMember.objects.filter(
        classroom__telegram_chat_id=chat_id, telegram_user_id=user_id, status=ClassroomTelegramMember.STATUS_JOINED
    ).exists()
    return "member" if joined else "left"


def _read(req, method: str, fields: dict):
    chat_id = fields.get("chat_id", "")
    if method == "getChatMember":
        user_id = _as_int(fields.get("user_id"))
        if user_id and user_id == _bot_id(req):
            return {
                "status": "administrator", "user": {"id": user_id, "is_bot": True},
                "can_invite_users": True, "can_restrict_members": True,
            }
        return {"status": _member_status(chat_id, user_id), "user": {"id": user_id, "is_bot": False}}
    if method == "getMe":
        return {"id": _bot_id(req), "is_bot": True, "first_name": "MasterSAT test copy", "username": ""}
    if method == "getChat":
        return {"id": _as_int(chat_id), "type": "supergroup"}
    return None  # getChatMemberCount: unknown on the copy, so the count stays empty


def class_bot(req, method: str):
    """Telegram's ``result`` for this call on the copy. A call that would reach someone is captured first."""
    fields = fields_of(req)
    if method in READS:
        return _read(req, method, fields)
    meta = {"method": method, "bot": "class", **{key: fields[key] for key in _META_FIELDS if fields.get(key)}}
    capture("telegram", fields.get("chat_id", ""), fields.get("text") or fields.get("caption") or method, meta=meta)
    if method in ("sendMessage", "sendPhoto"):
        return {"message_id": fake_message_id(), "chat": {"id": _as_int(fields.get("chat_id"))}}
    if method == "createChatInviteLink":
        return {"invite_link": INVITE_LINK, "name": fields.get("name", ""), "member_limit": _as_int(fields.get("member_limit"))}
    return True
