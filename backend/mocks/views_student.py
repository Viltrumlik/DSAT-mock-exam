"""Student-facing mock list (available published mocks + attempt state)."""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import accessible_mock_ids
from .models import Mock, MockAttempt
from .state_machine import STATE_ABANDONED


class MyMocksView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        ids = accessible_mock_ids(user)
        mocks = {m.id: m for m in Mock.objects.filter(id__in=ids)}

        # Two DIFFERENT attempts matter per mock and conflating them loses a result: the
        # ACTIVE one is what "Resume" reopens, while the last COMPLETED one carries the
        # score. Reporting only "the latest" meant that the moment a student retook a mock,
        # the score they had just earned vanished from the list with no way back to it.
        active: dict[int, MockAttempt] = {}
        finished: dict[int, MockAttempt] = {}
        for a in MockAttempt.objects.filter(student=user, mock_id__in=ids).order_by("created_at"):
            if a.is_completed:
                finished[a.mock_id] = a  # latest completed wins
            elif a.current_state != STATE_ABANDONED:
                active[a.mock_id] = a

        rows = []
        for mid, m in mocks.items():
            live = active.get(mid)
            done = finished.get(mid)
            module_count = len(m.english_modules()) + len(m.math_modules())
            rows.append({
                "mock_id": mid,
                "title": m.title,
                "break_minutes": m.break_minutes,
                "module_count": module_count,
                "attempt_id": live.id if live else (done.id if done else None),
                "state": live.current_state if live else "NOT_STARTED",
                "in_progress": bool(live),
                "submitted": bool(done),
                "total_score": done.total_score if done else None,
                # Where "View result" points — always the last finished sitting, even once a
                # retake is under way.
                "result_attempt_id": done.id if done else None,
            })
        rows.sort(key=lambda r: r["title"])
        return Response({"results": rows})
