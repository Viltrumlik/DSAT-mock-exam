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
from .targets import resolve_target
from .tasks import enqueue_question_report_notification
from .telegram import report_bot_token, send_telegram_message

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
