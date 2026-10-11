"""The pastpapers a homework has set this student again.

The library card reads it to turn a finished paper back into "Start again"; the rule is in
``pastpaper_retake``. Read-only: nothing is created until the student starts.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .pastpaper_retake import reopened_papers


class ReopenedPastpapersView(APIView):
    """``{"items": [{practice_test_id, assignment_id, assignment_title, classroom_id,
    classroom_name, set_at, due_at}], "results": <the same list>}`` for the requesting student.

    The website reads ``items``. The released Windows app (0.1.0) reads ``results`` — it
    shipped expecting the paginated-list key, so with ``items`` alone its "Assigned again"
    state never appeared. Both keys carry the one list; neither may be dropped while either
    client is in use.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = list(reopened_papers(request.user).values())
        return Response({"items": rows, "results": rows})
