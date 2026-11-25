"""/api/staging/ — the test copy's toolbox (/ops/toolbox).

Anywhere but the copy every endpoint answers 404 (``staging.guard.toolbox_on``), before it asks who is calling. On the
copy the toolbox is for the owner, an admin or a superuser, and every POST is written to the action log
(``ToolboxAction``): who, when, what, and what came of it. The browser clock and a "Sign in as" link are the two things
anyone may open (the host guard lets them through on every host)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.http import Http404, HttpResponse
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
from .guard import toolbox_on
from .models import ToolboxAction
from .outbound import captured

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
