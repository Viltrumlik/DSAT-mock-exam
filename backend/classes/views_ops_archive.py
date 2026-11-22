"""/ops Archive: the students who left a group and the archived groups (``classes.ops_archive``). Read-only.

The same people as the people list and the groups list (``view_people``); the balance in a row, and the filter on
it, only for ``view_money`` too.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import Requires
from access.services import authorize

from .ops_archive import groups_page, students_page, totals

READ = Requires(C.PERM_VIEW_PEOPLE)


class ArchiveStudentsView(APIView):
    """``GET /api/classes/admin/archive/students/?q=&classroom=&teacher=&owing=1&page=&page_size=`` — every student
    seat that ended, newest first, with the group, the day, who ended it and (money) the balance now."""

    permission_classes = [READ]

    def get(self, request):
        from lcup.guards import seats_locked

        money = authorize(request.user, C.PERM_VIEW_MONEY)
        return Response({
            **students_page(request.query_params, money=money),
            "money": money,
            # Return goes through the group's own Add, which takes seats only once lc-up stops running them.
            "seats_open": not seats_locked(),
            "totals": totals(),
        })


class ArchiveGroupsView(APIView):
    """``GET /api/classes/admin/archive/groups/?q=&page=&page_size=`` — every archived class and its dates."""

    permission_classes = [READ]

    def get(self, request):
        return Response({**groups_page(request.query_params), "totals": totals()})
