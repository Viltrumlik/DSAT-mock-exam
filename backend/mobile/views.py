"""The app's own endpoints: its release policy, its crash reports, and the console behind both.

The two public endpoints must work signed out — a build too old to use has to be told so on the
sign-in screen, and a crash on the way in is still a crash — and a stale token must not turn
either into a 401, which the app would answer by refreshing and, failing that, signing the
student out over a crash report. So they authenticate with `OptionalJWTAuthentication`: a valid
token credits the report to its owner, anything else is simply anonymous.

(Relying on `JWTUserMiddleware` for that does NOT work: DRF's `perform_authentication` runs
before the handler, and with no authenticator its `user` setter overwrites the middleware's user
on the underlying request with AnonymousUser.)
"""

from __future__ import annotations

import json
import logging
import re
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Min
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status as http
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from rewards.views import _is_reward_staff
from users.auth_cookies import NATIVE_CLIENT_HEADER
from users.authentication import CookieOrHeaderJWTAuthentication

from .models import PLATFORM_CHOICES, AppReleasePolicy, ClientDiagnostic
from .policy import forget_policy, get_policy
from .versioning import PLATFORM_IOS, parse_client_header, parse_version

logger = logging.getLogger(__name__)

_HEADER_META = "HTTP_" + NATIVE_CLIENT_HEADER.upper().replace("-", "_")
_PLATFORMS = {value for value, _ in PLATFORM_CHOICES}
_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")

#: Matches the app's `DiagnosticsLimits` so nothing the phone queues is refused at the door.
MAX_REPORTS_PER_BATCH = 10
MAX_PAYLOAD_BYTES = 96 * 1024
MAX_BODY_BYTES = MAX_REPORTS_PER_BATCH * (MAX_PAYLOAD_BYTES + 4096) + 4096


class OptionalJWTAuthentication(CookieOrHeaderJWTAuthentication):
    """The site's JWT authentication, minus the refusal: a bad or expired token is anonymous."""

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except AuthenticationFailed:
            return None


def _clip(value, limit: int) -> str:
    return (value if isinstance(value, str) else "").strip()[:limit]


def _declared_version(request):
    """The build the request says it is: the header first, the query string second."""
    declared = parse_client_header(request.META.get(_HEADER_META))
    if declared is not None and declared[1] is not None:
        return declared[1]
    return parse_version(request.query_params.get("version"))


