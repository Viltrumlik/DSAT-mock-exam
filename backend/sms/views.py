"""``/api/sms/admin/`` — the SMS panel in /ops (plan 2026-10-18-sms-ops-panel; the JSON is
``2026-10-18-sms-ops-panel-api.md``). super_admin, admin and Django superusers only.

Plain ``APIView``s, never ``.as_view({...})``: that form silently drops ``permission_classes`` in
this codebase and is how an admin endpoint once shipped as AllowAny.

Nothing here sends on its own: a campaign, "Send now" and a retry are queued to the same tasks the
beat runs, after the commit; only the test SMS goes out in the request (one SMS, and the admin is
waiting to see what eskiz said). eskiz is asked for its balance at most every BALANCE_TTL, and
never with a fresh login while its last login was refused — the account is shared with lc-up —
and by one request at a time (BALANCE_LOCK_KEY): ten admins opening the page ask once.

A body that is not a JSON object (a list, a string, null) is a 400 with code ``body``, never a 500.
"""

from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import date, datetime, time, timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Max, Prefetch, Q
from django.db.models.functions import Substr
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework import status as http
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from classes.capabilities import is_global_admin
from classes.models import Branch, Classroom, ClassroomMembership
from core.csv_download import csv_download_response
from lcup.conf import debt_freeze_day, debt_freeze_enabled
from lcup.phones import normalize_phone
from users.changelist import apply_search, facets, paginate, to_int
from users.models import User

from . import campaigns, conf
from . import debt_warnings as warnings
from . import eskiz, eskiz_templates, forecast, resend, stats, switchboard
from . import templates as T
from .delivery import RESENDABLE, deliver
from .models import EskizTemplate, SmsCampaign, SmsMessage, SmsSettings
from .operators import NAMES as OPERATOR_NAMES
from .operators import OTHER as OTHER_OPERATOR
from .operators import operator_of, operator_q

BALANCE_KEY = "sms:balance"
BALANCE_TTL = 5 * 60
#: Held while one request asks eskiz for the balance; the others answer from the cache, or null.
BALANCE_LOCK_KEY = "sms:balance-lock"
BALANCE_LOCK_TTL = 30
#: An unanswered balance is asked again sooner, but not on every page load.
BALANCE_ERROR_TTL = 60
CAMPAIGN_LIST_MAX = 200
STUDENT_PICKER_MAX = 20
USED_WINDOW_DAYS = 90
MESSAGE_SEARCH = [
    "phone", "text", "user__first_name", "user__last_name", "user__username", "user__lcup_student_link__name",
]
_iso_field = serializers.DateTimeField()


class IsGlobalAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and is_global_admin(request.user))


class _AdminView(APIView):
    permission_classes = [IsGlobalAdmin]


def _refused(code: str, detail: str, status=http.HTTP_400_BAD_REQUEST) -> Response:
    return Response({"detail": detail, "code": code}, status=status)


def _not_an_object(request) -> Response | None:
    """The refusal for a body that is not a JSON object; None when it is one (an empty body is ``{}``)."""
    if isinstance(request.data, dict):
        return None
    return _refused("body", "Send a JSON object.")


def _iso(value):
    """As DRF writes a datetime: ISO 8601 in the current time zone, with its offset."""
    return _iso_field.to_representation(value) if value else None


def _name(user) -> str:
    if user is None:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.username or ""


def _on_commit(fn) -> None:
    # robust: a broker hiccup must not turn a committed request into a 500.
    transaction.on_commit(fn, robust=True)


# ── rows ──────────────────────────────────────────────────────────────────


_SOURCE_LABELS = {SmsMessage.KIND_DEBT_WARNING: "Debt warning", SmsMessage.KIND_TEST: "Test"}


def _source(msg, campaign_labels) -> dict:
    if msg.campaign_id:
        label = f"Campaign #{msg.campaign_id}"
        if msg.campaign_id in campaign_labels:
            label += f" · {campaign_labels[msg.campaign_id]}"
        return {"type": SmsMessage.KIND_CAMPAIGN, "id": msg.campaign_id, "label": label}
    return {"type": msg.kind, "id": None, "label": _SOURCE_LABELS.get(msg.kind, msg.kind)}


def _groups(msg) -> list[str]:
    """The student's active classes now (``_messages`` prefetches them as ``active_seats``)."""
    if not msg.user_id:
        return []
    seats = getattr(msg.user, "active_seats", None)
    if seats is None:
        seats = _active_seats().filter(user_id=msg.user_id)
    return [seat.classroom.name for seat in seats]


def _cost(msg) -> int:
    if msg.status not in stats.CHARGED:
        return 0
    return (msg.parts or T.parts(msg.text)) * (msg.unit_price or switchboard.price_per_part())


def _aliases(template_ids) -> dict[int, str]:
    """The panel's names of these templates, for ``_template_label``: one query."""
    ids = {pk for pk in template_ids if pk}
    if not ids:
        return {}
    return dict(EskizTemplate.objects.filter(eskiz_id__in=ids).exclude(alias="").values_list("eskiz_id", "alias"))


def _template_label(template_id, aliases) -> str:
    if not template_id:
        return ""
    return aliases.get(template_id) or f"#{template_id}"


