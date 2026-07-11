from __future__ import annotations

import logging
import threading

from celery import shared_task
from django.conf import settings
from django.db import connection, transaction

from .models import QuestionErrorReport
from .targets import build_report_message
from .telegram import report_bot_token, report_target_chat_ids, send_telegram_message

logger = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_kwargs={"max_retries": 5})
def notify_question_report_async(self, report_id: int) -> dict:
    """Fan a committed report out to the staff group + every active /start subscriber."""
    report = (
        QuestionErrorReport.objects.select_related("reporter").filter(pk=report_id).first()
    )
    if report is None:
        return {"status": "noop", "reason": "missing", "report_id": report_id}
    token = report_bot_token()
    if not token:
        logger.info("question-report notify skipped: no bot token (report_id=%s)", report_id)
        return {"status": "noop", "reason": "no_token", "report_id": report_id}

    text = build_report_message(report)
    sent = 0
    for chat_id in report_target_chat_ids():
        if send_telegram_message(token=token, chat_id=chat_id, text=text):
            sent += 1
    return {"status": "ok", "report_id": report_id, "sent": sent}


def _deliver_off_thread(report_id: int) -> None:
    """Run the fan-out in a throwaway thread and always release its DB connection."""
    try:
        notify_question_report_async(report_id)
    except Exception:  # pragma: no cover - best-effort; never surface to the request
        logger.exception("inline question-report notification failed (report_id=%s)", report_id)
    finally:
        connection.close()


def enqueue_question_report_notification(*, report_id: int, request=None) -> None:
    """
    Enqueue the Telegram fan-out. With a Celery broker (or eager mode) it goes to the
    worker. Without one, we still must NOT block the student's request on blocking HTTPS
    calls to Telegram (staff group + every /start subscriber), so we hand it to a daemon
    thread scheduled on commit — the response returns immediately and delivery is
    best-effort (send_telegram_message already swallows errors).
    """
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        notify_question_report_async.delay(report_id)
        return

    def _spawn() -> None:
        threading.Thread(
            target=_deliver_off_thread,
            args=(report_id,),
            name=f"qr-notify-{report_id}",
            daemon=True,
        ).start()

    transaction.on_commit(_spawn)
