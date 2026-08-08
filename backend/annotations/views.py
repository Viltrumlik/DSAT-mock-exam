"""Read every annotation for one attempt/set; write one region at a time.

Two shapes, because the two directions have genuinely different traffic. Reads happen once
when a page opens and want everything in a single request. Writes happen on every mouse-up
and want to be as small as possible, so a slow or failed save never costs more than the one
region the student just marked.

**Ownership is not a parameter.** Every query is filtered to ``request.user`` and every write
sets it, so there is no id a student can pass to reach somebody else's notes. That is the
whole authorization story here — annotations are private study material, and no staff surface
reads them.
"""

from __future__ import annotations

from rest_framework import status as http
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import StudyAnnotation
from .serializers import AnnotationWriteSerializer


class AnnotationListView(APIView):
    """GET /api/annotations/?scope=exam&ref=123 — everything the student marked there."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope = (request.query_params.get("scope") or "").strip()
        ref = (request.query_params.get("ref") or "").strip()
        valid_scopes = {c[0] for c in StudyAnnotation.SCOPE_CHOICES}
        if scope not in valid_scopes:
            return Response({"detail": "Unknown scope."}, status=400)
        if not ref:
            return Response({"detail": "ref is required."}, status=400)

        rows = StudyAnnotation.objects.filter(
            student=request.user, scope=scope, ref=ref
        ).values("target_id", "container", "data")
        return Response({"items": list(rows)})


class AnnotationWriteView(APIView):
    """PUT /api/annotations/ — upsert one region.

    An empty list deletes the row rather than storing ``[]``. "The student cleared their
    highlights" and "the student never highlighted here" are the same fact, and keeping an
    empty row would grow a table that is read in full on every page open.
    """

    permission_classes = [IsAuthenticated]

    def put(self, request):
        serializer = AnnotationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        v = serializer.validated_data

        key = dict(
            student=request.user,
            scope=v["scope"],
            ref=v["ref"],
            target_id=v["target_id"],
            container=v["container"],
        )
        if not v["data"]:
            StudyAnnotation.objects.filter(**key).delete()
            return Response(status=http.HTTP_204_NO_CONTENT)

        StudyAnnotation.objects.update_or_create(**key, defaults={"data": v["data"]})
        return Response(status=http.HTTP_204_NO_CONTENT)