def message_rows(msgs) -> list[dict]:
    """``message_row`` for each: the campaigns' audience labels, the templates' names and the debt
    warning's switch asked once."""
    msgs = list(msgs)
    campaign_ids = {m.campaign_id for m in msgs if m.campaign_id}
    labels = campaigns.audience_labels(SmsCampaign.objects.filter(pk__in=campaign_ids)) if campaign_ids else {}
    aliases = _aliases(m.template_eskiz_id for m in msgs)
    today, debt_on = timezone.localdate(), warnings.switched_on()
    return [
        message_row(m, labels, aliases, can_resend=resend.refusal(m, today, debt_on=debt_on) is None) for m in msgs
    ]


def message_row(msg, campaign_labels=None, aliases=None, *, can_resend=None) -> dict:
    if can_resend is None:
        can_resend = resend.refusal(msg, timezone.localdate()) is None
    if aliases is None:
        aliases = _aliases([msg.template_eskiz_id])
    return {
        "id": msg.pk,
        "created_at": _iso(msg.created_at),
        "sent_at": _iso(msg.sent_at),
        "kind": msg.kind,
        "status": msg.status,
        "eskiz_status": msg.eskiz_status,
        "phone": msg.phone,
        "text": msg.text,
        # eskiz's own count once it has reported; until then the GSM/UCS-2 arithmetic.
        "parts": msg.parts or T.parts(msg.text),
        "request_id": msg.request_id,
        "error": msg.error,
        "user": {"id": msg.user_id, "name": _name(msg.user)} if msg.user_id else None,
        "lcup_student_id": msg.lcup_student_id,
        "campaign_id": msg.campaign_id,
        "created_by_name": _name(msg.created_by),
        "attempts": msg.attempts,
        "checked_at": _iso(msg.checked_at),
        "operator": operator_of(msg.phone),
        "groups": _groups(msg),
        "source": _source(msg, campaign_labels or {}),
        "template": {
            "id": msg.template_eskiz_id,
            "label": _template_label(msg.template_eskiz_id, aliases),
        },
        "cost": _cost(msg),
        # Whether Resend may take it now (``resend.refusal``): a debt warning only on its own day.
        "can_resend": can_resend,
    }


def _active_seats():
    return (
        ClassroomMembership.objects.filter(
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE, classroom__is_active=True,
        )
        .select_related("classroom")
        .order_by("classroom__name", "classroom_id")
    )


def _messages(qs):
    return qs.select_related("user", "created_by").prefetch_related(
        Prefetch("user__class_memberships", queryset=_active_seats(), to_attr="active_seats")
    )


def campaign_row(campaign, labels, live) -> dict:
    return {
        "id": campaign.pk,
        "status": campaign.status,
        "template_eskiz_id": campaign.template_eskiz_id,
        "pattern": campaign.pattern,
        "original": campaign.original,
        "slot_roles": campaign.slot_roles,
        "slot_texts": campaign.slot_texts,
        "audience": campaign.audience,
        "audience_ids": campaign.audience_ids,
        "audience_label": labels[campaign.pk],
        "audience_filter": campaign.audience_filter,
        "excluded_user_ids": campaign.excluded_user_ids,
        "scheduled_at": _iso(campaign.scheduled_at),
        "created_at": _iso(campaign.created_at),
        "started_at": _iso(campaign.started_at),
        "finished_at": _iso(campaign.finished_at),
        "created_by_name": _name(campaign.created_by),
        "error": campaign.error,
        "result": {**campaigns.EMPTY_RESULT, **(campaign.result or {}), **live[campaign.pk]},
    }


def _campaign_rows(items) -> list[dict]:
    items = list(items)
    labels = campaigns.audience_labels(items)
    live = campaigns.live_counts([c.pk for c in items])
    return [campaign_row(c, labels, live) for c in items]


def _template_usage(**only) -> dict[int, tuple[int, object]]:
    """``{eskiz_id: (messages in the last USED_WINDOW_DAYS, the newest one's time)}``: one grouped query."""
    rows = (
        SmsMessage.objects.filter(created_at__gte=timezone.now() - timedelta(days=USED_WINDOW_DAYS), **only)
        .exclude(template_eskiz_id=None)
        .values("template_eskiz_id")
        .annotate(n=Count("id"), last=Max("created_at"))
        .order_by()
    )
    return {r["template_eskiz_id"]: (r["n"], r["last"]) for r in rows}


def template_row(row, usage=None) -> dict:
    text = row.pattern or row.original
    used_count, last_used_at = (usage or {}).get(row.eskiz_id, (0, None))
    return {
        "eskiz_id": row.eskiz_id,
        "alias": row.alias,
        "label": row.label,
        "used_count": used_count,
        "last_used_at": _iso(last_used_at),
        "status": row.status,
        "pattern": row.pattern,
        "original": row.original,
        "slots": T.slots(row.pattern),
        "guessed_roles": T.guess_roles(row.original, row.pattern),
        "parts": T.parts(text),
        "ascii": T.is_gsm_safe(text),
        "usable": row.usable,
        "synced_at": _iso(row.synced_at),
        "submitted_by_name": _name(row.submitted_by),
        "submitted_at": _iso(row.submitted_at),
    }


