"""/api/staging/ — the test copy's toolbox (/ops/toolbox).

Anywhere but the copy every endpoint answers 404 (``staging.guard.toolbox_on``), before it asks who is calling. On the
copy the toolbox is for the owner, an admin or a superuser, and every POST is written to the action log
(``ToolboxAction``): who, when, what, and what came of it. The browser clock and a "Sign in as" link are the two things
anyone may open (the host guard lets them through on every host)."""

from __future__ import annotations

import json
import logging
import math
from datetime import date
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.models import Q
from django.http import Http404, HttpResponse, HttpResponseRedirect
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_GET
from rest_framework import status as http
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.services import normalized_role
from users.people_detail import display_name

from . import timemachine as tm
from . import tools
from .guard import toolbox_on
from .models import CapturedMessage, ToolboxAction
from .outbound import captured

logger = logging.getLogger(__name__)
User = get_user_model()
#: Captured messages a page.
PAGE_SIZE = 50

#: The browser's clock on the copy's pages: ``Date`` moved by the time machine's offset, so a page shows and sends the
#: test date. Loaded render-blocking in <head> (frontend/src/app/layout.tsx) before any other script.
CLOCK_JS = (
    "(function(){var o=%(offset_ms)d;window.__STG_OFFSET_DAYS__=%(days)d;if(!o)return;var R=Date;function D(){var a=[]"
    ".slice.call(arguments);if(!(this instanceof D))return new R(R.now()+o).toString();return a.length?new (Function."
    "prototype.bind.apply(R,[null].concat(a)))():new R(R.now()+o);}D.prototype=R.prototype;D.now=function(){return R."
    "now()+o};D.UTC=R.UTC;D.parse=R.parse;window.Date=D;})();"
)
DAY_MS = 86_400_000


class IsToolboxUser(BasePermission):
    """The owner (super_admin), an admin, or a Django superuser."""

    message = "The toolbox is for the owner and admins."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return bool(user.is_superuser) or normalized_role(user) in (C.ROLE_SUPER_ADMIN, C.ROLE_ADMIN)


class ToolboxView(APIView):
    permission_classes = [IsToolboxUser]

    def initial(self, request, *args, **kwargs):
        if not toolbox_on():  # before authentication: off the copy there is nothing here at all
            raise Http404
        super().initial(request, *args, **kwargs)


def _today() -> date:
    """The copy's today: its processes run under the time machine's clock (libfaketime)."""
    return timezone.localdate()


def _data(request) -> dict:
    return request.data if isinstance(request.data, dict) else {}


def log_action(request, action: str, **detail) -> ToolboxAction:
    return ToolboxAction.objects.create(user=request.user, action=action[:60], detail=detail)


