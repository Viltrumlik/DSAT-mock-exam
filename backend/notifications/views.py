"""The inbox, the badge, and push registration.

Everything here is scoped to `request.user` by construction — there is no endpoint that takes
a recipient id, so there is no ownership check that could be forgotten. Staff read their own
bell like anybody else.
"""

from __future__ import annotations

from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import constants, push as push_service, services
from .models import Notification, NotificationPreference, PushSubscription
from .serializers import NotificationSerializer

#: A bell is a recent-history device, not an archive.
PAGE_SIZE = 50


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


class NotificationPreferencesView(APIView):
    """Which sections a student wants, and whether they want their phone to buzz."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
        return Response({
            "muted_categories": prefs.muted_categories or [],
            "push_enabled": prefs.push_enabled,
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
        return Response({
            "muted_categories": prefs.muted_categories,
            "push_enabled": prefs.push_enabled,
        })


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