def settings_row(row: SmsSettings) -> dict:
    return {
        "debt_enabled": row.debt_enabled,
        "debt_hour": row.debt_hour,
        "warning_template_id": row.warning_template_id,
        "warning_pattern": row.warning_pattern,
        "warning_slots": row.warning_slots,
        "last_day_template_id": row.last_day_template_id,
        "last_day_pattern": row.last_day_pattern,
        "last_day_slots": row.last_day_slots,
        "updated_at": _iso(row.updated_at),
        "updated_by_name": _name(row.updated_by),
        "env_enabled": switchboard.env_enabled(),
        "freeze_enabled": debt_freeze_enabled(),
        "freeze_day": debt_freeze_day(),
    }


# ── overview ──────────────────────────────────────────────────────────────


def _balance():
    """eskiz's balance, cached BALANCE_TTL; None when it could not be asked. Never a login just for
    this while eskiz's last login was refused."""
    if not conf.is_configured():
        return None
    cached = cache.get(BALANCE_KEY)
    if cached is not None:
        return cached["balance"]
    if not cache.get(eskiz.TOKEN_KEY) and cache.get(eskiz.LOGIN_REFUSED_KEY):
        return None
    if not cache.add(BALANCE_LOCK_KEY, 1, BALANCE_LOCK_TTL):
        # Another request is asking eskiz right now; it may have answered while we looked.
        cached = cache.get(BALANCE_KEY)
        return cached["balance"] if cached is not None else None
    try:
        try:
            balance = eskiz.default_client().balance()
        except eskiz.EskizError:
            balance = None
        cache.set(BALANCE_KEY, {"balance": balance}, timeout=BALANCE_TTL if balance is not None else BALANCE_ERROR_TTL)
    finally:
        cache.delete(BALANCE_LOCK_KEY)
    return balance


def _by_status(qs) -> dict:
    counts = dict(Counter(qs.values_list("status", flat=True)))
    return {"total": sum(counts.values()), "by_status": counts}


def _today():
    return timezone.localdate()


def _done_keys(day) -> set:
    """The debt warnings that day's runs already did: a key with a row that is not FAILED never goes again."""
    return set(
        SmsMessage.objects.filter(kind=SmsMessage.KIND_DEBT_WARNING, run_on=day)
        .exclude(status=SmsMessage.STATUS_FAILED)
        .values_list("dedupe_key", flat=True)
    )


def _start_of_today(now):
    return timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)


class OverviewView(_AdminView):
    def get(self, request):
        now = timezone.now()
        row = switchboard.current()
        # The next run that will really happen: today while a warning day still has someone left to
        # warn, else the warning day after it; none while the warning cannot run at all (switched off
        # here, in the env, or the freeze itself off). 2026-11-01 showed why "left": after all 195
        # had gone, the card still read "Next: 1 Nov · 195 students".
        today, next_day, today_sent, today_left = _today(), None, 0, 0
        if warnings.switched_on():
            next_day = warnings.next_warning_day(today)
            if next_day == today:
                done = _done_keys(today)
                today_sent = len(done)
                today_left = sum(1 for w in warnings.plan(now, today=today).warnings if w.dedupe_key not in done)
                if not today_left:
                    next_day = warnings.following_warning_day(today)
        next_count = len(warnings.plan(now, today=next_day).warnings) if next_day else 0
        last_error = (
            SmsMessage.objects.exclude(error="").order_by("-updated_at", "-id").values_list("error", flat=True).first()
        )
        env_on, db_on, freeze_on = switchboard.env_enabled(), row.debt_enabled, debt_freeze_enabled()
        balance = _balance()
        need = forecast.need_next_24h(now)
        month = stats.summary(timezone.localdate().replace(day=1), timezone.localdate())["totals"]
        return Response({
            "configured": conf.is_configured(),
            "balance": balance,
            "forecast": {**need, "balance": balance, "short": balance is not None and balance < need["total"]},
            "month": {"sent": month["sent"], "rate": month["rate"], "cost": month["cost"]},
            "price_per_part": switchboard.price_per_part(),
            "sender": conf.credentials()["sender"],
            "eskiz": {
                "token_cached": bool(cache.get(eskiz.TOKEN_KEY)),
                "login_refused": bool(cache.get(eskiz.LOGIN_REFUSED_KEY)),
                "last_error": last_error or "",
            },
            "debt": {
                "enabled": env_on and db_on and freeze_on,
                "env_enabled": env_on,
                "db_enabled": db_on,
                "freeze_enabled": freeze_on,
                "hour": row.debt_hour,
                "next_day": next_day.isoformat() if next_day else None,
                "next_count": next_count,
                "today_sent": today_sent,
                "today_left": today_left,
            },
            "today": _by_status(SmsMessage.objects.filter(created_at__gte=_start_of_today(now))),
            "last7": _by_status(SmsMessage.objects.filter(created_at__gte=now - timedelta(days=7))),
        })


