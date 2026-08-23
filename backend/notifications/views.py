"""The inbox, the badge, push registration, and the one endpoint that writes for somebody else.

Everything here except :class:`NotificationBroadcastView` is scoped to `request.user` by
construction — there is no endpoint that takes a recipient id, so there is no ownership check
that could be forgotten. Staff read their own bell like anybody else.

The broadcast is the deliberate exception, and it is gated accordingly: super_admin only, via
``access.permissions.IsSuperAdmin``, on a plain ``APIView``. Not a hand-routed
``ViewSet.as_view({...})`` — this codebase has been bitten before by that pattern silently
dropping ``permission_classes`` and leaving a bulk write effectively ``AllowAny`` in
production.
"""

from __future__ import annotations

import hashlib

from django.contrib.auth import get_user_model
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as acc_const
from access.permissions import IsSuperAdmin
from users.permissions import IsAuthenticatedAndNotFrozen

from . import constants, push as push_service, services
from .models import Notification, NotificationPreference, PushSubscription
from .serializers import (
    AUDIENCE_STAFF,
    AUDIENCE_STUDENTS,
    AUDIENCE_TEACHERS,
    NotificationBroadcastSerializer,
    NotificationSerializer,
)

#: A bell is a recent-history device, not an archive.
PAGE_SIZE = 50

#: Recipients per fan-out call. ``notify_many`` is already set-shaped, but it builds one model
#: instance per recipient before inserting, so a whole-school broadcast is chunked to keep the
#: peak memory of a single request bounded rather than proportional to the roll.
BROADCAST_CHUNK = 1000


class NotificationListView(APIView):
    """The inbox. `?category=` narrows to one section, `?unread=1` to what is new."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Notification.objects.filter(recipient=request.user)

        category = (request.query_params.get("category") or "").upper()
        if category in constants.ALL_CATEGORIES:
            qs = qs.filter(category=category)
        if request.query_params.get("unread") in ("1", "true", "yes"):
            qs = qs.filter(read_at__isnull=True)

        rows = list(qs[:PAGE_SIZE])
        summary = services.unread_summary(request.user)
        return Response({
            "notifications": NotificationSerializer(rows, many=True).data,
            "unread_total": summary["total"],
            "unread_by_category": summary["by_category"],
            # Served rather than hardcoded in the client so a new section appears without a
            # frontend deploy, and so the order is decided in one place.
            "categories": [
                {"value": code, "label": label}
                for code, label in constants.CATEGORY_CHOICES
                if code in constants.CATEGORY_ORDER
            ],
        })


class NotificationSummaryView(APIView):
    """Just the counts — what the bell polls for, so it never fetches a list to draw a dot."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(services.unread_summary(request.user))


class NotificationReadView(APIView):
    """Mark some, a section, or everything as read."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        ids = request.data.get("ids") or None
        category = (request.data.get("category") or "").upper() or None
        if category and category not in constants.ALL_CATEGORIES:
            return Response({"detail": "Unknown category."}, status=400)
        moved = services.mark_read(request.user, ids=ids, category=category)
        return Response({"marked": moved, **services.unread_summary(request.user)})


def _category_options() -> list[dict]:
    """The sections, in display order, as the client renders them.

    Served rather than hardcoded for the same reason the inbox serves them: a category added
    to the platform should appear on the preferences screen without a frontend deploy, and the
    order should be decided in one place. Without this the preferences screen would have been
    the one surface with its own private copy of the section list — and a section missing from
    that copy is a switch the student can never reach, which reads as "this cannot be turned
    off" rather than as a bug.
    """
    return [
        {"value": code, "label": label}
        for code, label in constants.CATEGORY_CHOICES
        if code in constants.CATEGORY_ORDER
    ]


class NotificationPreferencesView(APIView):
    """Which sections a student wants, and whether they want their phone to buzz."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
        return Response({
            "muted_categories": prefs.muted_categories or [],
            "push_enabled": prefs.push_enabled,
            "categories": _category_options(),
        })

    def patch(self, request):
        prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
        if "muted_categories" in request.data:
            wanted = request.data.get("muted_categories") or []
            # Filtered rather than validated-and-rejected: an unknown category in the list is
            # a stale client, and dropping it is closer to what the student meant than a 400.
            prefs.muted_categories = [
                c for c in wanted if str(c).upper() in constants.ALL_CATEGORIES
            ]
        if "push_enabled" in request.data:
            prefs.push_enabled = bool(request.data.get("push_enabled"))
        prefs.save(update_fields=["muted_categories", "push_enabled", "updated_at"])
        # The same shape as GET, so a client can write the response straight back into its
        # cache instead of refetching to learn what it was just told.
        return Response({
            "muted_categories": prefs.muted_categories,
            "push_enabled": prefs.push_enabled,
            "categories": _category_options(),
        })


#: Which roles each audience means. Kept next to the view rather than in `constants` because
#: it is a fact about *this endpoint's* choices, not about notifications in general.
#:
#: ``all`` is absent deliberately: it means "no role filter", not "the union of the roles I
#: happened to list", so a role added to the platform later is included without anybody
#: remembering to edit this map.
_AUDIENCE_ROLES = {
    AUDIENCE_STUDENTS: (acc_const.ROLE_STUDENT,),
    AUDIENCE_TEACHERS: (acc_const.ROLE_TEACHER, acc_const.ROLE_SUPPORT_TEACHER),
    AUDIENCE_STAFF: (
        acc_const.ROLE_TEACHER,
        acc_const.ROLE_SUPPORT_TEACHER,
        acc_const.ROLE_TEST_ADMIN,
        acc_const.ROLE_TEST_AUDITOR,
        acc_const.ROLE_ADMIN,
        acc_const.ROLE_SUPER_ADMIN,
    ),
}