class AppConfigView(APIView):
    """`GET /api/mobile/config/?platform=ios&version=1.1.0&build=2` — the release policy.

    Always 200, even with no policy row: "nothing required" is an answer, and an app that got a
    404 here would have to guess.
    """

    authentication_classes = [OptionalJWTAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        platform = (request.query_params.get("platform") or PLATFORM_IOS).strip().lower()
        if platform not in _PLATFORMS:
            return Response({"detail": "Unknown platform."}, status=http.HTTP_400_BAD_REQUEST)
        policy = get_policy(platform)
        payload = policy.as_payload(_declared_version(request))
        payload["server_time"] = timezone.now().isoformat()
        response = Response(payload)
        # A policy read from a cache somewhere between the phone and here would defeat the
        # point of raising the minimum.
        response["Cache-Control"] = "no-store"
        return response


class DiagnosticsUploadView(APIView):
    """`POST /api/mobile/diagnostics/` — a batch of crash/hang/error reports from a phone.

    Answers 202 with the ids it now holds, INCLUDING ones it already had: the phone deletes
    what is listed, so a batch retried after a lost response is cleared rather than re-sent
    for ever. Reports that fail validation are simply not listed; the phone drops them after
    its own retries, and a malformed report is not worth a 400 that fails the whole batch.
    """

    authentication_classes = [OptionalJWTAuthentication]
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mobile_diagnostics"

    def post(self, request):
        try:
            declared = int(request.META.get("CONTENT_LENGTH") or "0") or 0
        except (TypeError, ValueError):
            declared = 0
        if declared > MAX_BODY_BYTES:
            return Response({"detail": "Payload too large."}, status=http.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        body = request.data if isinstance(request.data, dict) else {}
        install_id = _clip(body.get("install_id"), 64)
        if not _ID_RE.match(install_id):
            return Response(
                {"detail": "install_id is required.", "code": "bad_install_id"},
                status=http.HTTP_400_BAD_REQUEST,
            )
        platform = _clip(body.get("platform"), 16).lower() or PLATFORM_IOS
        if platform not in _PLATFORMS:
            return Response({"detail": "Unknown platform."}, status=http.HTTP_400_BAD_REQUEST)
        reports = body.get("reports")
        if not isinstance(reports, list) or not reports:
            return Response({"detail": "reports must be a non-empty list."}, status=http.HTTP_400_BAD_REQUEST)
        if len(reports) > MAX_REPORTS_PER_BATCH:
            return Response(
                {"detail": f"At most {MAX_REPORTS_PER_BATCH} reports per request."},
                status=http.HTTP_400_BAD_REQUEST,
            )

        user = request.user if getattr(request.user, "is_authenticated", False) else None

        rows = []
        for raw in reports:
            row = self._row(raw, install_id=install_id, platform=platform, user=user)
            if row is not None:
                rows.append(row)

        if not rows:
            return Response({"accepted": []}, status=http.HTTP_202_ACCEPTED)

        ids = [row.report_id for row in rows]
        existing = set(
            ClientDiagnostic.objects.filter(install_id=install_id, report_id__in=ids).values_list(
                "report_id", flat=True
            )
        )
        fresh = [row for row in rows if row.report_id not in existing]
        new_crash_signatures = self._new_crash_signatures(fresh)
        if fresh:
            try:
                with transaction.atomic():
                    ClientDiagnostic.objects.bulk_create(fresh, ignore_conflicts=True)
            except IntegrityError:  # pragma: no cover - ignore_conflicts covers the race
                logger.warning("mobile diagnostics insert raced; batch still acknowledged")

        for signature, app_version in new_crash_signatures:
            self._alert_new_crash(signature, app_version)

        return Response({"accepted": ids}, status=http.HTTP_202_ACCEPTED)

    def _row(self, raw, *, install_id: str, platform: str, user):
        if not isinstance(raw, dict):
            return None
        report_id = _clip(raw.get("id"), 64)
        kind = _clip(raw.get("kind"), 16).lower()
        signature = _clip(raw.get("signature"), 200)
        if not _ID_RE.match(report_id) or kind not in ClientDiagnostic.KINDS or not signature:
            return None

        occurred_at = None
        stamp = raw.get("occurred_at")
        if isinstance(stamp, str):
            parsed = parse_datetime(stamp)
            if parsed is not None:
                if timezone.is_naive(parsed):
                    parsed = timezone.make_aware(parsed, timezone.utc)
                # A phone with its clock set to next year is still telling us about a crash;
                # it is not telling us when.
                occurred_at = min(parsed, timezone.now())

        payload = raw.get("payload")
        if payload is not None:
            if not isinstance(payload, (dict, list)):
                payload = None
            else:
                try:
                    if len(json.dumps(payload, default=str)) > MAX_PAYLOAD_BYTES:
                        payload = None
                except (TypeError, ValueError):
                    payload = None

        return ClientDiagnostic(
            platform=platform,
            install_id=install_id,
            report_id=report_id,
            kind=kind,
            signature=signature,
            message=_clip(raw.get("message"), 500),
            app_version=_clip(raw.get("app_version"), 32),
            build=_clip(raw.get("build"), 32),
            os_version=_clip(raw.get("os_version"), 64),
            device_model=_clip(raw.get("device_model"), 64),
            occurred_at=occurred_at,
            user=user,
            payload=payload,
        )

    @staticmethod
    def _new_crash_signatures(rows) -> list[tuple[str, str]]:
        """Crash signatures this app version has never reported before."""
        candidates = {
            (row.signature, row.app_version) for row in rows if row.kind == ClientDiagnostic.KIND_CRASH
        }
        fresh = []
        for signature, app_version in sorted(candidates):
            if not ClientDiagnostic.objects.filter(
                kind=ClientDiagnostic.KIND_CRASH, signature=signature, app_version=app_version
            ).exists():
                fresh.append((signature, app_version))
        return fresh

    @staticmethod
    def _alert_new_crash(signature: str, app_version: str) -> None:
        """Tell the desk the first time a build crashes in a new way.

        Only the FIRST of a signature: the fortieth identical crash is a count on the console,
        not forty pages to whoever is on call. `notify_ops_critical` never raises and dedupes.
        """
        try:
            from classes.alerting import notify_ops_critical

            notify_ops_critical(
                "mobile_app_new_crash",
                f"iOS app {app_version or '?'} crashed in a new way: {signature}",
                extra={"signature": signature, "app_version": app_version},
            )
        except Exception:  # pragma: no cover - alerting must never fail an upload
            logger.exception("mobile crash alert failed")


# --- The console ------------------------------------------------------------------------------


class _StaffView(APIView):
    """Same guard as the shop and stories consoles: global staff only, never a teacher."""

    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


def _policy_payload(platform: str, row: AppReleasePolicy | None) -> dict:
    return {
        "platform": platform,
        "latest_version": row.latest_version if row else "",
        "minimum_version": row.minimum_version if row else "",
        "update_url": row.update_url if row else "",
        "message": row.message if row else "",
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
        "updated_by": (
            (row.updated_by.get_full_name() or row.updated_by.email) if row and row.updated_by else None
        ),
    }


class AdminPolicyView(_StaffView):
    """`GET/PUT /api/mobile/admin/policy/?platform=ios` — read or set the release policy."""

    def get(self, request):
        if (refusal := self._guard(request)) is not None:
            return refusal
        platform = (request.query_params.get("platform") or PLATFORM_IOS).lower()
        if platform not in _PLATFORMS:
            return Response({"detail": "Unknown platform."}, status=http.HTTP_400_BAD_REQUEST)
        row = AppReleasePolicy.objects.filter(platform=platform).select_related("updated_by").first()
        return Response(_policy_payload(platform, row))

    def put(self, request):
        if (refusal := self._guard(request)) is not None:
            return refusal
        data = request.data if isinstance(request.data, dict) else {}
        platform = str(data.get("platform") or PLATFORM_IOS).lower()
        if platform not in _PLATFORMS:
            return Response({"detail": "Unknown platform."}, status=http.HTTP_400_BAD_REQUEST)
        row = AppReleasePolicy.objects.filter(platform=platform).first() or AppReleasePolicy(platform=platform)
        for field in ("latest_version", "minimum_version", "update_url", "message"):
            if field in data:
                setattr(row, field, str(data.get(field) or "").strip())
        row.updated_by = request.user
        try:
            row.full_clean()
        except ValidationError as exc:
            return Response(exc.message_dict, status=http.HTTP_400_BAD_REQUEST)
        row.save()
        forget_policy(platform)
        return Response(_policy_payload(platform, row))


def _diagnostic_row(d: ClientDiagnostic, *, with_payload: bool = False) -> dict:
    row = {
        "id": d.id,
        "kind": d.kind,
        "signature": d.signature,
        "message": d.message,
        "app_version": d.app_version,
        "build": d.build,
        "os_version": d.os_version,
        "device_model": d.device_model,
        "occurred_at": d.occurred_at.isoformat() if d.occurred_at else None,
        "received_at": d.received_at.isoformat() if d.received_at else None,
        "user": (d.user.get_full_name() or d.user.email) if d.user_id and d.user else None,
    }
    if with_payload:
        row["payload"] = d.payload
    return row


class AdminDiagnosticsView(_StaffView):
    """`GET /api/mobile/admin/diagnostics/?days=7&kind=crash&app_version=1.1.0`

    Grouped by signature first, because that is the question anyone opens this to answer —
    "what is breaking, on how many phones, since when" — and a raw feed of forty identical
    rows answers it worst. The most recent individual reports follow for drilling in.
    """

    def get(self, request):
        if (refusal := self._guard(request)) is not None:
            return refusal
        try:
            days = max(1, min(int(request.query_params.get("days") or 7), 90))
        except ValueError:
            days = 7
        since = timezone.now() - timedelta(days=days)
        qs = ClientDiagnostic.objects.filter(received_at__gte=since)
        kind = (request.query_params.get("kind") or "").lower()
        if kind in ClientDiagnostic.KINDS:
            qs = qs.filter(kind=kind)
        app_version = (request.query_params.get("app_version") or "").strip()
        if app_version:
            qs = qs.filter(app_version=app_version)

        groups = (
            qs.values("signature", "kind")
            .annotate(
                count=Count("id"),
                installs=Count("install_id", distinct=True),
                first_seen=Min("received_at"),
                last_seen=Max("received_at"),
                sample_id=Max("id"),
            )
            .order_by("-count", "-last_seen")[:50]
        )
        totals = {row["kind"]: row["n"] for row in qs.order_by().values("kind").annotate(n=Count("id"))}
        versions = [
            row["app_version"]
            for row in qs.order_by().values("app_version").annotate(n=Count("id")).order_by("-n")[:10]
        ]
        recent = qs.select_related("user").order_by("-received_at")[:50]
        return Response({
            "days": days,
            "totals": {k: totals.get(k, 0) for k in sorted(ClientDiagnostic.KINDS)},
            "app_versions": versions,
            "groups": [
                {
                    "signature": g["signature"],
                    "kind": g["kind"],
                    "count": g["count"],
                    "installs": g["installs"],
                    "first_seen": g["first_seen"].isoformat() if g["first_seen"] else None,
                    "last_seen": g["last_seen"].isoformat() if g["last_seen"] else None,
                    "sample_id": g["sample_id"],
                }
                for g in groups
            ],
            "recent": [_diagnostic_row(d) for d in recent],
        })


class AdminDiagnosticDetailView(_StaffView):
    """`GET /api/mobile/admin/diagnostics/<id>/` — one report with its payload (call stacks)."""

    def get(self, request, diagnostic_id: int):
        if (refusal := self._guard(request)) is not None:
            return refusal
        diagnostic = get_object_or_404(ClientDiagnostic.objects.select_related("user"), pk=diagnostic_id)
        return Response(_diagnostic_row(diagnostic, with_payload=True))