class StatsView(_AdminView):
    """Delivery, cost and the debt warning's effect over ``from``..``to`` (``stats``); with
    ``campaign``, only that campaign's messages, and no debt warning's effect."""

    def get(self, request):
        params = request.query_params
        try:
            start, end = stats.parse_range(params.get("from"), params.get("to"), today=timezone.localdate())
        except ValueError as exc:
            return _refused("range", str(exc))
        if campaign := params.get("campaign"):
            if not campaign.isdecimal():
                return _refused("range", "A campaign is its id.")
            return Response({
                "from": start.isoformat(),
                "to": end.isoformat(),
                **stats.summary(start, end, qs=SmsMessage.objects.filter(campaign_id=int(campaign))),
                "debt_effect": [],
            })
        return Response({
            "from": start.isoformat(),
            "to": end.isoformat(),
            **stats.summary(start, end),
            "debt_effect": stats.debt_effect(3, today=end),
        })


# ── the journal ───────────────────────────────────────────────────────────


def _when_q(value):
    now = timezone.now()
    since = {"today": _start_of_today(now), "7d": now - timedelta(days=7), "30d": now - timedelta(days=30)}.get(value)
    return Q(created_at__gte=since) if since else None


def _fixed(qs, choices, to_q):
    return [(value, label, qs.filter(to_q(value)).count()) for value, label in choices]


_KINDS = dict(SmsMessage.KIND_CHOICES)
_STATUSES = dict(SmsMessage.STATUS_CHOICES)
_WHEN = (("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days"))
MESSAGE_FILTERS = {
    "kind": (
        "Kind",
        lambda qs: _fixed(qs, SmsMessage.KIND_CHOICES, lambda v: Q(kind=v)),
        lambda v: Q(kind=v) if v in _KINDS else None,
    ),
    "status": (
        "Status",
        lambda qs: _fixed(qs, SmsMessage.STATUS_CHOICES, lambda v: Q(status=v)),
        lambda v: Q(status=v) if v in _STATUSES else None,
    ),
    "when": ("When", lambda qs: _fixed(qs, _WHEN, _when_q), _when_q),
}

#: A message whose student holds an active seat now; the joins of one filter() call stay one row each.
_SEAT = {
    "user__class_memberships__role": ClassroomMembership.ROLE_STUDENT,
    "user__class_memberships__status": ClassroomMembership.STATUS_ACTIVE,
    "user__class_memberships__classroom__is_active": True,
}


def _seat_users(**where):
    return _active_seats().filter(**where).values("user_id")


def _by_id(to_q):
    """A to_q for an integer value; anything else is not a filter."""
    def q(value):
        number = to_int(value)
        return to_q(number) if number is not None else None
    return q


def _operator_choices(qs):
    tally = Counter()
    for row in qs.annotate(code=Substr("phone", 4, 2)).values("code").annotate(n=Count("id")).order_by():
        tally[operator_of(f"998{row['code']}")] += row["n"]
    return [(name, name, tally[name]) for name in (*OPERATOR_NAMES, OTHER_OPERATOR) if tally[name]]


def _group_choices(qs):
    rows = (
        qs.filter(**_SEAT)
        .values("user__class_memberships__classroom_id", "user__class_memberships__classroom__name")
        .annotate(n=Count("id", distinct=True))
        .order_by("user__class_memberships__classroom__name")
    )
    return [
        (str(r["user__class_memberships__classroom_id"]), r["user__class_memberships__classroom__name"], r["n"])
        for r in rows
    ]


def _teacher_choices(qs):
    rows = list(
        qs.filter(**_SEAT, user__class_memberships__classroom__teacher__isnull=False)
        .values("user__class_memberships__classroom__teacher_id")
        .annotate(n=Count("id", distinct=True))
        .order_by()
    )
    people = User.objects.in_bulk([r["user__class_memberships__classroom__teacher_id"] for r in rows])
    choices = [
        (str(pk), _name(people.get(pk)), r["n"])
        for r in rows
        if (pk := r["user__class_memberships__classroom__teacher_id"]) in people
    ]
    return sorted(choices, key=lambda c: c[1].lower())


def _template_choices(qs):
    rows = list(
        qs.exclude(template_eskiz_id=None).values("template_eskiz_id").annotate(n=Count("id")).order_by("template_eskiz_id")
    )
    aliases = _aliases(r["template_eskiz_id"] for r in rows)
    return [(str(r["template_eskiz_id"]), _template_label(r["template_eskiz_id"], aliases), r["n"]) for r in rows]


def _campaign_choices(qs):
    rows = list(qs.exclude(campaign=None).values("campaign_id").annotate(n=Count("id")).order_by("-campaign_id"))
    labels = campaigns.audience_labels(SmsCampaign.objects.filter(pk__in=[r["campaign_id"] for r in rows]))
    return [(str(r["campaign_id"]), f"#{r['campaign_id']} · {labels.get(r['campaign_id'], '')}", r["n"]) for r in rows]


