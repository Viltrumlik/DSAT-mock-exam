"""The class Telegram group, from the classroom page and from Telegram's side.

GET  /api/classes/<pk>/telegram/          → what the Join dialog renders (student + staff)
POST /api/classes/<pk>/telegram/join/     → mint this student's single-use invite
GET  /api/classes/<pk>/telegram/members/  → staff: group health + who is in it
POST /api/classes/telegram/webhook/       → Telegram's ``chat_member`` updates

The webhook is deliberately on the ``/api/classes/`` namespace rather than a new one: the
host guard already lets that prefix through on the apex, and every route here belongs to a
classroom. It authenticates with Telegram's own secret-token header, exactly as
``question_reports.TelegramReportWebhookView`` does, and fails closed when no secret is
configured — an open webhook would let anyone forge a "student X joined" update, which is
the one lie this whole design exists to prevent.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status as http
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from users.permissions import IsAuthenticatedAndNotFrozen

from . import telegram_group as tg
from .capabilities import classroom_capabilities
from .models_telegram import ClassroomTelegramEvent, ClassroomTelegramMember
from .permissions import IsClassMemberCap
from .views_rankings import _ClassroomScopedView, _display_name

logger = logging.getLogger("classes.telegram_group")


class TelegramJoinThrottle(UserRateThrottle):
    """Each mint is a Bot API call and a live credential. A student pressing the button
    twenty times in a minute is either confused or probing; either way, slow it down."""

    scope = "telegram_group_join"


class _TelegramClassroomView(_ClassroomScopedView):
    # Overrides the base's `IsAuthenticated`: a frozen student must not be able to mint a
    # link. `telegram_group.eligibility` refuses them too — this is the cheaper of the two
    # checks and the one that keeps the frozen case out of the Bot API entirely.
    permission_classes = [IsAuthenticatedAndNotFrozen, IsClassMemberCap]


class ClassroomTelegramView(_TelegramClassroomView):
    def get(self, request, classroom_pk):
        classroom = self.get_classroom()
        return Response(tg.student_state(user=request.user, classroom=classroom))


class ClassroomTelegramJoinView(_TelegramClassroomView):
    throttle_classes = [TelegramJoinThrottle]

    def post(self, request, classroom_pk):
        classroom = self.get_classroom()
        try:
            issued = tg.issue_invite(user=request.user, classroom=classroom)
        except tg.TelegramGroupError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status)

        state = tg.student_state(user=request.user, classroom=classroom)
        state["already_member"] = issued["already_member"]
        # The freshly minted link, not the one read back from the row: `student_state` hides
        # a ticket whose expiry has passed, and a link minted this millisecond has not.
        if issued["invite_link"]:
            state["invite_link"] = issued["invite_link"]
            state["invite_expires_at"] = issued["expires_at"]
        return Response(state, status=http.HTTP_200_OK)


class ClassroomTelegramBotLinkView(_TelegramClassroomView):
    """Cut this student a ``/start`` deep link for this class.

    A POST because it mints a single-use credential and spends any earlier one. Throttled
    with the join endpoint for the same reason: each call is a row and a Bot API round trip.
    """

    throttle_classes = [TelegramJoinThrottle]

    def post(self, request, classroom_pk):
        classroom = self.get_classroom()
        if not tg.is_managed(classroom):
            return Response(
                {"detail": "This class has no Telegram group set up yet. Ask your teacher.",
                 "code": "no_group"},
                status=http.HTTP_409_CONFLICT,
            )
        verdict = tg.eligibility(request.user, classroom)
        if not verdict.allowed:
            return Response(
                {"detail": verdict.message, "code": "not_eligible"},
                status=http.HTTP_403_FORBIDDEN,
            )
        link = tg.start_link(user=request.user, classroom=classroom)
        if not link:
            return Response(
                {"detail": "The Telegram bot is not reachable right now. Try again shortly.",
                 "code": "telegram_error"},
                status=http.HTTP_502_BAD_GATEWAY,
            )
        return Response({"bot_link": link})


class ClassroomTelegramMembersView(_TelegramClassroomView):
    """Staff view: is the group wired up, and who does the site think is in it?"""

    def get(self, request, classroom_pk):
        classroom = self.get_classroom()
        caps = classroom_capabilities(request.user, classroom)
        if not caps.can_manage_roster:
            return Response(
                {"detail": "Only the teaching team can see the Telegram group roster."},
                status=http.HTTP_403_FORBIDDEN,
            )

        health = tg.group_health(classroom)
        rows = (
            ClassroomTelegramMember.objects.filter(classroom=classroom)
            .select_related("user")
            .order_by("status", "-updated_at")[:500]
        )
        return Response(
            {
                "health": {
                    "ok": health.ok,
                    "chat_id": health.chat_id,
                    "title": health.title,
                    "member_count": health.member_count,
                    "bot_status": health.bot_status,
                    "can_invite": health.can_invite,
                    "can_restrict": health.can_restrict,
                    "problem": health.problem,
                },
                "members": [
                    {
                        "user_id": r.user_id,
                        "name": _display_name(r.user) if r.user_id else "",
                        "telegram_user_id": r.telegram_user_id,
                        "telegram_username": r.telegram_username,
                        "telegram_display_name": r.telegram_display_name,
                        "status": r.status,
                        "removed_reason": r.removed_reason,
                        "joined_at": r.joined_at,
                        "last_checked_at": r.last_checked_at,
                        #: A row with no site user is somebody the bot saw arrive and could
                        #: not place. Surfaced rather than acted on — see the rules in
                        #: ``classes.telegram_group``.
                        "unmanaged": r.user_id is None,
                        #: False means the bot never watched this account arrive: they were
                        #: in the group before it started watching, and rule 3 means nothing
                        #: here will ever take them out. Shown because it is the answer to
                        #: "why is this frozen student still in the group?", and because
                        #: removing them by hand is then a decision for the school.
                        "watched": r.is_watched,
                    }
                    for r in rows
                ],
            }
        )


class ClassroomTelegramWebhookView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        secret = str(
            getattr(settings, "CLASSROOM_TELEGRAM_WEBHOOK_SECRET", "") or ""
        ).strip()
        if not secret:
            return Response(
                {"detail": "Webhook not configured."},
                status=http.HTTP_503_SERVICE_UNAVAILABLE,
            )
        got = str(request.headers.get("X-Telegram-Bot-Api-Secret-Token") or "").strip()
        if got != secret:
            return Response({"detail": "Forbidden."}, status=http.HTTP_403_FORBIDDEN)

        payload = request.data if isinstance(request.data, dict) else {}

        # Telegram retries any update it does not get a 200 for, and it retries the whole
        # backlog in order — one poisoned update would wedge every later join behind it. So
        # every failure below is logged and acknowledged.
        try:
            self._dispatch(payload)
        except Exception:
            logger.exception("telegram_group webhook failed")
        return Response({"ok": True}, status=http.HTTP_200_OK)

    def _dispatch(self, payload: dict) -> None:
        chat_member = payload.get("chat_member")
        if isinstance(chat_member, dict):
            outcome = tg.handle_chat_member_update(chat_member)
            logger.info("telegram_group chat_member -> %s", outcome)
            return

        my_chat_member = payload.get("my_chat_member")
        if isinstance(my_chat_member, dict):
            self._handle_bot_status(my_chat_member)
            return

        message = payload.get("message")
        if isinstance(message, dict):
            self._handle_message(message)

    def _handle_bot_status(self, update: dict) -> None:
        """The bot itself was added to, promoted in, or removed from a group.

        Worth a log line and an event row: "the bot was demoted three weeks ago" is the
        explanation for every mysterious failure that follows, and without this the first
        anyone hears of it is a student who cannot join.
        """
        chat = update.get("chat") if isinstance(update.get("chat"), dict) else {}
        chat_id = str(chat.get("id") or "")
        new = update.get("new_chat_member") if isinstance(update.get("new_chat_member"), dict) else {}
        status_now = str(new.get("status") or "")
        logger.info("telegram_group bot status chat=%s -> %s", chat_id, status_now)
        if status_now in ("administrator", "creator"):
            return
        # Every class that meets there, not just the first: a demotion breaks the integration
        # for all of them, and an event on only one is a trail that stops halfway.
        for classroom in tg.classrooms_for_chat(chat_id):
            tg.log_event(
                classroom=classroom,
                action=ClassroomTelegramEvent.ACTION_CONFIG_ERROR,
                detail=f"bot status in the group is now '{status_now}'",
            )

    def _handle_message(self, message: dict) -> None:
        """Two commands: ``/chatid`` for staff setting a class up, ``/start`` for students.

        ``/chatid`` exists because setting a class up means pasting the group's numeric chat
        id into the classroom settings, and there is no way to read that id from the Telegram
        client. Without it the instruction is "forward a message to a third-party bot", which
        is both awkward and a thing we should not be telling staff to do.

        ``/start`` is not decoration. **A bot may only message somebody who has messaged it
        first**, so until a student opens this chat every DM the integration would send —
        their invite link, the note explaining why they came out of the group — silently
        fails. Answering /start is what opens that channel. Everything sent by DM is a
        courtesy copy of something the site already says on screen, so this improves
        delivery rather than being load-bearing.
        """
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        chat_id = chat.get("id")
        text = str(message.get("text") or "").strip()
        parts = text.split()
        command = (parts[0].lower().split("@", 1)[0]) if parts else ""
        payload = parts[1] if len(parts) > 1 else ""
        if chat_id is None or command not in ("/chatid", "/start"):
            return

        chat_type = str(chat.get("type") or "")
        is_group = chat_type in ("group", "supergroup")

        if command == "/start":
            if is_group:
                return  # /start in a group is noise; nobody is opening a DM channel there.
            frm = message.get("from") if isinstance(message.get("from"), dict) else {}
            # A payload is the whole point of the deep link: it is the only thing that ties
            # this chat to a MasterSAT account, because every update the bot receives says
            # who sent it and nothing about who they are here.
            if payload:
                tg.api.send_message(chat_id, tg.handle_start_token(payload, frm))
                return
            tg.api.send_message(chat_id, self._start_body(message))
            return

        if is_group:
            body = (
                f"<b>{tg.api.esc(chat.get('title'))}</b>\nChat id: <code>{chat_id}</code>\n\n"
                "Paste this into the class's Telegram chat id field in the MasterSAT ops "
                "console, and make sure this bot is an administrator here with the right to "
                "invite and to remove members."
            )
        else:
            body = f"Chat id: <code>{chat_id}</code>"
        tg.api.send_message(chat_id, body)

    @staticmethod
    def _start_body(message: dict) -> str:
        """Greet by name when the account is known, and never invite anyone from here.

        Joining is a decision made on the classroom page, where the rules are shown and the
        student's eligibility is checked. A bot that handed out links on request would be a
        second door into the same room with none of the checks on it.
        """
        frm = message.get("from") if isinstance(message.get("from"), dict) else {}
        try:
            telegram_id = int(frm.get("id") or 0)
        except (TypeError, ValueError):
            telegram_id = 0

        user = (
            get_user_model().objects.filter(telegram_bot_user_id=telegram_id).first()
            if telegram_id
            else None
        )
        if user is None:
            return (
                "👋 This is the MasterSAT class bot.\n\n"
                "Open your class on the MasterSAT website and press <b>Join Telegram "
                "group</b>. That gives you a button which brings you back here already "
                "connected, and your invite arrives in this chat."
            )
        name = tg.api.esc((user.first_name or user.username or "").strip())
        return (
            f"👋 Hello{' ' + name if name else ''} — your Telegram is connected to MasterSAT.\n\n"
            "Open your class on the website and press <b>Join Telegram group</b> for a "
            "single-use invite. I will send your invites and any group news here."
        )
