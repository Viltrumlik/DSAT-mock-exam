from __future__ import annotations

import json
import os

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from question_reports.telegram import report_bot_token


class Command(BaseCommand):
    help = "Register (or clear) the question-report Telegram bot webhook via setWebhook."

    def add_arguments(self, parser):
        parser.add_argument(
            "--base-url",
            default=os.getenv("PUBLIC_BASE_URL", "https://mastersat.uz"),
            help="Public https base URL that Telegram will POST updates to.",
        )
        parser.add_argument(
            "--delete",
            action="store_true",
            help="Delete the webhook instead of setting it.",
        )

    def handle(self, *args, **options):
        token = report_bot_token()
        if not token:
            raise CommandError("QUESTION_REPORT_TELEGRAM_BOT_TOKEN is not set.")

        if options["delete"]:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/deleteWebhook", timeout=15
            )
            self.stdout.write(resp.text)
            return

        base = str(options["base_url"]).rstrip("/")
        webhook_url = f"{base}/api/question-reports/telegram/webhook/"
        secret = str(
            getattr(settings, "QUESTION_REPORT_TELEGRAM_WEBHOOK_SECRET", "") or ""
        ).strip()

        data = {"url": webhook_url, "allowed_updates": json.dumps(["message"])}
        if secret:
            data["secret_token"] = secret

        resp = requests.post(
            f"https://api.telegram.org/bot{token}/setWebhook", data=data, timeout=15
        )
        self.stdout.write(f"setWebhook -> {webhook_url}")
        self.stdout.write(resp.text)
