from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from users.permissions import IsAuthenticatedAndNotFrozen

from .models import QuestionErrorReport, TelegramReportSubscriber
from .serializers import QuestionReportCreateSerializer
from .targets import build_report_keyboard, build_report_message, resolve_target
from .tasks import enqueue_question_report_notification
from .telegram import (
    answer_callback_query,
    edit_telegram_message,
    report_bot_token,
    send_telegram_message,
)

DEDUP_WINDOW = timedelta(minutes=5)


class QuestionErrorReportCreateView(APIView):
    """POST a student's error report about a specific question. Persists + notifies Telegram."""

    permission_classes = [IsAuthenticatedAndNotFrozen]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "question_report"

    def post(self, request):
        serializer = QuestionReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        target = resolve_target(data["system"], data["question_id"])
        if target is None:
            return Response({"detail": "Question not found."}, status=status.HTTP_404_NOT_FOUND)

        # Soft dedupe: same reporter re-reporting the same question within the window
        # returns the existing report instead of creating a spam row.
        recent = (
            QuestionErrorReport.objects.filter(
                reporter=request.user,
                system=data["system"],
                question_id=data["question_id"],
                created_at__gte=timezone.now() - DEDUP_WINDOW,
            )
            .order_by("-created_at")
            .first()
        )
        if recent is not None:
            return Response({"id": recent.id, "deduped": True}, status=status.HTTP_200_OK)

        report = QuestionErrorReport.objects.create(
            system=data["system"],
            question_id=data["question_id"],
            attempt_id=data.get("attempt_id"),
            resource_type=target.resource_type,
            resource_id=target.resource_id,
            resource_title=target.resource_title,
            subject=target.subject,
            module_label=target.module_label,
            question_order=target.question_order,
            question_excerpt=target.question_excerpt,
            qb_id=target.qb_id,
            category=data["category"],
            message=data["message"],
            reporter=request.user,
        )
        enqueue_question_report_notification(report_id=report.id, request=request)
        return Response(
            {"id": report.id, "status": report.status}, status=status.HTTP_201_CREATED
        )


class TelegramReportWebhookView(APIView):
    """
    Inbound Telegram bot webhook. Handles /start (subscribe) and /stop (unsubscribe)
    so people who message the bot receive future reports by DM. Unauthenticated —
    verified by Telegram's secret-token header (mirrors AlertmanagerWebhookView).
    """

    permission_classes = []
    authentication_classes = []

    def post(self, request):
        secret = str(
            getattr(settings, "QUESTION_REPORT_TELEGRAM_WEBHOOK_SECRET", "") or ""
        ).strip()
        # Fail closed: an unconfigured secret would leave the webhook fully open —
        # anyone could /start to subscribe to (and exfiltrate) every report, or /stop
        # to unsubscribe arbitrary chats. Require the secret to be set AND to match.
        if not secret:
            return Response(
                {"detail": "Webhook not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        got = str(request.headers.get("X-Telegram-Bot-Api-Secret-Token") or "").strip()
        if got != secret:
            return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data if isinstance(request.data, dict) else {}

        # Inline-button tap (e.g. "Mark as fixed") arrives as a callback_query.
        callback = payload.get("callback_query")
        if isinstance(callback, dict):
            self._handle_callback(callback, report_bot_token())
            return Response({"ok": True}, status=status.HTTP_200_OK)

        message = payload.get("message") or payload.get("edited_message") or {}
        if not isinstance(message, dict):
            return Response({"ok": True}, status=status.HTTP_200_OK)

        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        frm = message.get("from") if isinstance(message.get("from"), dict) else {}
        chat_id = str((chat or {}).get("id") or "").strip()
        text = str(message.get("text") or "").strip()
        if not chat_id:
            return Response({"ok": True}, status=status.HTTP_200_OK)

        token = report_bot_token()
        # First token, stripping a possible "@botname" suffix seen in group chats.
        command = (text.split()[0].lower().split("@", 1)[0]) if text else ""

        if command == "/start":
            join_code = str(getattr(settings, "QUESTION_REPORT_BOT_JOIN_CODE", "") or "").strip()
            if join_code:
                parts = text.split(maxsplit=1)
                provided = parts[1].strip() if len(parts) > 1 else ""
                if provided != join_code:
                    send_telegram_message(
                        token=token,
                        chat_id=chat_id,
                        text="🔒 Join code required. Send: /start &lt;code&gt;",
                    )
                    return Response({"ok": True}, status=status.HTTP_200_OK)
            TelegramReportSubscriber.objects.update_or_create(
                chat_id=chat_id,
                defaults={
                    "is_active": True,
                    "username": str((frm or {}).get("username") or "")[:255],
                    "first_name": str((frm or {}).get("first_name") or "")[:255],
                },
            )
            send_telegram_message(
                token=token,
                chat_id=chat_id,
                text=(
                    "✅ Subscribed to question error reports. You'll get each new report here. "
                    "Send /stop to unsubscribe."
                ),
            )
        elif command == "/stop":
            TelegramReportSubscriber.objects.filter(chat_id=chat_id).update(is_active=False)
            send_telegram_message(
                token=token,
                chat_id=chat_id,
                text="🛑 Unsubscribed. Send /start to receive reports again.",
            )

        return Response({"ok": True}, status=status.HTTP_200_OK)

    def _handle_callback(self, callback: dict, token: str) -> None:
        """Handle a 'Mark as fixed' / 'Reopen' inline-button tap and sync every posted copy."""
        cq_id = str(callback.get("id") or "")
        data = str(callback.get("data") or "")
        frm = callback.get("from") if isinstance(callback.get("from"), dict) else {}

        parts = data.split(":")
        if len(parts) != 3 or parts[0] != "qr":
            answer_callback_query(token=token, callback_query_id=cq_id)
            return
        action, raw_id = parts[1], parts[2]
        try:
            report_id = int(raw_id)
        except (TypeError, ValueError):
            answer_callback_query(token=token, callback_query_id=cq_id)
            return

        report = QuestionErrorReport.objects.filter(pk=report_id).first()
        if report is None:
            answer_callback_query(token=token, callback_query_id=cq_id, text="Report not found.")
            return

        username = str((frm or {}).get("username") or "").strip()
        label = f"@{username}" if username else (
            str((frm or {}).get("first_name") or "").strip() or "admin"
        )

        if action == "fix":
            report.status = QuestionErrorReport.STATUS_FIXED
            report.resolved_by_label = label[:128]
            toast = "✅ Marked as fixed"
        elif action == "reopen":
            report.status = QuestionErrorReport.STATUS_NEW
            report.resolved_by_label = ""
            toast = "↩️ Reopened — not fixed"
        else:
            answer_callback_query(token=token, callback_query_id=cq_id)
            return

        report.save(update_fields=["status", "resolved_by_label", "updated_at"])

        # Reflect the new status on EVERY posted copy (staff group + all subscribers),
        # so no other admin re-works an already-fixed question.
        new_text = build_report_message(report)
        new_markup = build_report_keyboard(report)
        for d in report.telegram_messages or []:
            if not isinstance(d, dict):
                continue
            chat_id = str(d.get("chat_id") or "").strip()
            message_id = d.get("message_id")
            if not chat_id or not isinstance(message_id, int):
                continue
            edit_telegram_message(
                token=token,
                chat_id=chat_id,
                message_id=message_id,
                text=new_text,
                reply_markup=new_markup,
            )
        answer_callback_query(token=token, callback_query_id=cq_id, text=toast)
