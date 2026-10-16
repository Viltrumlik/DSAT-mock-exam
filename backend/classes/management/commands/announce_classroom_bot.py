"""Post the "sign in to the bot" note into every class Telegram group, once (plan 2026-10-16).

Members from before the bot are untouchable until they are identified, and signing in is how
they are identified — so every group is asked, with a button that opens the bot.

    python manage.py announce_classroom_bot          # dry run: lists the groups
    python manage.py announce_classroom_bot --send   # posts it

Run --send only with the owner's go-ahead: it speaks in every class group at once.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from classes import telegram_group as tg
from classes import telegram_texts as T
from classes.models import Classroom


class Command(BaseCommand):
    help = "Post the class-bot sign-in note into every class Telegram group (dry run unless --send)."

    def add_arguments(self, parser):
        parser.add_argument("--send", action="store_true", help="Actually post. Without it, only list.")

    def handle(self, *args, **options):
        url = tg.bot_start_url()
        if not url:
            raise CommandError("The bot is not reachable (no token, or getMe failed).")
        chats: dict[str, list[str]] = {}
        rooms = (
            Classroom.objects.filter(is_active=True)
            .exclude(telegram_chat_id="")
            .exclude(telegram_chat_id=None)
            .order_by("pk")
        )
        for room in rooms:
            chats.setdefault(tg.chat_id_for(room), []).append(room.name)
        markup = {"inline_keyboard": [[{"text": T.ANNOUNCE_BUTTON, "url": url}]]}
        posted = 0
        for chat, names in chats.items():
            if not options["send"]:
                self.stdout.write(f"would post to {chat}: {', '.join(names)}")
                continue
            result = tg.api.send_message(chat, T.ANNOUNCE, reply_markup=markup)
            posted += int(result.ok)
            self.stdout.write(
                f"{'posted' if result.ok else 'FAILED'} {chat}: {', '.join(names)} {result.description}".rstrip()
            )
        tail = f"posted {posted}" if options["send"] else "dry run — nothing posted"
        self.stdout.write(f"{len(chats)} group(s); {tail}")