def _release() -> dict | None:
    """The deploy's RELEASE.json in the release directory (one above ``backend``), when there is one."""
    try:
        data = json.loads((Path(settings.BASE_DIR).parent / "RELEASE.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _worker_alive() -> bool:
    """A celery worker answers a ping within a second."""
    try:
        from config import celery_app

        return bool(celery_app.control.ping(timeout=1.0))
    except Exception:  # noqa: BLE001 - no broker, no worker: the answer is the same
        return False


class StatusView(ToolboxView):
    """``GET status/``: which release and database this is, the clock, and whether the background work runs."""

    def get(self, request):
        from billing import cutover
        from billing.models import BillingState

        state = tm.read_state()
        left = cutover.status()
        return Response({
            "release": _release(),
            "database": connection.settings_dict.get("NAME"),
            "toolbox": True,
            "capture": captured(),
            "clock": {"offset_days": state["offset_days"], "test_now": timezone.now()},
            "worker_alive": _worker_alive(),
            "last_tick": BillingState.get().last_tick_at,
            "left_lcup": left["left_lcup"],
            "finished": left["finished"],
        })


def _day(value) -> date:
    try:
        day = parse_date(str(value or ""))
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        day = None
    if day is None:
        raise tm.ToolboxRefused("That is not a date.")
    return day


class TimeView(ToolboxView):
    """``GET time/``: the time machine's state, and whether a request waits. ``POST time/``: one request for it —
    ``{"action": "forward", "days": n}``, ``{"action": "to", "date": "YYYY-MM-DD"}`` (forward by the days between),
    ``{"action": "back", "checkpoint": id}``, ``{"action": "today"}`` or ``{"action": "refresh"}``. 202 with its id;
    400 for a request that is wrong, 409 while the machine is busy or another request waits."""

    def get(self, request):
        return Response({**tm.read_state(), "pending": tm.pending()})

    def post(self, request):
        data = _data(request)
        action = str(data.get("action") or "")
        detail = {key: data[key] for key in ("days", "date", "checkpoint") if key in data}
        days, checkpoint = data.get("days"), data.get("checkpoint")
        try:
            if action == "to":
                day, today = _day(data.get("date")), _today()
                if day <= today:
                    raise tm.ToolboxRefused(f"Pick a day after the test date ({today:%d %b %Y}).")
                action, days = "forward", (day - today).days
                detail["days"] = days
            request_id = tm.ask(action, by=display_name(request.user), days=days, checkpoint=checkpoint)
        except tm.ToolboxRefused as refused:
            log_action(request, f"time.{action}", **detail, refused=str(refused))
            return Response({"detail": str(refused)}, status=refused.status)
        log_action(request, f"time.{action}", **detail, id=request_id)
        return Response({"id": request_id}, status=http.HTTP_202_ACCEPTED)


class ActionsView(ToolboxView):
    """``GET actions/``: the last 100 things done in the toolbox, newest first."""

    def get(self, request):
        rows = ToolboxAction.objects.select_related("user").order_by("-created_at", "-id")[:100]
        return Response([
            {"id": row.pk, "at": row.created_at, "by": display_name(row.user), "action": row.action, "detail": row.detail}
            for row in rows
        ])


@require_GET
def clock_js(request):
    """``GET clock.js`` (anyone, every host): ``CLOCK_JS`` at the time machine's offset; empty and 404 off the copy."""
    if not toolbox_on():
        response = HttpResponse(b"", status=404, content_type="text/javascript")
    else:
        try:
            days = int(tm.read_state().get("offset_days") or 0)
        except (TypeError, ValueError):
            days = 0
        response = HttpResponse(
            CLOCK_JS % {"offset_ms": days * DAY_MS, "days": days}, content_type="text/javascript; charset=utf-8"
        )
    response["Cache-Control"] = "no-store"
    return response


# ── the tools (staging.tools) ────────────────────────────────────────────────────────────────────────────────────────


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _run(request, action: str, detail: dict, work, *, status=http.HTTP_200_OK) -> Response:
    """One tool's POST. ``work()`` gives ``(answer, logged)``; the action log gets ``detail`` and either ``logged`` or
    the refusal."""
    try:
        answer, logged = work()
    except tm.ToolboxRefused as refused:
        log_action(request, action, **detail, refused=str(refused))
        return Response({"detail": str(refused)}, status=refused.status)
    log_action(request, action, **detail, **logged)
    return Response(answer, status=status)


def _room(value):
    from classes.models import Classroom

    pk = _int(value)
    room = Classroom.objects.filter(pk=pk).first() if pk else None
    if room is None:
        raise tm.ToolboxRefused("Choose a group.")
    return room


def _person(value):
    pk = _int(value)
    user = User.objects.filter(pk=pk).first() if pk else None
    if user is None:
        raise tm.ToolboxRefused("Choose a person.")
    return user


def _people(users) -> list[dict]:
    """People as the toolbox lists them, with their ledger balance (None for someone with no account)."""
    from billing import ledger
    from billing.models import Account

    accounts = {account.user_id: account for account in Account.objects.filter(user__in=users)}
    return [
        {
            "id": user.pk, "name": display_name(user), "role": normalized_role(user), "phone": user.phone_number or "",
            "parent_phone": user.parent_phone or "", "frozen": bool(user.is_frozen),
            "balance": ledger.balance(accounts[user.pk]) if user.pk in accounts else None,
        }
        for user in users
    ]


class GroupsView(ToolboxView):
    """``GET groups/``: the groups that meet (active classes), by name."""

    def get(self, request):
        from classes.models import Classroom

        rows = Classroom.objects.filter(is_active=True).order_by("name", "pk").values("id", "name", "monthly_price", "lesson_days")
        return Response(list(rows))


class PeopleView(ToolboxView):
    """``GET people/?q=``: up to 20 people whose name, sign-in, phone or e-mail hold every word of ``q``."""

    def get(self, request):
        words = str(request.query_params.get("q") or "").split()[:4]
        if len("".join(words)) < 2:
            return Response([])
        people = User.objects.all()
        for word in words:
            people = people.filter(
                Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(username__icontains=word)
                | Q(phone_number__icontains=word) | Q(email__icontains=word)
            )
        return Response(_people(list(people.order_by("first_name", "last_name", "pk")[:20])))


class StudentsView(ToolboxView):
    """``POST students/`` {classroom_id, status: "trial"|"active", count: 1..5, first_payment}: test students (201)."""

    def post(self, request):
        data = _data(request)
        detail = {key: data.get(key) for key in ("classroom_id", "status", "count", "first_payment")}

        def work():
            users = tools.make_test_students(
                _room(data.get("classroom_id")), status=str(data.get("status") or ""), count=data.get("count", 1),
                first_payment=bool(data.get("first_payment")), by=request.user, today=_today(),
            )
            return {"students": _people(users)}, {"user_ids": [user.pk for user in users]}

        return _run(request, "students", detail, work, status=http.HTTP_201_CREATED)


class BalanceView(ToolboxView):
    """``POST balance/`` {user_id, target}: the balance made exactly ``target`` so'm (an adjustment noted "TEST: …")."""

    def post(self, request):
        data = _data(request)

        def work():
            user = _person(data.get("user_id"))
            balance = tools.set_balance(user, data.get("target"), by=request.user, today=_today())
            return {"user_id": user.pk, "balance": balance}, {"balance": balance}

        return _run(request, "balance", {"user_id": data.get("user_id"), "target": data.get("target")}, work)


class RegisterView(ToolboxView):
    """``POST register/`` {classroom_id, date?, mode: "present"|"some_absent"|"none"}: a group's register filled."""

    def post(self, request):
        data = _data(request)
        detail = {key: data.get(key) for key in ("classroom_id", "date", "mode")}

        def work():
            room = _room(data.get("classroom_id"))
            day = _day(data.get("date")) if data.get("date") else _today()
            result = tools.fill_register(room, day, str(data.get("mode") or ""), by=request.user)
            return result, {key: result[key] for key in ("session_id", "present", "absent")}

        return _run(request, "register", detail, work)


class TasksView(ToolboxView):
    """``GET tasks/``: the beat's schedule."""

    def get(self, request):
        return Response(tools.beat_tasks())


class TaskRunView(ToolboxView):
    """``POST tasks/run/`` {name}: that beat entry's task, run now in this process, and what it returned."""

    def post(self, request):
        name = str(_data(request).get("name") or "")

        def work():
            result = tools.run_task(name)
            return result, {"ok": result["ok"]}

        return _run(request, "task.run", {"name": name}, work)


class MessagesView(ToolboxView):
    """``GET messages/?channel=&q=&page=``: what the copy would have sent, 50 a page, newest first. ``q``'s words are
    looked for in who it was for, the subject and the text."""

    def get(self, request):
        params = request.query_params
        rows = CapturedMessage.objects.order_by("-created_at", "-id")
        channel = str(params.get("channel") or "")
        if channel:
            rows = rows.filter(channel=channel)
        for word in str(params.get("q") or "").split()[:4]:
            rows = rows.filter(Q(to__icontains=word) | Q(subject__icontains=word) | Q(body__icontains=word))
        count = rows.count()
        pages = max(1, math.ceil(count / PAGE_SIZE))
        page = min(max(1, _int(params.get("page")) or 1), pages)
        start = (page - 1) * PAGE_SIZE
        return Response({
            "count": count, "page": page, "pages": pages,
            "results": [
                {
                    "id": m.pk, "channel": m.channel, "to": m.to, "subject": m.subject, "body": m.body, "meta": m.meta,
                    "created_at": m.created_at,
                }
                for m in rows[start:start + PAGE_SIZE]
            ],
        })


class MessagesClearView(ToolboxView):
    """``POST messages/clear/``: every captured message deleted — the only rows the toolbox ever deletes."""

    def post(self, request):
        def work():
            deleted, _ = CapturedMessage.objects.all().delete()
            return {"deleted": deleted}, {"deleted": deleted}

        return _run(request, "messages.clear", {}, work)


class SignInLinkView(ToolboxView):
    """``POST sign-in-link/`` {user_id}: a link that opens that person's side as them, once, within ten minutes. Never
    for someone ranked as high as you, unless you are the owner (``tools.may_sign_in_as``)."""

    def post(self, request):
        data = _data(request)

        def work():
            user = _person(data.get("user_id"))
            if not tools.may_sign_in_as(request.user, user):
                raise tm.ToolboxRefused("Only the owner can sign in as someone ranked as high as you.", status=403)
            scheme, host = request.scheme, request.get_host()
            link = tools.sign_in_link(user, host_for=lambda side: tools.console_origin(scheme, host, side))
            return link, {"name": display_name(user), "expires_at": link["expires_at"].isoformat()}

        return _run(request, "sign_in_link", {"user_id": data.get("user_id")}, work)


class SignInView(ToolboxView):
    """``GET sign-in/<token>/`` (anyone, every host): the link's person signed in as the sign-in views sign anyone in,
    then sent home — "/" (the student and teacher sides) or "/ops" (staff). Refused when the link is used, more than ten
    minutes old or forged, the account is switched off, or the link is opened on another side's host."""

    authentication_classes = []
    permission_classes = []

    def get(self, request, token: str):
        from rest_framework_simplejwt.tokens import RefreshToken

        from users.auth_cookies import set_auth_cookies
        from users.models import RefreshSession
        from users.views import _console_refusal_for, _session_fingerprint

        try:
            user = tools.link_holder(token)
        except tm.ToolboxRefused as refused:
            return Response({"detail": str(refused)}, status=refused.status)
        # Only on the host the link was made for: a student's link opened on the admin host would otherwise replace
        # the admin's own sign-in there (the console rules below let a learner through on that host).
        if getattr(request, "lms_console", "") != tools.side_of(user):
            return Response({"detail": "Open this link on the site it was made for."}, status=http.HTTP_403_FORBIDDEN)
        refusal = _console_refusal_for(request, user)
        if refusal is not None:
            return refusal  # before the link is used up: it still works on the right host
        try:
            tools.use_link(token)
        except tm.ToolboxRefused as refused:
            return Response({"detail": str(refused)}, status=refused.status)
        refresh = RefreshToken.for_user(user)
        response = HttpResponseRedirect("/ops" if tools.side_of(user) == "admin" else "/")
        set_auth_cookies(
            response=response, request=request, access=str(refresh.access_token), refresh=str(refresh), remember_me=True
        )
        # Recorded like every other sign-in (desktop.views._signed_in), so "sign out everywhere" reaches it.
        try:
            ip, ua = _session_fingerprint(request)
            RefreshSession.objects.update_or_create(
                refresh_jti=str(refresh.get("jti") or ""),
                defaults={"user": user, "revoked_at": None, "ip": ip, "user_agent": ua},
            )
        except Exception:  # pragma: no cover - a missing session row must not undo a sign-in
            logger.exception("staging_sign_in_session_row_failed user_id=%s", user.pk)
        return response
