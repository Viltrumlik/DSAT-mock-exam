from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from typing import Optional

from django.conf import settings

from .models import TelegramReportSubscriber

logger = logging.getLogger(__name__)


def report_bot_token() -> str:
    return str(getattr(settings, "QUESTION_REPORT_TELEGRAM_BOT_TOKEN", "") or "").strip()


def _telegram_call(token: str, method: str, params: dict) -> Optional[dict]:
    """POST to a Bot API method. Never raises; returns the parsed ``result`` or None."""
    if not token:
        return None
    try:
        url = f"https://api.telegram.org/bot{token}/{method}"
        data = urllib.parse.urlencode(params).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        if isinstance(body, dict) and body.get("ok"):
            return body.get("result") if isinstance(body.get("result"), dict) else {}
        logger.warning("telegram %s not ok: %s", method, (body or {}).get("description"))
        return None
    except Exception:
        logger.exception("telegram %s failed (chat=%s)", method, params.get("chat_id"))
        return None


def send_telegram_message(
    *,
    token: str,
    chat_id: str,
    text: str,
    reply_markup: Optional[dict] = None,
    message_thread_id: Optional[int] = None,
) -> Optional[int]:
    """
    POST ``sendMessage``. Never raises. Returns the sent ``message_id`` on success
    (truthy) or None on failure — mirrors ``config.ops_alerting._telegram_send`` with
    the never-raise pattern from ``classes.alerting``.

    ``message_thread_id`` targets a specific forum topic (only meaningful for a
    forum supergroup; ignored/None for DMs).
    """
    if not token or not chat_id:
        return None
    params = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if message_thread_id is not None:
        params["message_thread_id"] = message_thread_id
    if reply_markup is not None:
        params["reply_markup"] = json.dumps(reply_markup)
    result = _telegram_call(token, "sendMessage", params)
    if result is None:
        return None
    mid = result.get("message_id")
    return int(mid) if isinstance(mid, int) else None


def edit_telegram_message(
    *, token: str, chat_id: str, message_id: int, text: str, reply_markup: Optional[dict] = None
) -> bool:
    """Edit a previously sent message (used to reflect a new status on every copy)."""
    params = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        params["reply_markup"] = json.dumps(reply_markup)
    return _telegram_call(token, "editMessageText", params) is not None


def answer_callback_query(*, token: str, callback_query_id: str, text: str = "") -> bool:
    """Acknowledge an inline-button tap (clears the button spinner, shows a small toast)."""
    params = {"callback_query_id": callback_query_id}
    if text:
        params["text"] = text
    return _telegram_call(token, "answerCallbackQuery", params) is not None


def _report_topic_id() -> Optional[int]:
    raw = str(getattr(settings, "QUESTION_REPORT_TELEGRAM_TOPIC_ID", "") or "").strip()
    return int(raw) if raw.lstrip("-").isdigit() else None


def report_targets() -> list[dict]:
    """
    Delivery targets, de-duplicated: the configured staff group (routed to its forum
    topic when ``QUESTION_REPORT_TELEGRAM_TOPIC_ID`` is set) + every active /start
    subscriber (as a plain DM, no topic). Each item: ``{chat_id, message_thread_id}``.
    """
    targets: list[dict] = []
    seen: set[str] = set()
    group = str(getattr(settings, "QUESTION_REPORT_TELEGRAM_CHAT_ID", "") or "").strip()
    if group:
        targets.append({"chat_id": group, "message_thread_id": _report_topic_id()})
        seen.add(group)
    for cid in TelegramReportSubscriber.objects.filter(is_active=True).values_list(
        "chat_id", flat=True
    ):
        c = str(cid or "").strip()
        if c and c not in seen:
            seen.add(c)
            targets.append({"chat_id": c, "message_thread_id": None})
    return targets
