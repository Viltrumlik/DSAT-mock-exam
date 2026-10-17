"""Group post endpoints for the ops console.

Plain `APIView`s, never `.as_view({...})` — that form silently drops `permission_classes` in
this codebase and is how an admin endpoint once shipped as AllowAny.

No view here talks to Telegram. Every send goes through `services` and `sender`, so there is
one path that claims a run and one that sends it.
"""

from __future__ import annotations

from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rewards.views import _is_reward_staff

from . import audience, sender, services
from .models import GroupPost
from .serializers import DeliverySerializer, PostSerializer, PostWriteSerializer

ACTIONS = {"pause", "resume", "retry", "send-missed", "delete-from-groups"}


def _refused(exc: services.PostRefused) -> Response:
    return Response({"code": exc.code, "detail": exc.message}, status=http.HTTP_400_BAD_REQUEST)


def _detail(post, request) -> dict:
    data = PostSerializer(
        post, context={"request": request, "counts": services.delivery_counts([post.pk])}
    ).data
    data["runs"] = [
        {
            "run_on": run["run_on"].isoformat(),
            "deliveries": DeliverySerializer(run["deliveries"], many=True).data,
        }
        for run in services.runs(post)
    ]
    return data


class _StaffView(APIView):
    """The events console's gate, copied rather than imported (see events/views.py)."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _guard(self, request):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


class AdminPostsView(_StaffView):
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        posts = list(GroupPost.objects.select_related("event").order_by("-created_at", "-id")[:200])
        counts = services.delivery_counts([p.pk for p in posts])
        return Response({
            "enabled": sender.enabled(),
            "posts": PostSerializer(posts, many=True, context={"request": request, "counts": counts}).data,
        })

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = PostWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        post = services.create_post(data=dict(serializer.validated_data), user=request.user)
        return Response(_detail(post, request), status=http.HTTP_201_CREATED)


class AdminPostDetailView(_StaffView):
    def get(self, request, post_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        post = get_object_or_404(GroupPost.objects.select_related("event"), pk=post_id)
        return Response(_detail(post, request))

    def patch(self, request, post_id: int):
        denied = self._guard(request)
        if denied:
            return denied
        post = get_object_or_404(GroupPost.objects.select_related("event"), pk=post_id)
        try:
            # Before validation: "already sent" is the real answer for a sent post, not
            # "pick a time in the future" about its old send time. `update_post` checks the
            # edit itself (a changed `when` once the post has run) once the data is known.
            services.ensure_editable(post)
            serializer = PostWriteSerializer(post, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            post = services.update_post(post, dict(serializer.validated_data))
        except services.PostRefused as exc:
            return _refused(exc)
        return Response(_detail(post, request))


class AdminPostActionView(_StaffView):
    def post(self, request, post_id: int, action: str):
        denied = self._guard(request)
        if denied:
            return denied
        if action not in ACTIONS:
            raise Http404
        post = get_object_or_404(GroupPost.objects.select_related("event"), pk=post_id)
        try:
            if action == "pause":
                services.pause(post)
                result = {}
            elif action == "resume":
                services.resume(post)
                result = {}
            elif action == "retry":
                result = services.retry_failed(post)
            elif action == "send-missed":
                result = services.send_missed_now(post)
            else:
                result = services.delete_from_groups(post)
        except services.PostRefused as exc:
            return _refused(exc)
        post.refresh_from_db()
        return Response({"result": result, "post": _detail(post, request)})


class AdminGroupsView(_StaffView):
    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        return Response({"enabled": sender.enabled(), "groups": audience.picker_rows()})