MESSAGE_FILTERS.update({
    "operator": ("Operator", _operator_choices, operator_q),
    "group": ("Group", _group_choices, _by_id(lambda pk: Q(user_id__in=_seat_users(classroom_id=pk)))),
    "teacher": ("Teacher", _teacher_choices, _by_id(lambda pk: Q(user_id__in=_seat_users(classroom__teacher_id=pk)))),
    "template": ("Template", _template_choices, _by_id(lambda pk: Q(template_eskiz_id=pk))),
    "campaign": ("Campaign", _campaign_choices, _by_id(lambda pk: Q(campaign_id=pk))),
})


def _day(raw):
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def _date_range_q(params) -> Q:
    """``from``/``to``: Tashkent days, inclusive; a date that cannot be read is ignored, like any filter value."""
    q, start, end = Q(), _day(params.get("from")), _day(params.get("to"))
    if start:
        q &= Q(created_at__gte=timezone.make_aware(datetime.combine(start, time.min)))
    if end:
        q &= Q(created_at__lt=timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min)))
    return q


def _journal(params):
    """(the journal's rows as the address filters them, newest first; the filters payload)."""
    qs = apply_search(SmsMessage.objects.all(), params.get("q") or "", MESSAGE_SEARCH).filter(_date_range_q(params))
    if params.get("resendable") == "1":  # the overview's "did not arrive" list: every status Resend may take
        qs = qs.filter(status__in=RESENDABLE)
    qs, filters = facets(qs, MESSAGE_FILTERS, params)
    return qs.order_by("-created_at", "-id"), filters


class MessageListView(_AdminView):
    def get(self, request):
        params = request.query_params
        qs, filters = _journal(params)
        window, meta = paginate(_messages(qs), params)
        return Response({
            **meta,
            "results": message_rows(window),
            "filters": filters,
        })


#: The most rows one export writes (a year of every SMS is far below it).
EXPORT_MAX = 50_000
EXPORT_CHUNK = 2_000
EXPORT_COLUMNS = ("Date", "Name", "Phone", "Groups", "Operator", "Kind", "Source", "Template", "Status", "Reason",
                  "Parts", "Cost", "Text")
_OPERATOR_REJECTED = frozenset({"REJECTED", "REJECTD"})


def _reason(msg) -> str:
    """Why it stands where it does, in the words the panel uses (frontend ``reasonOf``)."""
    eskiz_status = (msg.eskiz_status or "").upper()
    if msg.status == SmsMessage.STATUS_DELIVERED:
        text = "Delivered"
    elif msg.status == SmsMessage.STATUS_UNDELIVERED:
        if eskiz_status in _OPERATOR_REJECTED:
            text = "Operator rejected"
        elif eskiz_status == "EXPIRED":
            text = "Phone off or out of reach"
        else:
            text = "Not delivered"
    elif msg.status == SmsMessage.STATUS_REJECTED:
        text = "Forbidden word" if "forbidden" in (msg.error or "").lower() else "eskiz refused"
    elif msg.status == SmsMessage.STATUS_FAILED:
        text = "No balance on eskiz" if eskiz.no_balance(msg.error) else "eskiz not reached"
    elif msg.status == SmsMessage.STATUS_UNCERTAIN:
        text = "Unknown — may have gone"
    else:
        text = "Waiting for the operator"
    return f"{text} · try {msg.attempts}" if msg.attempts > 1 else text


class MessageExportView(_AdminView):
    """The journal as the address filters it — every page, at most EXPORT_MAX rows — as a CSV Excel opens."""

    def get(self, request):
        qs, _ = _journal(request.query_params)
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(EXPORT_COLUMNS)
        for start in range(0, EXPORT_MAX, EXPORT_CHUNK):
            chunk = list(_messages(qs)[start: start + EXPORT_CHUNK])
            if not chunk:
                break
            labels = {}
            ids = {m.campaign_id for m in chunk if m.campaign_id}
            if ids:
                labels = campaigns.audience_labels(SmsCampaign.objects.filter(pk__in=ids))
            aliases = _aliases(m.template_eskiz_id for m in chunk)
            for msg in chunk:
                writer.writerow([
                    timezone.localtime(msg.created_at).strftime("%Y-%m-%d %H:%M"),
                    _name(msg.user),
                    msg.phone,
                    "; ".join(_groups(msg)),
                    operator_of(msg.phone),
                    _KINDS.get(msg.kind, msg.kind),
                    _source(msg, labels)["label"],
                    _template_label(msg.template_eskiz_id, aliases),
                    msg.status,
                    _reason(msg),
                    msg.parts or T.parts(msg.text),
                    _cost(msg),
                    msg.text,
                ])
        return csv_download_response(out.getvalue(), f"sms-journal-{timezone.localdate().isoformat()}")


RESEND_MAX = 300


def _queue_resend(ids: list[int]):
    def queue():
        from . import tasks

        tasks.resend_messages.delay(ids)

    return queue


class ResendView(_AdminView):
    """POST ``{"ids": [...]}``: those that may go again now (``resend.refusal``) are queued; the rest are named back."""

    def post(self, request):
        refused = _not_an_object(request)
        if refused:
            return refused
        ids = campaigns._ints(request.data.get("ids"))
        if not ids or len(ids) > RESEND_MAX:
            return _refused("ids", f"Send 1 to {RESEND_MAX} message ids.")
        today = timezone.localdate()
        resendable = {
            m.pk for m in SmsMessage.objects.filter(pk__in=ids, status__in=RESENDABLE) if resend.refusal(m, today) is None
        }
        queued = [pk for pk in ids if pk in resendable]
        if queued:
            _on_commit(_queue_resend(queued))
        return Response({"queued": queued, "not_resendable": [pk for pk in ids if pk not in resendable]})