class NotificationBroadcastView(APIView):
    """POST a system announcement to a whole audience. super_admin only.

    ``EVENT_SYSTEM`` was declared, categorised and rendered by the client, and could not be
    raised by anybody: no hook produces it, and ``NotificationAdmin.has_add_permission`` is
    False on purpose — a row typed into the admin would land in the bell without the realtime
    hint or the push that ``services.notify`` fires, so it would reach an open tab only if the
    student happened to reload. This endpoint is the missing producer.

    **Why the permission is the narrow one.** ``IsSuperAdmin`` rather than "global staff":
    writing a row into every student's inbox in the school is a different act from anything
    else a test_admin does, and it has no undo — a broadcast cannot be recalled once phones
    have buzzed. Widening it later is a one-line change; narrowing it after somebody has used
    it is not.

    **Why a dedupe key.** ``broadcast:<digest of the message>`` collapses a double-submit — an
    impatient second click, or an ops console retrying a request whose response was lost — into
    one notification per person, because the whole fan-out is idempotent for an hour on
    identical text. A genuinely repeated announcement tomorrow is new text or a fresh window,
    and goes out normally.

    **Push is opt-in per broadcast.** ``EVENT_SYSTEM`` is not in ``constants.PUSH_EVENTS``,
    and that set is short on purpose — a platform that pushes everything teaches students to
    switch push off, after which the one that mattered does not arrive either. But "the centre
    is closed tomorrow" is exactly the message that should reach a phone, so ``push: true``
    exists and defaults to false: interrupting a whole school is an act somebody has to choose.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen, IsSuperAdmin]

    def post(self, request):
        serializer = NotificationBroadcastSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        audience = data["audience"]
        title = data["title"]
        body = data.get("body") or ""
        link_url = data.get("link_url") or ""
        push = bool(data.get("push"))

        User = get_user_model()
        recipients = User.objects.filter(is_active=True)
        roles = _AUDIENCE_ROLES.get(audience)
        if roles:
            recipients = recipients.filter(role__in=roles)
        # Frozen accounts cannot use the API at all (see IsAuthenticatedAndNotFrozen), so a
        # notification for one is a row nobody will ever be able to open. Excluded here rather
        # than filtered in the client so the reported count is the truth.
        recipients = recipients.exclude(is_frozen=True).order_by("pk")

        digest = hashlib.sha256(
            "\x1f".join([title, body, link_url]).encode("utf-8")
        ).hexdigest()[:24]
        dedupe_key = f"broadcast:{digest}"

        written = 0
        seen = 0
        chunk = []
        # `iterator()` so a whole-school broadcast never materialises the full user table, and
        # a manual chunk because the fan-out wants a list it can turn into one bulk_create.
        for user in recipients.iterator(chunk_size=BROADCAST_CHUNK):
            chunk.append(user)
            if len(chunk) >= BROADCAST_CHUNK:
                seen += len(chunk)
                written += services.notify_many(
                    chunk,
                    event=constants.EVENT_SYSTEM,
                    title=title,
                    body=body,
                    link_url=link_url,
                    dedupe_key=dedupe_key,
                    push=push,
                )
                chunk = []
        if chunk:
            seen += len(chunk)
            written += services.notify_many(
                chunk,
                event=constants.EVENT_SYSTEM,
                title=title,
                body=body,
                link_url=link_url,
                dedupe_key=dedupe_key,
                push=push,
            )

        return Response(
            {
                "audience": audience,
                # `recipients` is who was targeted; `notified` is who it reached. They differ
                # by whoever has muted the System section, and an operator staring at a
                # smaller number deserves to see both rather than assume the send half-failed.
                "recipients": seen,
                "notified": written,
                "pushed": push,
                "dedupe_key": dedupe_key,
            },
            status=http.HTTP_201_CREATED,
        )


class PushConfigView(APIView):
    """The VAPID public key, and whether push is configured at all.

    `enabled: false` is the important half. Without it a client would ask the browser for
    notification permission on a deployment that has no keys — and a refused permission is
    permanent per origin, so the platform would have burned its one chance to ask.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "enabled": push_service.is_configured(),
            "public_key": push_service.public_key(),
        })


class PushSubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        endpoint = (request.data.get("endpoint") or "").strip()
        keys = request.data.get("keys") or {}
        p256dh = (keys.get("p256dh") or "").strip()
        auth = (keys.get("auth") or "").strip()
        if not (endpoint and p256dh and auth):
            return Response({"detail": "endpoint and keys are required."}, status=400)

        # Upsert on endpoint, which is what identifies the installation. Keyed any other way,
        # a student who re-subscribes accumulates dead rows and gets duplicate buzzes.
        subscription, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={
                "user": request.user,
                "p256dh": p256dh,
                "auth": auth,
                "user_agent": (request.META.get("HTTP_USER_AGENT") or "")[:240],
                "failed_at": None,
            },
        )
        return Response(
            {"detail": "Subscribed.", "id": subscription.pk},
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )


class PushUnsubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        endpoint = (request.data.get("endpoint") or "").strip()
        if not endpoint:
            return Response({"detail": "endpoint is required."}, status=400)
        # Scoped to the caller so one student cannot unsubscribe another's device.
        deleted, _ = PushSubscription.objects.filter(
            user=request.user, endpoint=endpoint
        ).delete()
        return Response({"deleted": deleted})
