"""Teacher panel endpoints that are not scoped to one classroom.

``GET /api/classes/teacher/today/`` — the Dashboard's today: every class the caller teaches
with its schedule and the state of its next lesson, the grading queue three levels deep, the
attendance and homework aggregates the page charts, and the midterms coming up (design
2026-09-20 §4.1–4.3 and §5, widened by the owner's 2026-09-21 note).

Deliberately thin: every rule lives in ``classes.teacher_today`` so the payload can be
asserted without HTTP.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsAuthenticatedAndNotFrozen

from .teacher_today import build_teacher_today


class TeacherTodayView(APIView):
    """Read-only. Staff only, membership-scoped, and it writes nothing.

    The scope IS the guard, fail-closed: ``build_teacher_today`` only ever looks at classes
    the caller holds a non-removed ``ClassroomMembership`` in AND is staff of there — the
    same rule ``classroom_capabilities`` applies per classroom. So a staff member of no
    class, a student, and a global admin who is a member of nothing all get the same empty
    lists rather than a 403 the Dashboard would have to paint as an error. No classroom id
    is accepted, so there is nothing to 404 on.
    """

    permission_classes = [IsAuthenticatedAndNotFrozen]

    def get(self, request):
        return Response(build_teacher_today(request.user))
