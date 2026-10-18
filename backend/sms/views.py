"""``/api/sms/admin/`` — the SMS panel in /ops (plan 2026-10-18-sms-ops-panel; the JSON is
``2026-10-18-sms-ops-panel-api.md``). super_admin, admin and Django superusers only.

Plain ``APIView``s, never ``.as_view({...})``: that form silently drops ``permission_classes`` in
this codebase and is how an admin endpoint once shipped as AllowAny.

Nothing here sends on its own: a campaign, "Send now" and a retry are queued to the same tasks the
beat runs, after the commit; only the test SMS goes out in the request (one SMS, and the admin is
waiting to see what eskiz said). eskiz is asked for its balance at most every BALANCE_TTL, and
never with a fresh login while its last login was refused — the account is shared with lc-up.
"""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import date, timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework import status as http
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from classes.capabilities import is_global_admin
from classes.models import Classroom, ClassroomMembership
from lcup.conf import debt_freeze_day, debt_freeze_enabled
from lcup.phones import normalize_phone
from users.changelist import apply_search, facets, paginate
from users.models import User

from . import campaigns, conf
from . import debt_warnings as warnings
from . import eskiz, eskiz_templates, switchboard
from . import templates as T
from .delivery import deliver
from .models import EskizTemplate, SmsCampaign, SmsMessage, SmsSettings

BALANCE_KEY = "sms:balance"
BALANCE_TTL = 5 * 60
#: An unanswered balance is asked again sooner, but not on every page load.
BALANCE_ERROR_TTL = 60
CAMPAIGN_LIST_MAX = 200
STUDENT_PICKER_MAX = 20
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


def message_row(msg) -> dict:
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
    }


def _messages(qs):
    return qs.select_related("user", "created_by")


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


def template_row(row) -> dict:
    text = row.pattern or row.original
    return {
        "eskiz_id": row.eskiz_id,
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
    try:
        balance = eskiz.default_client().balance()
    except eskiz.EskizError:
        balance = None
    cache.set(BALANCE_KEY, {"balance": balance}, timeout=BALANCE_TTL if balance is not None else BALANCE_ERROR_TTL)
    return balance


def _by_status(qs) -> dict:
    counts = dict(Counter(qs.values_list("status", flat=True)))
    return {"total": sum(counts.values()), "by_status": counts}


def _today():
    return timezone.localdate()


def _start_of_today(now):
    return timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)


class OverviewView(_AdminView):
    def get(self, request):
        now = timezone.now()
        row = switchboard.current()
        # The next run that will really happen (today, when today is a warning day); none while the
        # warning cannot run at all — switched off here, in the env, or the freeze itself off.
        next_day = warnings.next_warning_day(_today()) if warnings.switched_on() else None
        next_count = len(warnings.plan(now, today=next_day).warnings) if next_day else 0
        last_error = (
            SmsMessage.objects.exclude(error="").order_by("-updated_at", "-id").values_list("error", flat=True).first()
        )
        env_on, db_on, freeze_on = switchboard.env_enabled(), row.debt_enabled, debt_freeze_enabled()
        return Response({
            "configured": conf.is_configured(),
            "balance": _balance(),
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
            },
            "today": _by_status(SmsMessage.objects.filter(created_at__gte=_start_of_today(now))),
            "last7": _by_status(SmsMessage.objects.filter(created_at__gte=now - timedelta(days=7))),
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


class MessageListView(_AdminView):
    def get(self, request):
        params = request.query_params
        qs = apply_search(SmsMessage.objects.all(), params.get("q") or "", MESSAGE_SEARCH)
        qs, filters = facets(qs, MESSAGE_FILTERS, params)
        window, meta = paginate(_messages(qs).order_by("-created_at", "-id"), params)
        return Response({
            **meta,
            "results": [message_row(m) for m in window],
            "filters": filters,
        })


# ── campaigns ─────────────────────────────────────────────────────────────


def _campaign_refused(exc: campaigns.CampaignRefused) -> Response:
    return _refused(exc.code, exc.message)


def _queue_retry(pk: int):
    def queue():
        from . import tasks

        tasks.retry_campaign.delay(pk)

    return queue


class CampaignListView(_AdminView):
    def get(self, request):
        items = SmsCampaign.objects.select_related("created_by").order_by("-created_at", "-id")[:CAMPAIGN_LIST_MAX]
        return Response({"campaigns": _campaign_rows(items)})

    def post(self, request):
        try:
            campaign = campaigns.create(request.data, request.user)
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)
        return Response({"campaign": _campaign_rows([campaign])[0]}, status=http.HTTP_201_CREATED)


class CampaignPreviewView(_AdminView):
    def post(self, request):
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
        return Response({"campaign": _campaign_rows([campaign])[0], "messages": [message_row(m) for m in messages]})


class CampaignCancelView(_AdminView):
    def post(self, request, pk):
        campaign = _campaign(pk)
        try:
            campaigns.cancel(campaign)
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)
        return Response({"campaign": _campaign_rows([campaign])[0]})


class CampaignRetryView(_AdminView):
    def post(self, request, pk):
        campaign = _campaign(pk)
        try:
            queued = campaigns.check_retry(campaign)
        except campaigns.CampaignRefused as exc:
            return _campaign_refused(exc)
        if queued:
            _on_commit(_queue_retry(campaign.pk))
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
        data = request.data if isinstance(request.data, dict) else {}
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
        return Response({
            "day": day.isoformat(),
            "is_last_day": warnings.is_last_day(day),
            "blocked": planned.blocked,
            "skipped": planned.skipped,
            "count": len(rows),
            "cost": sum(r["parts"] for r in rows) * switchboard.price_per_part(),
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
        rows = sorted(
            EskizTemplate.objects.select_related("submitted_by"), key=lambda t: (not t.usable, -t.eskiz_id)
        )
        synced_at = EskizTemplate.objects.aggregate(last=Max("synced_at"))["last"]
        return Response({"templates": [template_row(t) for t in rows], "synced_at": _iso(synced_at)})

    def post(self, request):
        try:
            row, counts = eskiz_templates.submit(eskiz.default_client(), request.data.get("text"), request.user)
        except eskiz_templates.TemplateRefused as exc:
            return _refused(exc.code, exc.message)
        return Response({"template": template_row(row) if row else None, "sync": counts}, status=http.HTTP_201_CREATED)


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
    ``text`` slots' are used (the client sends "" for the rest)."""

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
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
        msg = deliver(
            eskiz.default_client(), kind=SmsMessage.KIND_TEST, run_on=timezone.localdate(),
            dedupe_key=f"test:{uuid.uuid4().hex[:16]}", phone=phone, text=text, created_by=request.user,
        )
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