STUDENT_MESSAGES_MAX = 200


class StudentMessagesView(_AdminView):
    """One student's SMS, newest first (the person page's SMS tab), with a count by status of all of them."""

    def get(self, request, user_id):
        qs = SmsMessage.objects.filter(user_id=user_id)
        summary = dict(Counter(qs.values_list("status", flat=True)))
        rows = _messages(qs.order_by("-created_at", "-id"))[:STUDENT_MESSAGES_MAX]
        return Response({"summary": summary, "results": message_rows(rows)})


# ── campaigns ─────────────────────────────────────────────────────────────


def _campaign_refused(exc: campaigns.CampaignRefused) -> Response:
    return _refused(exc.code, exc.message)


def _queue_retry(pk: int, only_failed: bool):
    def queue():
        from . import tasks

        tasks.retry_campaign.delay(pk, only_failed=only_failed)

    return queue


class CampaignListView(_AdminView):
    def get(self, request):
        items = SmsCampaign.objects.select_related("created_by").order_by("-created_at", "-id")[:CAMPAIGN_LIST_MAX]
        return Response({"campaigns": _campaign_rows(items)})

    def post(self, request):
        if refused := _not_an_object(request):
            return refused
        try:
            campaign = campaigns.create(request.data, request.user)
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)
        return Response({"campaign": _campaign_rows([campaign])[0]}, status=http.HTTP_201_CREATED)


class CampaignPreviewView(_AdminView):
    def post(self, request):
        if refused := _not_an_object(request):
            return refused
        try:
            return Response(campaigns.preview(request.data))
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)


def _campaign(pk):
    return get_object_or_404(SmsCampaign.objects.select_related("created_by"), pk=pk)


class CampaignDetailView(_AdminView):
    def get(self, request, pk):
        campaign = _campaign(pk)
        messages = _messages(campaign.messages.order_by("id"))
        return Response({"campaign": _campaign_rows([campaign])[0], "messages": message_rows(messages)})


class CampaignCancelView(_AdminView):
    def post(self, request, pk):
        campaign = _campaign(pk)
        try:
            campaigns.cancel(campaign)
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)
        return Response({"campaign": _campaign_rows([campaign])[0]})


class CampaignRetryView(_AdminView):
    """Retry, for a DONE or a stopped (FAILED) campaign: claimed SENDING here, at once (a second
    click is refused), then sent by the queued task — the FAILED sent again, nothing that may have
    left, and for a stopped campaign the never-reached too."""

    def post(self, request, pk):
        campaign = _campaign(pk)
        try:
            campaigns.check_retryable(campaign)
            if not conf.is_configured():
                return _refused("not_configured", "eskiz is not configured on the server.")
            only_failed = campaign.status == SmsCampaign.STATUS_DONE  # ``retry`` claims it SENDING
            queued = campaigns.retry(campaign)
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)
        _on_commit(_queue_retry(campaign.pk, only_failed))
        return Response({"queued": queued})


# ── the debt warning's settings ───────────────────────────────────────────


class SettingsRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _debt_slots(pattern, raw) -> list[str]:
    slots = T.slots(pattern)
    if not isinstance(raw, list) or len(raw) != len(slots) or any(r not in switchboard.DEBT_ROLES for r in raw):
        raise SettingsRefused(
            "slots", f"Choose student or debt for each of the template's {len(slots)} slots: a warning types nothing in."
        )
    for number, (role, slot) in enumerate(zip(raw, slots), 1):
        if role == T.ROLE_STUDENT and slot["kind"] == "d":
            raise SettingsRefused("slots", f"Slot {number} takes a number: it cannot hold a name.")
    return list(raw)


def _apply_template(row, prefix, data) -> list[str]:
    """``warning`` / ``last_day``: the template id and slots sent (or kept), checked, onto ``row``."""
    id_key, slots_key = f"{prefix}_template_id", f"{prefix}_slots"
    if id_key not in data and slots_key not in data:
        return []
    if id_key in data:
        raw = data.get(id_key)
        template = None
        if not isinstance(raw, bool):
            try:
                template = EskizTemplate.objects.filter(eskiz_id=int(raw)).first()
            except (TypeError, ValueError):
                template = None
        if template is None or not template.usable or not template.pattern:
            raise SettingsRefused("template", "Pick a template eskiz has approved (service or ad price).")
        setattr(row, id_key, template.eskiz_id)
        setattr(row, f"{prefix}_pattern", template.pattern)
    pattern = getattr(row, f"{prefix}_pattern")
    setattr(row, slots_key, _debt_slots(pattern, data.get(slots_key, getattr(row, slots_key))))
    return [id_key, f"{prefix}_pattern", slots_key]


