"""Presigned-upload endpoint for classroom homework lesson videos.

Returns a short-lived R2 PUT URL the browser uploads the video to directly; the resulting
object key comes back on the assignment save as ``video_key``. See classes.media_uploads.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsAuthenticatedAndNotFrozen

from .capabilities import can as has_cap
from .media_uploads import presign_video_put
from .models import Classroom


class AssignmentVideoUploadUrlView(APIView):
    """POST {filename} -> {upload_url, key, content_type, max_bytes}. Teaching team only."""

    permission_classes = [IsAuthenticatedAndNotFrozen]

    def post(self, request, classroom_pk):
        classroom = get_object_or_404(Classroom, pk=classroom_pk)
        if not has_cap(request.user, classroom, "can_manage_assignments"):
            return Response(
                {"detail": "Only the teaching team can upload a lesson video."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            info = presign_video_put(request.data.get("filename") or "")
        except DjangoValidationError as e:
            return Response({"detail": "; ".join(e.messages)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(info)
