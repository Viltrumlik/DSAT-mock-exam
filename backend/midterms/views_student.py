"""Student-facing midterm list (both flavors).

GET /api/midterms/mine/ — every midterm the student can see (classroom-assigned or
standalone-granted, plus any they have already attempted), with per-midterm attempt state,
release-gated score, schedule window (classroom flavor) and certificate.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import (
    FLAVOR_CLASSROOM,
    grant_flavor,
    midterm_results_state,
    resolve_accessible_midterm_ids,
    winning_grant,
)
from .models import Midterm, MidtermAttempt


class MyMidtermsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        ids = resolve_accessible_midterm_ids(user)
        midterms = {m.id: m for m in Midterm.objects.filter(id__in=ids)}
        attempts = {}
        for a in MidtermAttempt.objects.filter(student=user, midterm_id__in=ids).order_by("created_at"):
            attempts[a.midterm_id] = a  # last (latest) wins

        rows = []
        for mid, m in midterms.items():
            grant = winning_grant(user, m)
            flavor = grant_flavor(grant)
            att = attempts.get(mid)

            is_open = True
            available_at = None
            is_before_start = False
            deadline = None
            if flavor == FLAVOR_CLASSROOM and grant is not None and grant.classroom_id:
                from classes.models_schedule import MidtermSchedule

                sched = MidtermSchedule.objects.filter(classroom_id=grant.classroom_id, midterm=m).first()
                if sched is not None:
                    is_open = sched.is_open()
                    available_at = sched.available_at
                    is_before_start = sched.is_before_start()
                    deadline = sched.deadline

            if att is not None:
                state = midterm_results_state(att)
            else:
                # No attempt yet: classroom scores are gated until publish; standalone shows on submit.
                state = {"results_visible": flavor != FLAVOR_CLASSROOM, "certificate": None}
            submitted = bool(att and att.is_completed)
            visible = bool(state["results_visible"])

            rows.append({
                "midterm_id": mid,
                "title": m.title,
                "subject": m.subject,
                "scoring_scale": m.scoring_scale,
                "score_ceiling": m.score_ceiling,
                "duration_minutes": m.duration_minutes,
                "question_count": m.questions().count(),
                "flavor": flavor,
                "attempt_id": att.id if att else None,
                "state": att.current_state if att else "NOT_STARTED",
                "submitted": submitted,
                "is_open": is_open,
                "is_before_start": is_before_start,
                "available_at": available_at.isoformat() if available_at else None,
                "deadline": deadline.isoformat() if deadline else None,
                "results_visible": visible,
                "score": att.score if (submitted and visible) else None,
                "certificate": state.get("certificate"),
            })
        rows.sort(key=lambda r: r["title"])
        return Response({"results": rows})
