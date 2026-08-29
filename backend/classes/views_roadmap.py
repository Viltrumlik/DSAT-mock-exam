"""Student-facing roadmap endpoint.

Lives in the ``classes`` app (not ``journals``) on purpose: the ``/api/journals/``
namespace is host-guarded to the admin subdomain and permission-gated to staff, so a
student on the main site can never reach it. Students already hit ``/api/classes/`` for
``my-assignments`` and ``my-schedule``; the roadmap belongs beside them.
"""

from __future__ import annotations

from django.core.exceptions import PermissionDenied
from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from journals.models import ClassroomLesson

from .progress import student_progress
from .roadmap import build_roadmap
from .roadmap_reading import delivery_for_student, mark_read, read_payload


class StudentRoadmapView(APIView):
    """``GET /api/classes/roadmap/`` — the logged-in student's per-subject level ladder.

    Read-only. Shows every level of each subject the student studies; only the student's
    own level is openable (see ``classes.roadmap`` for the full contract).

    ``IsAuthenticated`` rather than ``IsAuthenticatedAndNotFrozen``: the roadmap is a
    read-only map that emits no openable id for anything the student may not open, so it is
    safe to show a frozen student — the homework it links to still enforces the freeze
    downstream.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_roadmap(request.user))


class StudentProgressView(APIView):
    """``GET /api/classes/progress/`` — how far the student is through each level.

    Beside the roadmap rather than folded into it, because the two answer different
    questions and a reader would have to be told which number is which. The roadmap is
    "where am I and what can I open"; this is "how did each level go", scored out of
    attendance and homework together.

    Deliberately does NOT redefine ``RoadmapTrack.completion_rate``. That key is the sole
    producer of the ring on the dashboard and the subtitle on the roadmap; changing what it
    means would silently change both. This ships its own numbers alongside.

    ``IsAuthenticated``, matching the roadmap: it is read-only and opens nothing.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(student_progress(request.user))


class RoadmapReadingView(APIView):
    """``GET|POST /api/classes/roadmap/<delivery_id>/reading/``

    GET returns one session's reading — the ordered sections, and the homework id IF the
    student has earned it. POST is the "I've finished reading" button.

    ``IsAuthenticated``, matching the roadmap it hangs off: the entitlement question here is
    classroom membership, which is not a thing a permission class can answer without the
    object, so it is answered in ``delivery_for_student`` against the delivery row itself.
    """

    permission_classes = [IsAuthenticated]

    def _delivery(self, request, delivery_id):
        try:
            return delivery_for_student(delivery_id, request.user), None
        except ClassroomLesson.DoesNotExist:
            return None, Response({"detail": "No such lesson."}, status=http.HTTP_404_NOT_FOUND)
        except PermissionDenied:
            # 404, not 403. A student who is not in the class should not learn that a lesson
            # with this id exists — and to them the two answers are the same thing anyway.
            return None, Response({"detail": "No such lesson."}, status=http.HTTP_404_NOT_FOUND)

    def get(self, request, delivery_id):
        delivery, denied = self._delivery(request, delivery_id)
        if denied:
            return denied
        return Response(read_payload(delivery, request.user, request))

    def post(self, request, delivery_id):
        delivery, denied = self._delivery(request, delivery_id)
        if denied:
            return denied
        mark_read(delivery, request.user)
        # The whole payload back, not just an ack: marking it read is what reveals the
        # homework id, and returning it here saves a refetch that could show the old one.
        return Response(read_payload(delivery, request.user, request))
