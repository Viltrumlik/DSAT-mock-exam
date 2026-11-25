"""Cancel or move a lesson day, set a centre holiday, and undo them (owner, 2026-11-25): ``classes.lesson_changes``.

Writing needs ``manage_lessons``: administrators hold it, the Staff page can take it from one, and the owner always
holds it. Reading the changes needs ``view_people``, as the timetable does. Each write answers ``{change, money}``,
the money being what ``billing.lesson_money`` gave back; a refusal is a 400 in words.
"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status as http
from rest_framework.response import Response
from rest_framework.views import APIView

from access import constants as C
from access.permissions import Requires
from users.changelist import to_int
from users.people_detail import display_name, iso

from . import lesson_changes as L
from .models import Classroom
from .models_lesson_changes import LessonChange

WRITE = Requires(C.PERM_MANAGE_LESSONS)
READ = Requires(C.PERM_VIEW_PEOPLE)


def _today():
    return timezone.localdate()


def _date(value):
    try:
        day = parse_date(str(value or ""))
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        day = None
    if day is None:
        raise L.ChangeRefused("That is not a date.")
    return day


def change_row(change: LessonChange) -> dict:
    return {
        "id": change.pk,
        "classroom_id": change.classroom_id,
        "classroom": change.classroom.name if change.classroom_id else None,
        "kind": change.kind,
        "reason": change.reason,
        "day": change.day.isoformat(),
        "new_day": iso(change.new_day),
        "created_at": iso(change.created_at),
        "created_by": display_name(change.created_by),
        "undone_at": iso(change.undone_at),
        "undone_by": display_name(change.undone_by),
    }


def _answer(call, *, status=http.HTTP_201_CREATED) -> Response:
    try:
        change = call()
    except L.ChangeRefused as refused:
        return Response({"detail": str(refused)}, status=http.HTTP_400_BAD_REQUEST)
    return Response({"change": change_row(change), "money": change.money}, status=status)


class LessonCancelView(APIView):
    """``POST …/classrooms/<pk>/lessons/cancel/`` {day, reason}: the class's lesson that day is called off."""

    permission_classes = [WRITE]

    def post(self, request, pk: int):
        room = get_object_or_404(Classroom, pk=pk)
        data = request.data
        return _answer(lambda: L.cancel(room, _date(data.get("day")), data.get("reason"), by=request.user, today=_today()))


class LessonMoveView(APIView):
    """``POST …/classrooms/<pk>/lessons/move/`` {day, new_day, reason}: the lesson is held, and charged, on another day."""

    permission_classes = [WRITE]

    def post(self, request, pk: int):
        room = get_object_or_404(Classroom, pk=pk)
        data = request.data
        return _answer(
            lambda: L.move(
                room, _date(data.get("day")), _date(data.get("new_day")), data.get("reason"), by=request.user,
                today=_today(),
            )
        )


class HolidayView(APIView):
    """``POST …/lessons/holiday/`` {day, reason}: the centre is closed, so every group's lesson that day is off."""

    permission_classes = [WRITE]

    def post(self, request):
        data = request.data
        return _answer(lambda: L.cancel(None, _date(data.get("day")), data.get("reason"), by=request.user, today=_today()))


class LessonChangeUndoView(APIView):
    """``POST …/lesson-changes/<id>/undo/``: the day is as the timetable says again."""

    permission_classes = [WRITE]

    def post(self, request, change_id: int):
        change = get_object_or_404(LessonChange.objects.select_related("classroom", "created_by"), pk=change_id)
        return _answer(lambda: L.undo(change, by=request.user, today=_today()), status=http.HTTP_200_OK)


class LessonChangeListView(APIView):
    """``GET …/lesson-changes/?from=&to=&classroom=``: the live changes touching those days (by their day or their new
    day), by default the days that can be changed. With ``classroom``, that class's own and every centre holiday."""

    permission_classes = [READ]

    def get(self, request):
        params, today = request.query_params, _today()
        try:
            start = _date(params["from"]) if params.get("from") else today - timedelta(days=L.DAYS_BACK)
            end = _date(params["to"]) if params.get("to") else today + timedelta(days=L.DAYS_AHEAD)
        except L.ChangeRefused as refused:
            return Response({"detail": str(refused)}, status=http.HTTP_400_BAD_REQUEST)
        rows = LessonChange.objects.filter(undone_at__isnull=True).filter(
            Q(day__range=(start, end)) | Q(new_day__range=(start, end))
        )
        if params.get("classroom"):
            room_id = to_int(params["classroom"])
            if not room_id:
                return Response({"detail": "That is not a class."}, status=http.HTTP_400_BAD_REQUEST)
            rows = rows.filter(Q(classroom_id=room_id) | Q(classroom__isnull=True))
        rows = rows.select_related("classroom", "created_by", "undone_by").order_by("day", "pk")
        return Response({"from": start.isoformat(), "to": end.isoformat(), "changes": [change_row(row) for row in rows]})
