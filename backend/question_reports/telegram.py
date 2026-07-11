from __future__ import annotations

import logging
import urllib.parse
import urllib.request

from django.conf import settings

from .models import TelegramReportSubscriber

logger = logging.getLogger(__name__)


def report_bot_token() -> str:
    return str(getattr(settings, "QUESTION_REPORT_TELEGRAM_BOT_TOKEN", "") or "").strip()


def send_telegram_message(*, token: str, chat_id: str, text: str) -> bool:
    """
    POST ``sendMessage`` to the Telegram Bot API. Never raises — mirrors
    ``config.ops_alerting._telegram_send`` but wraps it in the never-raise pattern
    used by ``classes.alerting`` so a Telegram outage can't break the request/task.
    """
    if not token or not chat_id:
        return False
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = urllib.parse.urlencode(
            {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            }
        ).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as _:
            return True
    except Exception:
        logger.exception("question-report telegram send failed (chat_id=%s)", chat_id)
        return False


def report_target_chat_ids() -> list[str]:
    """Configured staff group (if any) + every active /start subscriber, de-duplicated."""
    ids: list[str] = []
    group = str(getattr(settings, "QUESTION_REPORT_TELEGRAM_CHAT_ID", "") or "").strip()
    if group:
        ids.append(group)
    for cid in TelegramReportSubscriber.objects.filter(is_active=True).values_list(
        "chat_id", flat=True
    ):
        c = str(cid or "").strip()
        if c and c not in ids:
            ids.append(c)
    return ids