class SettingsView(_AdminView):
    def get(self, request):
        return Response(settings_row(switchboard.current()))

    def patch(self, request):
        if refused := _not_an_object(request):
            return refused
        data = request.data
        row = switchboard.current()
        changed = []
        try:
            if "debt_enabled" in data:
                if not isinstance(data["debt_enabled"], bool):
                    raise SettingsRefused("enabled", "debt_enabled is true or false.")
                row.debt_enabled = data["debt_enabled"]
                changed.append("debt_enabled")
            if "debt_hour" in data:
                hour = data["debt_hour"]
                if isinstance(hour, bool) or not isinstance(hour, int) or not 8 <= hour <= 20:
                    raise SettingsRefused("hour", "The hour is a whole number from 8 to 20.")
                row.debt_hour = hour
                changed.append("debt_hour")
            changed += _apply_template(row, "warning", data)
            changed += _apply_template(row, "last_day", data)
        except SettingsRefused as exc:
            return _refused(exc.code, exc.message)
        if changed:
            row.updated_by, row.updated_at = request.user, timezone.now()
            row.save(update_fields=[*changed, "updated_by", "updated_at"])
        return Response(settings_row(row))


# ── the debt warning ──────────────────────────────────────────────────────


class DebtPreviewView(_AdminView):
    def get(self, request):
        now = timezone.now()
        raw = (request.query_params.get("day") or "").strip()
        if raw:
            try:
                day = date.fromisoformat(raw)
            except ValueError:
                return _refused("day", "day is YYYY-MM-DD.")
        else:
            day = warnings.next_warning_day(_today()) or _today()
        planned = warnings.plan(now, today=day)
        out = _done_keys(day)
        rows = [
            {
                "lcup_student_id": w.link.lcup_student_id,
                "name": w.link.name,
                "phone": w.phone,
                "debt": int(abs(w.link.balance)),
                "text": w.text,
                "parts": T.parts(w.text),
            }
            for w in planned.warnings
        ]
        left = [r for r, w in zip(rows, planned.warnings) if w.dedupe_key not in out]
        return Response({
            "day": day.isoformat(),
            "is_last_day": warnings.is_last_day(day),
            "blocked": planned.blocked,
            "skipped": planned.skipped,
            "count": len(rows),
            "sent_today": len(out),
            "to_send": len(left),
            "cost": sum(r["parts"] for r in left) * switchboard.price_per_part(),
            "warnings": rows,
        })


def _queue_send_now():
    from . import tasks

    tasks.debt_warnings_now.delay()


class DebtSendNowView(_AdminView):
    def post(self, request):
        if not warnings.switched_on():
            return _refused("disabled", "The debt warning is switched off (here, in the server's settings or the freeze).")
        if not warnings.is_warning_day(_today()):
            return _refused("not_a_warning_day", f"Warnings go out on days 1 to {debt_freeze_day() - 1} only.")
        if not conf.is_configured():
            return _refused("not_configured", "eskiz is not configured on the server.")
        _on_commit(_queue_send_now)
        return Response({"queued": True}, status=http.HTTP_202_ACCEPTED)


class DebtRunsView(_AdminView):
    def get(self, request):
        return Response({"runs": warnings.runs()})


# ── templates ─────────────────────────────────────────────────────────────


class TemplateListView(_AdminView):
    def get(self, request):
        usage = _template_usage()
        rows = sorted(
            EskizTemplate.objects.select_related("submitted_by"),
            key=lambda t: (not t.usable, -usage.get(t.eskiz_id, (0,))[0], -t.eskiz_id),
        )
        synced_at = EskizTemplate.objects.aggregate(last=Max("synced_at"))["last"]
        return Response({"templates": [template_row(t, usage) for t in rows], "synced_at": _iso(synced_at)})

    def post(self, request):
        if refused := _not_an_object(request):
            return refused
        try:
            row, counts = eskiz_templates.submit(eskiz.default_client(), request.data.get("text"), request.user)
        except eskiz_templates.TemplateRefused as exc:
            return _refused(exc.code, exc.message)
        return Response({"template": template_row(row) if row else None, "sync": counts}, status=http.HTTP_201_CREATED)


class TemplateDetailView(_AdminView):
    def patch(self, request, eskiz_id):
        if refused := _not_an_object(request):
            return refused
        row = get_object_or_404(EskizTemplate.objects.select_related("submitted_by"), eskiz_id=eskiz_id)
        alias = request.data.get("alias")
        max_length = EskizTemplate._meta.get_field("alias").max_length
        if not isinstance(alias, str) or len(alias.strip()) > max_length:
            return _refused("alias", f"A template's name is text of at most {max_length} characters.")
        row.alias = alias.strip()
        row.save(update_fields=["alias"])
        return Response({"template": template_row(row, _template_usage(template_eskiz_id=row.eskiz_id))})


class TemplateSyncView(_AdminView):
    def post(self, request):
        try:
            return Response(eskiz_templates.sync(eskiz.default_client()))
        except eskiz.EskizError as exc:
            return _refused("eskiz", str(exc))


# ── a test SMS ────────────────────────────────────────────────────────────

