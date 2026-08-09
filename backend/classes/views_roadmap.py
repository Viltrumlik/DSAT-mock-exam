"""Student-facing roadmap endpoint.

Lives in the ``classes`` app (not ``journals``) on purpose: the ``/api/journals/``
namespace is host-guarded to the admin subdomain and permission-gated to staff, so a
student on the main site can never reach it. Students already hit ``/api/classes/`` for
``my-assignments`` and ``my-schedule``; the roadmap belongs beside them.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .roadmap import build_roadmap


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
