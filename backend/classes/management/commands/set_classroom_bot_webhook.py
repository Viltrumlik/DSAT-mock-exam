"""Point the class-group bot's webhook at this deployment (or take it down).

``chat_member`` is the update this feature is built on and Telegram does **not** send it by
default — a bot only receives it if it is named in ``allowed_updates``. Miss it and the
integration looks configured, mints links happily, and never learns that anybody joined.
That is the single most likely way to get this wrong, which is why the list is spelled out
here rather than left to a default.

    python manage.py set_classroom_bot_webhook --base-url https://mastersat.uz
    python manage.py set_classroom_bot_webhook --delete
    python manage.py set_classroom_bot_webhook --show
"""

from __future__ import annotations

import json
import os

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from classes.telegram_group_api import bot_token

#: ``message`` carries the /chatid helper; ``my_chat_member`` tells us the bot itself was
#: added, promoted or removed. Everything else is noise we would only have to discard.
ALLOWED_UPDATES = ["message", "chat_member", "my_chat_member"]

WEBHOOK_PATH = "/api/classes/telegram/webhook/"


class Command(BaseCommand):
    help = "Register (or clear, or inspect) the class-group Telegram bot webhook."

    def add_arguments(self, parser):
        parser.add_argument(
            "--base-url",
            default=os.getenv("PUBLIC_BASE_URL", "https://mastersat.uz"),
            help="Public https origin Telegram will POST updates to (the apex, not a console subdomain).",
        )
        parser.add_argument("--delete", action="store_true", help="Remove the webhook.")
        parser.add_argument("--show", action="store_true", help="Print getWebhookInfo and stop.")

    def handle(self, *args, **options):
        token = bot_token()
        if not token:
            raise CommandError(
                "No bot token. Set CLASSROOM_TELEGRAM_BOT_TOKEN, or TELEGRAM_BOT_TOKEN."
            )

        if options["show"]:
            resp = requests.get(f"https://api.telegram.org/bot{token}/getWebhookInfo", timeout=15)
            self.stdout.write(resp.text)
            return

        if options["delete"]:
            resp = requests.post(f"https://api.telegram.org/bot{token}/deleteWebhook", timeout=15)
            self.stdout.write(resp.text)
            return

        secret = str(getattr(settings, "CLASSROOM_TELEGRAM_WEBHOOK_SECRET", "") or "").strip()
        if not secret:
            # Registering without one would leave the endpoint answering 503 to Telegram for
            # ever (the view fails closed), which reads as "Telegram is broken" rather than
            # "you did not finish the setup".
            raise CommandError(
                "CLASSROOM_TELEGRAM_WEBHOOK_SECRET is not set. The webhook refuses every "
                "update without it, so registering now would set up a dead endpoint."
            )

        url = f"{str(options['base_url']).rstrip('/')}{WEBHOOK_PATH}"
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            data={
                "url": url,
                "secret_token": secret,
                "allowed_updates": json.dumps(ALLOWED_UPDATES),
                # Otherwise a redeploy replays whatever queued up while the app was down.
                # Joins are reconciled by the sweep anyway, so the backlog is not worth
                # processing hours late.
                "drop_pending_updates": "true",
            },
            timeout=15,
        )
        self.stdout.write(f"setWebhook -> {url}")
        self.stdout.write(f"allowed_updates -> {ALLOWED_UPDATES}")
        self.stdout.write(resp.text)
