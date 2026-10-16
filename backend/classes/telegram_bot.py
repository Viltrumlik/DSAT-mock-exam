"""The class bot's private chat (plan 2026-10-16): sign in with the MasterSAT login and
password, then a menu of the student's class groups, one button each.

The owner chose the password in the chat over a sign-in form. So the password message is
deleted the instant it arrives, it is never logged or stored, and five wrong tries lock both
the Telegram account and the login for fifteen minutes. Only a real password works: the
first-time "last 4 digits" code is guessable by anyone who knows the phone, and that backend
(``lcup.auth_backend``) is never consulted here.

Conversation state and the lockouts live in the cache, which is Redis in production. A
restart losing a half-typed sign-in costs the student one /start.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q

from access import constants as acc_const
from users.backends import EmailOrUsernameModelBackend, _phone_username
from users.models import SecurityAuditEvent

from . import telegram_group as tg
from . import telegram_texts as T

logger = logging.getLogger("classes.telegram_bot")

User = get_user_model()

MAX_FAILURES = 5
LOCK_SECONDS = 15 * 60
#: How long the bot waits for the next answer in a sign-in. Long enough to find the password.
STATE_SECONDS = 10 * 60

STEP_LOGIN = "login"
STEP_PASSWORD = "password"

#: What the bot answers as a command. At the password step a message is a command only when it
#: is exactly one of these (or one addressed to this bot as ``/start@TheBot``): a password may
#: begin with a slash, and read as a command it would stay in the chat.
COMMANDS = frozenset({"/start", "/chiqish", "/guruhlar"})


# ── Cache keys ───────────────────────────────────────────────────────────────


def _state_key(tg_id: int) -> str:
    return f"tgbot:state:{tg_id}"


def _fail_key(kind: str, value) -> str:
    return f"tgbot:fail:{kind}:{value}"


def _lock_key(kind: str, value) -> str:
    return f"tgbot:lock:{kind}:{value}"


def _login_key(login: str, account) -> str:
    """What the per-login counter and lock are keyed on: the ACCOUNT the login names, not how it
    was typed. A username, an email and a phone spelling of one account all land on
    ``user:<pk>``; counting by spelling would give an attacker with several Telegram accounts
    five tries per spelling. Only a login that names nobody falls back to its own spelling
    (case and phone formatting folded), so guessing at unknown logins is still bounded."""
    if account is not None:
        return f"user:{account.pk}"
    return (_phone_username(login) or login).strip().lower()[:150]


# ── Lockouts ─────────────────────────────────────────────────────────────────


def _locked(tg_id: int, login_key: str) -> bool:
    return bool(cache.get(_lock_key("tg", tg_id)) or (login_key and cache.get(_lock_key("login", login_key))))


def _count_failure(tg_id: int, login_key: str) -> int:
    """Count one wrong try against the Telegram account and the login; lock either at five.
    Returns this Telegram account's count, which is the number the student is shown."""
    shown = 0
    for kind, value in (("tg", tg_id), ("login", login_key)):
        if not value:
            continue
        key = _fail_key(kind, value)
        cache.add(key, 0, timeout=LOCK_SECONDS)
        try:
            count = cache.incr(key)
        except ValueError:  # expired between add and incr
            cache.set(key, 1, timeout=LOCK_SECONDS)
            count = 1
        if count >= MAX_FAILURES:
            cache.set(_lock_key(kind, value), 1, timeout=LOCK_SECONDS)
            cache.delete(key)
        if kind == "tg":
            shown = count
    return shown


def _clear_failures(tg_id: int, login_key: str) -> None:
    cache.delete_many([_fail_key("tg", tg_id), _fail_key("login", login_key)])


# ── Accounts ─────────────────────────────────────────────────────────────────


def _account_for(login: str):
    """The account a login names — the single resolver for this module, and the same pick
    ``EmailOrUsernameModelBackend.authenticate`` makes (the email match wins, then the lowest
    id among username/email matches, then the account whose username is the typed phone), so
    the lock, the audit trail and the password check always concern the same account."""
    if not login:
        return None
    matches = User.objects.filter(Q(username__iexact=login) | Q(email__iexact=login))
    user = matches.filter(email__iexact=login).first() or matches.order_by("id").first()
    if user is None:
        phone = _phone_username(login)
        if phone and phone != login:
            user = User.objects.filter(username=phone).first()
    return user


def _exact_command(text: str) -> str:
    """The bot command ``text`` is on its own, or "". Used at the password step, where anything
    else — "/start@2024", "/guruhlar 1", "/x" — is a password and must be deleted and checked.
    A command may carry the bot's own @name ("/start@MasterSATBot", as a group client sends);
    one addressed to a different bot is not ours."""
    word = text.strip().lower()
    if word in COMMANDS:
        return word
    command, at, target = word.partition("@")
    if at and command in COMMANDS and target and target == (tg.api.bot_username() or "").lower():
        return command
    return ""


def _audit(user, event_type: str, tg_id: int, *, severity: str = SecurityAuditEvent.SEVERITY_INFO) -> None:
    if user is None:
        return
    try:
        SecurityAuditEvent.objects.create(
            user=user, event_type=event_type, severity=severity,
            detail={"telegram_user_id": tg_id, "via": "class_bot"},
        )
    except Exception:
        logger.exception("telegram_bot audit failed event=%s", event_type)


def _send(chat_id, text: str, markup: dict | None = None) -> None:
    tg.api.send_message(chat_id, text, reply_markup=markup)


# ── The menu ─────────────────────────────────────────────────────────────────


