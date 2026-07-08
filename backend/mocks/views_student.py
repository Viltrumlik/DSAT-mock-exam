"""Student-facing mock list (available published mocks + attempt state)."""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import accessible_mock_ids
from .models import Mock, MockAttempt


class MyMocksView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        ids = accessible_mock_ids(user)
        mocks = {m.id: m for m in Mock.objects.filter(id__in=ids)}
        attempts = {}
        for a in MockAttempt.objects.filter(student=user, mock_id__in=ids).order_by("created_at"):
            attempts[a.mock_id] = a  # latest wins

        rows = []
        for mid, m in mocks.items():
            att = attempts.get(mid)
            module_count = len(m.english_modules()) + len(m.math_modules())
            rows.append({
                "mock_id": mid,
                "title": m.title,
                "break_minutes": m.break_minutes,
                "module_count": module_count,
                "attempt_id": att.id if att else None,
                "state": att.current_state if att else "NOT_STARTED",
                "in_progress": bool(att and not att.is_completed),
                "submitted": bool(att and att.is_completed),
                "total_score": att.total_score if (att and att.is_completed) else None,
            })
        rows.sort(key=lambda r: r["title"])
        return Response({"results": rows})
