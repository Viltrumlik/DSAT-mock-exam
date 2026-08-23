"""The rail a student sees, and the desk it is posted from.

Staff-only endpoints carry their guard in the view, not on the nav item that reaches them —
the codebase has no per-nav-item role gating, so hiding an ops page is decoration. This is the
same `_StaffView` shape `shop.views` uses, and it reuses `rewards.views._is_reward_staff`
rather than restating who counts as staff: whoever may retune the shop and move a student's
coins is exactly who may put a notice on the school's front page. A teacher is deliberately
not on that list — a story is school-wide, and a classroom teacher publishing to every student
in the building is not a decision the classroom owns.

Everything below is a plain `APIView` with an explicit `permission_classes`. Nothing is
hand-routed through `.as_view({...})`: that form silently drops `permission_classes` in this
codebase, and it is how `bulk_assign` shipped to production as AllowAny.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status as http
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rewards.views import _is_reward_staff

from .models import Story
from .serializers import StorySerializer, StoryWriteSerializer

#: A rail is a glance, not a feed. Past this many circles nobody scrolls, and an accidental
#: bulk upload should not become the dashboard's largest response.
RAIL_LIMIT = 30


class _StaffView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _guard(self, request):
        if not _is_reward_staff(request.user):
            return Response({"detail": "Staff only."}, status=http.HTTP_403_FORBIDDEN)
        return None


class StoriesView(APIView):
    """The student rail: only what is up right now, in the order it should be shown.

    The filtering is `Story.objects.live()`, then `RAIL_LIMIT`. The client is not sent the
    hidden or expired ones with a flag to sort out — a story taken down should be gone from
    the wire, not merely styled away, since the dashboard is also what a parent looks over a
    shoulder at. Because the cut is by `sort_order` first, an administrator who has pinned a
    notice keeps it even if the cap bites.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        stories = Story.objects.live()[:RAIL_LIMIT]
        return Response({
            "stories": StorySerializer(
                stories, many=True, context={"request": request}
            ).data
        })


class AdminStoriesView(_StaffView):
    """Every story including the hidden, the scheduled and the expired — and a way to post one."""

    def get(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        stories = list(Story.objects.all())
        # One query answers "which of these is up right now?" for the whole page, so the
        # console can label each row without the serializer re-deriving the publish window
        # per story. See `StorySerializer.get_is_live`.
        live_ids = set(Story.objects.live().values_list("pk", flat=True))
        return Response({
            "stories": StorySerializer(
                stories, many=True, context={"request": request, "live_ids": live_ids}
            ).data
        })

    def post(self, request):
        denied = self._guard(request)
        if denied:
            return denied
        serializer = StoryWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        story = serializer.save(created_by=request.user)
        return Response(
            StorySerializer(story, context={"request": request}).data,
            status=http.HTTP_201_CREATED,
        )


class AdminStoryDetailView(_StaffView):
    def patch(self, request, story_id):
        denied = self._guard(request)
        if denied:
            return denied
        story = get_object_or_404(Story, pk=story_id)
        serializer = StoryWriteSerializer(story, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Re-read the row: `is_live` is answered from a `live_ids` set, and an edit that just
        # unticked `is_active` must not come back still claiming to be up.
        story.refresh_from_db()
        live_ids = set(Story.objects.live().filter(pk=story.pk).values_list("pk", flat=True))
        return Response(
            StorySerializer(story, context={"request": request, "live_ids": live_ids}).data
        )

    def delete(self, request, story_id):
        denied = self._guard(request)
        if denied:
            return denied
        story = get_object_or_404(Story, pk=story_id)
        # A hard delete, unlike `shop.AdminItemDetailView.delete`, which has to hide an item
        # instead because orders point at it. Nothing points at a story: there is no per-
        # student seen state this pass, so deleting one orphans no row. (The image file is
        # left in the bucket — Django never deletes a FileField's file, and reaping R2 objects
        # is a separate job that does not exist yet.)
        story.delete()
        return Response({"detail": "Deleted.", "deleted": True})