def _sample_text(template, texts) -> str:
    """The template filled as the panel's test form shows it: each slot by its guessed role, the
    student and debt from ``templates.SAMPLE_VALUES`` ("Test Testov,", 100000), a text slot typed."""
    roles = T.guess_roles(template.original, template.pattern)
    roles, texts = campaigns.clean_slots(template.pattern, roles, texts)
    sample = {T.ROLE_STUDENT: T.SAMPLE_VALUES["student"], T.ROLE_DEBT: T.SAMPLE_VALUES["debt"]}
    values = {f"s{i}": text if role == T.ROLE_TEXT else sample[role] for i, (role, text) in enumerate(zip(roles, texts))}
    return T.render(T.SmsTemplate("test", template.pattern, tuple(values)), values)


class TestSmsView(_AdminView):
    """One SMS to the phone typed, logged as a test. ``slot_texts`` has one entry per slot; only the
    ``text`` slots' are used (the client sends "" for the rest).

    The same phone and template once a minute (Tashkent): the key is
    ``test:<phone>:<template>:<YYYYmmddHHMM>``, so a double click — or a retried request — finds
    the first one's row and sends nothing (``duplicate``); one that never left (FAILED) may go again."""

    def post(self, request):
        if refused := _not_an_object(request):
            return refused
        data = request.data
        phone = normalize_phone(data.get("phone"))
        if not phone:
            return _refused("phone", "Not an Uzbek phone number (998XXXXXXXXX).")
        try:
            template = campaigns.usable_template(data.get("template_id"))
        except campaigns.CampaignRefused as exc:
            return _refused(exc.code, exc.message)
        texts = data.get("slot_texts")
        if texts is None:
            texts = [""] * len(T.slots(template.pattern))
        try:
            text = _sample_text(template, texts)
        except campaigns.CampaignRefused as exc:
            return _refused(exc.code, exc.message)
        except T.TemplateError as exc:
            return _refused("slots", str(exc))
        if not conf.is_configured():
            return _refused("not_configured", "eskiz is not configured on the server.")
        now = timezone.localtime(timezone.now())
        msg = deliver(
            eskiz.default_client(), kind=SmsMessage.KIND_TEST, run_on=now.date(),
            dedupe_key=f"test:{phone}:{template.eskiz_id}:{now:%Y%m%d%H%M}", phone=phone, text=text,
            created_by=request.user, template_eskiz_id=template.eskiz_id,
        )
        if msg is None:
            return _refused("duplicate", "This test SMS was just sent: check the journal before sending it again.")
        return Response({"message": message_row(SmsMessage.objects.select_related("user", "created_by").get(pk=msg.pk))})


# ── audience pickers ──────────────────────────────────────────────────────


class AudienceClassroomsView(_AdminView):
    def get(self, request):
        seats = ClassroomMembership.objects.filter(
            classroom__is_active=True, role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        ).values_list("classroom_id", "user__lcup_student_link__phone")
        students, with_phone = Counter(), Counter()
        for room_id, phone in seats:
            students[room_id] += 1
            with_phone[room_id] += bool(normalize_phone(phone))
        rooms = Classroom.objects.filter(is_active=True).order_by("name", "pk").values_list("pk", "name")
        return Response({
            "classrooms": [
                {"id": pk, "name": name, "students": students[pk], "with_phone": with_phone[pk]} for pk, name in rooms
            ]
        })


def _class_counts(field) -> dict:
    rows = Classroom.objects.filter(is_active=True).values_list(field).annotate(n=Count("id")).order_by()
    return dict(rows)


def _options(choices, counts) -> list[dict]:
    return [{"value": value, "label": label, "classes": counts[value]} for value, label in choices if counts.get(value)]


class AudienceOptionsView(_AdminView):
    """What a filter audience can choose from: only values some active class has, with how many."""

    def get(self, request):
        branches = _class_counts("branch_id")
        names = Branch.objects.filter(pk__in=[pk for pk in branches if pk]).order_by("name", "pk").values_list("pk", "name")
        return Response({
            "subjects": _options(Classroom.SUBJECT_CHOICES, _class_counts("subject")),
            "levels": _options(Classroom.LEVEL_CHOICES, _class_counts("level")),
            "branches": _options(names, branches),
            "days": _options(Classroom.DAYS_CHOICES, _class_counts("lesson_days")),
        })


class AudiencePreviewView(_AdminView):
    def post(self, request):
        if refused := _not_an_object(request):
            return refused
        try:
            return Response(campaigns.audience_preview(request.data))
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)


class AudienceStudentsView(_AdminView):
    def get(self, request):
        qs = User.objects.filter(role__in=C.LEARNER_ROLES, lcup_student_link__isnull=False)
        qs = apply_search(
            qs, request.query_params.get("q") or "", ["first_name", "last_name", "username", "lcup_student_link__name"]
        )
        users = qs.select_related("lcup_student_link").order_by("first_name", "last_name", "pk")[:STUDENT_PICKER_MAX]
        return Response({
            "students": [
                {
                    "id": u.pk,
                    "name": _name(u),
                    "lcup_name": u.lcup_student_link.name,
                    "phone": normalize_phone(u.lcup_student_link.phone) or "",
                    "balance": None if u.lcup_student_link.balance is None else int(u.lcup_student_link.balance),
                }
                for u in users
            ]
        })