def menu_markup(user) -> dict | None:
    """One button per class group: ✅ inside, ➕ not yet, 🔒 frozen. None when there are none.

    Building it asks Telegram where the student is, which is also what identifies an old
    member (``identify_memberships``) — every time they open the menu, not only at sign-in.
    """
    classrooms = tg.student_classrooms(user)
    if not classrooms:
        return None
    where = tg.identify_memberships(user)
    frozen = bool(getattr(user, "is_frozen", False))
    rows = []
    for classroom in classrooms:
        if frozen:
            mark = "🔒"
        elif where.get(classroom.pk) == tg.GROUP_IN:
            mark = "✅"
        else:
            mark = "➕"
        # Button text is plain text, not HTML: no escaping. Telegram caps it at 64 bytes-ish.
        rows.append([{"text": f"{mark} {classroom.name}"[:60], "callback_data": f"g:{classroom.pk}"}])
    return {"inline_keyboard": rows}


def send_menu(chat_id, user) -> None:
    markup = menu_markup(user)
    if markup is None:
        _send(chat_id, T.MENU_EMPTY)
        return
    _send(chat_id, T.MENU_TITLE, markup)


# ── The conversation ─────────────────────────────────────────────────────────


def handle_private_message(message: dict) -> str:
    """One message in a private chat with the bot. Returns an outcome tag for the log — the
    tag, never the text: in the sign-in step the text is a password."""
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    frm = message.get("from") if isinstance(message.get("from"), dict) else {}
    chat_id = chat.get("id")
    try:
        tg_id = int(frm.get("id") or 0)
    except (TypeError, ValueError):
        tg_id = 0
    if chat_id is None or not tg_id or frm.get("is_bot"):
        return "ignored"

    text = str(message.get("text") or "").strip()
    command = text.split()[0].lower().split("@", 1)[0] if text.startswith("/") else ""
    user = User.objects.filter(telegram_bot_user_id=tg_id).first()
    state = cache.get(_state_key(tg_id)) or {}
    if state.get("step") == STEP_PASSWORD:
        command = _exact_command(text)  # anything else is the password, even one starting "/"

    if command == "/start":
        if user is not None:
            send_menu(chat_id, user)
            return "menu"
        cache.set(_state_key(tg_id), {"step": STEP_LOGIN}, STATE_SECONDS)
        _send(chat_id, T.ASK_LOGIN)
        return "ask_login"

    if command == "/chiqish":
        cache.delete(_state_key(tg_id))
        if user is not None:
            user.telegram_bot_user_id = None
            user.save(update_fields=["telegram_bot_user_id"])
            _audit(user, "telegram_bot_logout", tg_id)
        _send(chat_id, T.LOGGED_OUT)
        return "logged_out"

    if command:  # /guruhlar, or anything else that looks like a command
        if user is None:
            _send(chat_id, T.NOT_BOUND)
            return "not_bound"
        send_menu(chat_id, user)
        return "menu"

    if state.get("step") == STEP_PASSWORD:
        return _check_password(chat_id, tg_id, message, str(state.get("login") or ""))
    if state.get("step") == STEP_LOGIN:
        if not text:
            return "ignored"
        cache.set(_state_key(tg_id), {"step": STEP_PASSWORD, "login": text[:150]}, STATE_SECONDS)
        _send(chat_id, T.ASK_PASSWORD)
        return "ask_password"

    if user is not None:
        send_menu(chat_id, user)
        return "menu"
    _send(chat_id, T.NOT_BOUND)
    return "not_bound"


def _check_password(chat_id, tg_id: int, message: dict, login: str) -> str:
    # First, before anything that could fail: the password leaves the chat.
    deleted = tg.api.delete_message(chat_id, message.get("message_id"))
    cache.delete(_state_key(tg_id))
    if not deleted.ok:
        _send(chat_id, T.DELETE_FAILED)

    known = _account_for(login)
    key = _login_key(login, known)
    if _locked(tg_id, key):
        _send(chat_id, T.LOCKED.format(minutes=LOCK_SECONDS // 60))
        return "locked"

    user = EmailOrUsernameModelBackend().authenticate(
        None, username=login, password=str(message.get("text") or "")
    )
    if user is None:
        count = _count_failure(tg_id, key)
        if known is not None and not known.has_usable_password():
            _send(chat_id, T.NO_PASSWORD_YET)
            return "no_password"
        _audit(known, "telegram_bot_login_failed", tg_id, severity=SecurityAuditEvent.SEVERITY_WARNING)
        if _locked(tg_id, key):
            _audit(known, "telegram_bot_login_locked", tg_id, severity=SecurityAuditEvent.SEVERITY_WARNING)
            _send(chat_id, T.LOCKED.format(minutes=LOCK_SECONDS // 60))
            return "locked"
        cache.set(_state_key(tg_id), {"step": STEP_LOGIN}, STATE_SECONDS)
        _send(chat_id, T.WRONG.format(n=count, max=MAX_FAILURES))
        return "wrong"

    if str(getattr(user, "role", "") or "").strip().lower() not in acc_const.LEARNER_ROLES:
        _send(chat_id, T.NOT_A_STUDENT)
        return "not_student"
    if User.objects.filter(telegram_bot_user_id=tg_id).exclude(pk=user.pk).exists():
        _send(chat_id, T.TG_TAKEN)
        return "taken"

    _clear_failures(tg_id, _login_key(login, user))
    user.telegram_bot_user_id = tg_id
    user.save(update_fields=["telegram_bot_user_id"])
    _audit(user, "telegram_bot_login", tg_id)
    name = (f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username or "")
    _send(chat_id, T.WELCOME.format(name=tg.api.esc(name)))
    send_menu(chat_id, user)
    return "logged_in"
